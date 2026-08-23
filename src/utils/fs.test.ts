import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cleanupTempRoots, createTempRoot } from "../test-utils/fs.js";
import { cleanDir } from "./fs.js";

afterEach(cleanupTempRoots);

describe("cleanDir", () => {
  it("replaces self-referential, looping, and dangling symlinks", () => {
    const root = createTempRoot("ulis-fs-");
    const self = join(root, "self");
    const first = join(root, "first");
    const second = join(root, "second");
    const dangling = join(root, "dangling");

    symlinkSync("self", self);
    symlinkSync(second, first);
    symlinkSync(first, second);
    symlinkSync(join(root, "missing"), dangling);

    cleanDir(self);
    cleanDir(first);
    cleanDir(second);
    cleanDir(dangling);

    expect(lstatSync(self).isDirectory()).toBe(true);
    expect(lstatSync(first).isDirectory()).toBe(true);
    expect(lstatSync(second).isDirectory()).toBe(true);
    expect(lstatSync(dangling).isDirectory()).toBe(true);
  });

  it("replaces a file and does not delete a symlink target", () => {
    const root = createTempRoot("ulis-fs-");
    const file = join(root, "file");
    const target = join(root, "target");
    const link = join(root, "link");
    const contents = join(target, "keep.txt");

    writeFileSync(file, "replace me");
    mkdirSync(target);
    writeFileSync(contents, "keep me");
    symlinkSync(target, link);

    cleanDir(file);
    cleanDir(link);

    expect(lstatSync(file).isDirectory()).toBe(true);
    expect(lstatSync(link).isDirectory()).toBe(true);
    expect(existsSync(contents)).toBe(true);
    expect(readFileSync(contents, "utf-8")).toBe("keep me");
  });

  it("replaces an empty directory that is not writable", () => {
    const root = createTempRoot("ulis-fs-");
    const output = join(root, "output");

    mkdirSync(output);
    chmodSync(output, 0o555);

    cleanDir(output);

    expect(lstatSync(output).isDirectory()).toBe(true);
  });
});
