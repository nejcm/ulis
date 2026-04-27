import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadSkills } from "./skills.js";

describe("loadSkills", () => {
  it("returns empty config for empty skills.yaml", () => {
    const dir = mkdtempSync(join(tmpdir(), "ulis-skills-"));
    try {
      writeFileSync(join(dir, "skills.yaml"), "# intentionally empty\n");
      expect(loadSkills(dir)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
