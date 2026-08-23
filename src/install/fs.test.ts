import { afterEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { cleanupTempRoots, createTempRoot } from "../test-utils/fs.js";
import { InstallError } from "./errors.js";
import { __test, backupPath, copyPlatformContents, copyToNewPath, filesystemIdentity } from "./fs.js";

const { copyLeaf, reserveDirectory, unlinkManagedEntry } = __test;

afterEach(cleanupTempRoots);

// fs.ts: the destination-mutation safety rules - symlink refusal at a destination path, exclusive
// creation, mode preservation, the sweep-before-copy ordering, narrow (non-recursive) removal of
// managed entries, and the filesystemIdentity seam manifest.ts relies on.
describe("backupPath", () => {
  it("names the first attempt with no discriminator", () => {
    expect(backupPath("/root/foo.md", "2024-01-01T00-00-00")).toBe("/root/foo.md.2024-01-01T00-00-00.backup");
  });

  it("adds an attempt discriminator past the first, so same-second collisions land on different names", () => {
    expect(backupPath("/root/foo.md", "2024-01-01T00-00-00", 2)).toBe("/root/foo.md.2024-01-01T00-00-00-2.backup");
    expect(backupPath("/root/foo.md", "2024-01-01T00-00-00", 3)).toBe("/root/foo.md.2024-01-01T00-00-00-3.backup");
  });
});

describe("copyToNewPath: files", () => {
  it("creates the file when the target path is free", () => {
    const root = createTempRoot();
    const source = join(root, "source.txt");
    const target = join(root, "target.txt");
    writeFileSync(source, "content");

    expect(copyToNewPath(source, target)).toBe(true);
    expect(readFileSync(target, "utf-8")).toBe("content");
  });

  it("refuses to overwrite an existing target and leaves its content untouched", () => {
    const root = createTempRoot();
    const source = join(root, "source.txt");
    const target = join(root, "target.txt");
    writeFileSync(source, "new content");
    writeFileSync(target, "original content");

    expect(copyToNewPath(source, target)).toBe(false);
    expect(readFileSync(target, "utf-8")).toBe("original content");
  });
});

describe("copyToNewPath: directories", () => {
  it("creates the directory, copies its contents, and preserves the source's exact mode", () => {
    const root = createTempRoot();
    const source = join(root, "source-dir");
    const target = join(root, "target-dir");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "child.txt"), "child content");
    // An explicit chmod, not a create-time mode: chmodSync sets these bits exactly, unaffected by
    // the process umask, so the assertion below is deterministic across machines and CI. The sticky
    // bit (0o1000) is included deliberately: masking the applied mode with 0o777 instead of 0o7777
    // would silently drop it and still read back as a match.
    chmodSync(source, 0o1750);

    expect(copyToNewPath(source, target)).toBe(true);
    expect(readFileSync(join(target, "child.txt"), "utf-8")).toBe("child content");
    expect(lstatSync(target).mode & 0o7777).toBe(0o1750);
  });

  it("reserves the backup directory owner-only until its contents are copied in", () => {
    const root = createTempRoot();
    const dirPath = join(root, "reserved-dir");

    expect(reserveDirectory(dirPath)).toBe(true);
    // The conservative end of the window applyMode later closes: children would otherwise be
    // readable at the umask default, for the length of the copy and indefinitely if it fails.
    expect(lstatSync(dirPath).mode & 0o7777).toBe(0o700);
  });

  it("refuses an existing target directory and leaves its content untouched", () => {
    const root = createTempRoot();
    const source = join(root, "source-dir");
    const target = join(root, "target-dir");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "new.txt"), "new");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "existing.txt"), "existing");

    expect(copyToNewPath(source, target)).toBe(false);
    expect(existsSync(join(target, "new.txt"))).toBe(false);
    expect(readFileSync(join(target, "existing.txt"), "utf-8")).toBe("existing");
  });
});

