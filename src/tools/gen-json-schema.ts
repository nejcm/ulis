/**
 * Generates JSON Schema files from the ULIS Zod schemas.
 * Output: dist/schemas/{entity}.schema.json (bundled in CLI tarball) and
 * schemas/{entity}.schema.json (package root; stable `$schema` path via exports).
 *
 * Usage: bun run gen:schemas
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { z } from "zod";

import {
  AgentFrontmatterSchema,
  McpConfigSchema,
  PermissionsConfigSchema,
  PluginsConfigSchema,
  PresetMetaSchema,
  SkillFrontmatterSchema,
  SkillsConfigSchema,
  UlisConfigSchema,
} from "../schema.js";

const repoRoot = resolve(join(import.meta.dirname, "../.."));
const outDir = join(repoRoot, "dist", "schemas");
/** Published alongside `dist/` so `$schema` can use `./node_modules/@nejcm/ulis/schemas/*.schema.json`. */
const publishSchemasDir = join(repoRoot, "schemas");
mkdirSync(outDir, { recursive: true });
mkdirSync(publishSchemasDir, { recursive: true });

const schemas: Array<{ name: string; schema: z.ZodType }> = [
  { name: "config", schema: UlisConfigSchema },
  { name: "agent", schema: AgentFrontmatterSchema },
  { name: "skill", schema: SkillFrontmatterSchema },
  { name: "mcp", schema: McpConfigSchema },
  { name: "plugins", schema: PluginsConfigSchema },
  { name: "skills", schema: SkillsConfigSchema },
  { name: "permissions", schema: PermissionsConfigSchema },
  { name: "preset", schema: PresetMetaSchema },
];

for (const { name, schema } of schemas) {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" });
  const body = JSON.stringify(jsonSchema, null, 2) + "\n";
  const distPath = join(outDir, `${name}.schema.json`);
  const publishPath = join(publishSchemasDir, `${name}.schema.json`);
  writeFileSync(distPath, body);
  writeFileSync(publishPath, body);
  console.log(`  wrote dist/schemas/${name}.schema.json + schemas/${name}.schema.json`);
}

console.log(`\nDone. ${schemas.length} schemas written.`);
