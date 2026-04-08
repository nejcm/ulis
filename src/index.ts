import { join, resolve } from "node:path";

import { generateClaude } from "./generators/claude.js";
import { generateCodex } from "./generators/codex.js";
import { generateCursor } from "./generators/cursor.js";
import { generateOpencode } from "./generators/opencode.js";
import { parseAgents } from "./parsers/agent.js";
import { parseSkills } from "./parsers/skill.js";
import { McpConfigSchema, PluginsConfigSchema } from "./schema.js";
import { loadBuildConfig } from "./utils/build-config.js";
import { readFile } from "./utils/fs.js";
import { log } from "./utils/logger.js";
import { validateCollisions } from "./validators/collisions.js";
import { validateCrossRefs, type Diagnostic } from "./validators/cross-refs.js";

const args = process.argv.slice(2);
const targetIdx = args.indexOf("--target");
const targetFilter = targetIdx !== -1 ? args[targetIdx + 1] : undefined;

const aiDir = resolve(join(import.meta.dirname, "..", ".ai"));
const generatedDir = resolve(join(import.meta.dirname, "..", "generated"));

log.header("AI Config Build System");
log.info(`Source: ${aiDir}`);
log.info(`Output: ${generatedDir}`);
if (targetFilter) log.info(`Target: ${targetFilter}`);

// Parse canonical sources
log.header("Parsing");

const agents = parseAgents(join(aiDir, "agents"));
log.success(`Parsed ${agents.length} agents`);

const skills = parseSkills(join(aiDir, "skills"));
log.success(`Parsed ${skills.length} skills`);

const mcp = McpConfigSchema.parse(JSON.parse(readFile(join(aiDir, "mcp.json"))));
log.success(`Parsed ${Object.keys(mcp.servers).length} MCP servers`);

const plugins = PluginsConfigSchema.parse(JSON.parse(readFile(join(aiDir, "plugins.json"))));
log.success(`Parsed plugins config`);

const buildConfig = loadBuildConfig(aiDir);
log.success(`Loaded build config`);

// Validate the bundle before touching the filesystem.
log.header("Validation");

const diagnostics: readonly Diagnostic[] = [
  ...validateCrossRefs(agents, skills, mcp),
  ...validateCollisions(agents, skills),
];

for (const d of diagnostics) {
  const line = `[${d.entity}] ${d.message}${d.suggestion ? ` — ${d.suggestion}` : ""}`;
  if (d.level === "error") log.error(line);
  else log.warn(line);
}

const errorCount = diagnostics.filter((d) => d.level === "error").length;
const warnCount = diagnostics.length - errorCount;

if (errorCount > 0) {
  log.error(`Validation failed: ${errorCount} error(s), ${warnCount} warning(s). No files written.`);
  process.exit(1);
}
log.success(`Validation passed (${warnCount} warning(s))`);

// Generate per-tool configs
const targets = ["opencode", "claude", "codex", "cursor"];
const activeTargets = targetFilter ? targets.filter((t) => t === targetFilter) : targets;

for (const target of activeTargets) {
  const outDir = join(generatedDir, target);
  switch (target) {
    case "opencode":
      generateOpencode(agents, skills, mcp, plugins, aiDir, outDir, buildConfig);
      break;
    case "claude":
      generateClaude(agents, skills, mcp, plugins, aiDir, outDir, buildConfig);
      break;
    case "codex":
      generateCodex(agents, skills, mcp, aiDir, outDir, buildConfig);
      break;
    case "cursor":
      generateCursor(agents, skills, mcp, aiDir, outDir, buildConfig);
      break;
  }
}

log.header("Build Complete");
log.success(`Generated configs for: ${activeTargets.join(", ")}`);