describe("copyToNewPath: symlinks", () => {
  it("reproduces the link itself when the target path is free, rather than dereferencing it", () => {
    const root = createTempRoot();
    const source = join(root, "source-link");
    const target = join(root, "target-link");
    writeFileSync(join(root, "real.txt"), "content");
    // Deliberately a *relative* target: an absolute one reads back the same whether the backup
    // reproduced the link text or resolved it, so a copy that dereferenced the source would still
    // look right. Against "real.txt" the two differ, and the readlink assertion below catches it.
    symlinkSync("real.txt", source);

    expect(copyToNewPath(source, target)).toBe(true);
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    expect(readlinkSync(target)).toBe(readlinkSync(source));
    expect(readFileSync(target, "utf-8")).toBe("content");
  });

  it("reproduces a dangling link, whose target cannot be resolved at all", () => {
    const root = createTempRoot();
    const source = join(root, "source-link");
    const target = join(root, "target-link");
    // Nothing is ever written at "nowhere.txt". Anything that resolves the source instead of
    // reading its link text fails outright here rather than quietly copying the wrong thing.
    symlinkSync("nowhere.txt", source);

    expect(copyToNewPath(source, target)).toBe(true);
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    expect(readlinkSync(target)).toBe("nowhere.txt");
    expect(existsSync(target)).toBe(false);
  });

  it("refuses an existing symlink at the target and leaves it pointing where it did", () => {
    // `cpSync`'s `errorOnExist` refuses an existing file or directory at the target but silently
    // replaces an existing symlink there - confirmed against this Bun runtime - and every backup
    // name this function claims can itself already be a symlink from an earlier run. That is the
    // collision `copySymlinkToNewPath`'s `readlink` + `symlink` primitive closes.
    const root = createTempRoot();
    const real = join(root, "real.txt");
    const other = join(root, "other.txt");
    const source = join(root, "source-link");
    const target = join(root, "target-link");
    writeFileSync(real, "new content");
    writeFileSync(other, "other content, must survive");
    symlinkSync(real, source);
    symlinkSync(other, target);

    expect(copyToNewPath(source, target)).toBe(false);
    expect(readFileSync(target, "utf-8")).toBe("other content, must survive");
  });

  it("refuses an existing *dangling* symlink at the target and leaves it pointing where it did", () => {
    // The same collision one step nastier: the occupying link resolves to nothing, so any check
    // phrased as "does something exist at the target" reads the path as free. Only a primitive
    // that refuses on the link itself - `symlinkSync`'s EEXIST - holds here.
    const root = createTempRoot();
    const real = join(root, "real.txt");
    const source = join(root, "source-link");
    const target = join(root, "target-link");
    writeFileSync(real, "new content");
    symlinkSync(real, source);
    symlinkSync("nowhere.txt", target);

    expect(copyToNewPath(source, target)).toBe(false);
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    expect(readlinkSync(target)).toBe("nowhere.txt");
  });
});

describe("filesystemIdentity", () => {
  it("returns undefined for a path that does not exist", () => {
    const root = createTempRoot();
    expect(filesystemIdentity(join(root, "missing"))).toBeUndefined();
  });

  it("resolves an existing path and agrees through a symlink to the same target", () => {
    const root = createTempRoot();
    const real = join(root, "real.txt");
    const link = join(root, "link.txt");
    writeFileSync(real, "content");
    symlinkSync(real, link);

    const realIdentity = filesystemIdentity(real);
    expect(realIdentity).toBeDefined();
    expect(filesystemIdentity(link)).toBe(realIdentity);
  });
});

describe("copyPlatformContents: destination symlink refusal", () => {
  it("replaces a destination symlink as a link, never following it into what it points at", () => {
    const root = createTempRoot();
    const sourceDir = join(root, "source");
    const targetDir = join(root, "target");
    const escapeDir = join(root, "escape");
    mkdirSync(join(sourceDir, "docs"), { recursive: true });
    writeFileSync(join(sourceDir, "docs", "page.md"), "generated page");
    mkdirSync(targetDir, { recursive: true });
    mkdirSync(escapeDir, { recursive: true });
    writeFileSync(join(escapeDir, "sentinel.txt"), "must not be touched");
    symlinkSync(escapeDir, join(targetDir, "docs"));

    copyPlatformContents(sourceDir, targetDir);

    // The link is gone, replaced by a real directory holding the generated content...
    expect(lstatSync(join(targetDir, "docs")).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(targetDir, "docs", "page.md"), "utf-8")).toBe("generated page");
    // ...and whatever the link pointed at was never written through.
    expect(existsSync(join(escapeDir, "page.md"))).toBe(false);
    expect(readFileSync(join(escapeDir, "sentinel.txt"), "utf-8")).toBe("must not be touched");
  });
});

describe("copyPlatformContents: sweep runs before copy", () => {
  it("lets a type change (directory -> file) succeed once the sweep has cleared what was recorded inside it", () => {
    const root = createTempRoot();
    const sourceDir = join(root, "source");
    const targetDir = join(root, "target");
    mkdirSync(join(targetDir, "foo"), { recursive: true });
    writeFileSync(join(targetDir, "foo", "stale.txt"), "stale");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "foo"), "new file content");

    // "foo/stale.txt" was the only thing recorded inside the old "foo" directory and is not
    // current any more; nothing records "foo" itself as current since the source now wants it to
    // be a plain file. If the sweep ran after the copy instead of before, the type-change replace
    // below would find a non-empty directory still in its way and abort the whole install.
    expect(() =>
      copyPlatformContents(sourceDir, targetDir, {
        pruneExtraNames: true,
        previouslyManagedRootEntries: ["foo/stale.txt"],
        currentManagedRootEntries: [],
      }),
    ).not.toThrow();

    expect(lstatSync(join(targetDir, "foo")).isFile()).toBe(true);
    expect(readFileSync(join(targetDir, "foo"), "utf-8")).toBe("new file content");
  });
});

