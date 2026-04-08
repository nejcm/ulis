/**
 * Generates JSON Schema files from the ULIS Zod schemas.
 * Output: schemas/{entity}.json
 *
 * Usage: bun run gen:schemas
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { zodToJsonSchema } from "zod-to-json-schema";

import { AgentFrontmatterSchema, SkillFrontmatterSchema, McpConfigSchema, PluginsConfigSchema } from "../schema.js";

const outDir = resolve(join(import.meta.dirname, "../..", "schemas"));
mkdirSync(outDir, { recursive: true });

const schemas: Array<{ name: string; schema: unknown }> = [
  { name: "agent", schema: AgentFrontmatterSchema },
  { name: "skill", schema: SkillFrontmatterSchema },
  { name: "mcp", schema: McpConfigSchema },
  { name: "plugins", schema: PluginsConfigSchema },
];

for (const { name, schema } of schemas) {
  const jsonSchema = zodToJsonSchema(schema as Parameters<typeof zodToJsonSchema>[0], {
    name,
    $refStrategy: "none",
    errorMessages: false,
  });
  const outPath = join(outDir, `${name}.json`);
  writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2) + "\n");
  console.log(`  wrote schemas/${name}.json`);
}

console.log(`\nDone. ${schemas.length} schemas written to schemas/`);
