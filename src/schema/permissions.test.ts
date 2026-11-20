import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { PermissionsConfigSchema } from "./permissions.js";

const repoRoot = join(import.meta.dirname, "../..");
const platforms = Object.keys(
  (z.toJSONSchema(PermissionsConfigSchema, { target: "draft-7", io: "input" }) as { properties: object }).properties,
);

describe("permissions.yaml examples", () => {
  it.each(["docs/guide/examples.md", "skills/ulis/references/source.md"])("%s shows every platform block", (file) => {
    const section = /^## Permissions\b[\s\S]*?(?=^## )/m.exec(readFileSync(join(repoRoot, file), "utf8"))?.[0] ?? "";
    expect(platforms.filter((platform) => !new RegExp(`^${platform}:$`, "m").test(section))).toEqual([]);
  });
});