describe("copyPlatformContents: prune sweep", () => {
  it("removes a stale previously-managed file while leaving an unmanaged sibling untouched", () => {
    const root = createTempRoot();
    const sourceDir = join(root, "source");
    const targetDir = join(root, "target");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "current.txt"), "current");
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "stale.txt"), "stale");
    writeFileSync(join(targetDir, "keep-me.txt"), "user file, never recorded");

    copyPlatformContents(sourceDir, targetDir, {
      pruneExtraNames: true,
      previouslyManagedRootEntries: ["stale.txt"],
      currentManagedRootEntries: ["current.txt"],
    });

    expect(existsSync(join(targetDir, "stale.txt"))).toBe(false);
    expect(readFileSync(join(targetDir, "keep-me.txt"), "utf-8")).toBe("user file, never recorded");
    expect(readFileSync(join(targetDir, "current.txt"), "utf-8")).toBe("current");
  });

  it("leaves a non-empty stale directory alone rather than deleting its contents", () => {
    const root = createTempRoot();
    const sourceDir = join(root, "source");
    const targetDir = join(root, "target");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(join(targetDir, "stale-dir"), { recursive: true });
    writeFileSync(join(targetDir, "stale-dir", "unmanaged.txt"), "user content");

    copyPlatformContents(sourceDir, targetDir, {
      pruneExtraNames: true,
      previouslyManagedRootEntries: ["stale-dir"],
      currentManagedRootEntries: [],
    });

    expect(readFileSync(join(targetDir, "stale-dir", "unmanaged.txt"), "utf-8")).toBe("user content");
  });

  it("does not throw when a previously-managed path is already gone", () => {
    const root = createTempRoot();
    const sourceDir = join(root, "source");
    const targetDir = join(root, "target");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });

    expect(() =>
      copyPlatformContents(sourceDir, targetDir, {
        pruneExtraNames: true,
        previouslyManagedRootEntries: ["ghost.txt"],
        currentManagedRootEntries: [],
      }),
    ).not.toThrow();
  });

  it("removes an emptied directory chain deepest-first, so the whole chain is cleared in one pass", () => {
    const root = createTempRoot();
    const sourceDir = join(root, "source");
    const targetDir = join(root, "target");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(join(targetDir, "a", "b", "c"), { recursive: true });
    writeFileSync(join(targetDir, "a", "x.txt"), "x");
    writeFileSync(join(targetDir, "a", "b", "c", "y.txt"), "y");

    copyPlatformContents(sourceDir, targetDir, {
      pruneExtraNames: true,
      // "a/x.txt" is recorded before the deeper "a/b/c/y.txt": without deepest-first cleanup of
      // the emptied parents, "a" is visited while "a/b" still exists and its removal is skipped.
      previouslyManagedRootEntries: ["a/x.txt", "a/b/c/y.txt"],
      currentManagedRootEntries: [],
    });

    expect(existsSync(join(targetDir, "a"))).toBe(false);
  });
});

describe("copyPlatformContents: type-change replace refuses a non-empty directory", () => {
  it("aborts with InstallError and leaves the directory's content untouched", () => {
    const root = createTempRoot();
    const sourceDir = join(root, "source");
    const targetDir = join(root, "target");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "bar"), "generated file");
    mkdirSync(join(targetDir, "bar"), { recursive: true });
    writeFileSync(join(targetDir, "bar", "user-file.txt"), "user content, unrecorded");

    expect(() => copyPlatformContents(sourceDir, targetDir)).toThrow(InstallError);
    expect(lstatSync(join(targetDir, "bar")).isDirectory()).toBe(true);
    expect(readFileSync(join(targetDir, "bar", "user-file.txt"), "utf-8")).toBe("user content, unrecorded");
  });
});

describe("copyLeaf: exclusive create (via __test seam)", () => {
  it("refuses to write through a target that exists when it runs, rather than overwriting it", () => {
    const root = createTempRoot();
    const source = join(root, "source.txt");
    const target = join(root, "target.txt");
    writeFileSync(source, "generated content");
    // The caller (copyIntoTarget) removes whatever was at the target moments before calling this;
    // a real race cannot be scripted deterministically, so this stands in for "something arrived in
    // the gap" by simply having something already there when copyLeaf runs.
    writeFileSync(target, "arrived after the caller's removal");

    expect(() => copyLeaf(source, target)).toThrow(InstallError);
    expect(readFileSync(target, "utf-8")).toBe("arrived after the caller's removal");
  });
});

describe("unlinkManagedEntry: refuses a directory (via __test seam)", () => {
  it("throws InstallError rather than unlinking a directory, and leaves its contents untouched", () => {
    const root = createTempRoot();
    const dirPath = join(root, "managed-dir");
    mkdirSync(dirPath, { recursive: true });
    writeFileSync(join(dirPath, "content.txt"), "still here");

    expect(() => unlinkManagedEntry(dirPath)).toThrow(InstallError);
    expect(readFileSync(join(dirPath, "content.txt"), "utf-8")).toBe("still here");
  });
});
