import { describe, it, expect } from "bun:test";

import {
  formatContextHintsComment,
  formatToolPolicyComment,
  formatSecurityComment,
  buildPolicyCommentBlock,
} from "./policy-comments.js";

describe("formatContextHintsComment", () => {
  it("emits TOML comment with all fields", () => {
    const out = formatContextHintsComment(
      { maxInputTokens: 50000, priority: "high", excludeFromContext: ["*.log", "dist/"] },
      "toml",
    );
    expect(out).toContain("# [ULIS contextHints]");
    expect(out).toContain("#   maxInputTokens: 50000");
    expect(out).toContain("#   priority: high");
    expect(out).toContain("#   excludeFromContext: *.log, dist/");
  });

  it("emits HTML comment for md syntax", () => {
    const out = formatContextHintsComment({ maxInputTokens: 10000, priority: "normal" }, "md");
    expect(out).toContain("<!--");
    expect(out).toContain("-->");
    expect(out).toContain("[ULIS contextHints]");
    expect(out).toContain("maxInputTokens: 10000");
    // "normal" priority is not emitted (default)
    expect(out).not.toContain("priority: normal");
  });

  it("omits normal priority", () => {
    const out = formatContextHintsComment({ priority: "normal" }, "md");
    expect(out).not.toContain("priority");
  });
});

describe("formatToolPolicyComment", () => {
  it("emits prefer/avoid/requireConfirmation", () => {
    const out = formatToolPolicyComment(
      { prefer: ["Read"], avoid: ["Bash"], requireConfirmation: ["Write", "Edit"] },
      "toml",
    );
    expect(out).toContain("prefer: Read");
    expect(out).toContain("avoid: Bash");
    expect(out).toContain("requireConfirmation: Write, Edit");
  });

  it("emits mdc (same as md — HTML comment)", () => {
    const out = formatToolPolicyComment({ prefer: ["Grep"] }, "mdc");
    expect(out).toContain("<!--");
    expect(out).toContain("prefer: Grep");
  });
});

describe("formatSecurityComment", () => {
  it("emits security fields", () => {
    const out = formatSecurityComment(
      {
        permissionLevel: "readonly",
        blockedCommands: ["rm -rf", "git push --force"],
        restrictedPaths: ["secrets/"],
        requireApproval: ["bash"],
        rateLimit: { perHour: 10 },
      },
      "md",
    );
    expect(out).toContain("permissionLevel: readonly");
    expect(out).toContain("blockedCommands: rm -rf, git push --force");
    expect(out).toContain("restrictedPaths: secrets/");
    expect(out).toContain("requireApproval: bash");
    expect(out).toContain("rateLimit: 10/hour");
  });

  it("omits 'readwrite' permissionLevel (default)", () => {
    const out = formatSecurityComment({ permissionLevel: "readwrite" }, "toml");
    expect(out).not.toContain("permissionLevel");
  });
});

describe("buildPolicyCommentBlock", () => {
  it("returns empty string when no fields set", () => {
    const out = buildPolicyCommentBlock({}, "md");
    expect(out).toBe("");
  });

  it("concatenates multiple blocks", () => {
    const out = buildPolicyCommentBlock(
      {
        contextHints: { maxInputTokens: 5000, priority: "low" },
        toolPolicy: { avoid: ["Bash"] },
      },
      "md",
    );
    expect(out).toContain("contextHints");
    expect(out).toContain("toolPolicy");
    expect(out).toContain("avoid: Bash");
    expect(out).toContain("priority: low");
  });

  it("omits absent fields silently", () => {
    const out = buildPolicyCommentBlock({ toolPolicy: { prefer: ["Read"] } }, "toml");
    expect(out).not.toContain("contextHints");
    expect(out).not.toContain("security");
    expect(out).toContain("prefer: Read");
  });
});
