import type { ParsedProject } from "../parsers/index.js";
import type { McpConfig, PermissionsConfig } from "../schema.js";

/**
 * Deduplicate an array of items by a string key. When duplicates exist, the
 * last occurrence wins (so base project entries survive over preset entries).
 */
function deduplicateByName<T extends { name: string }>(items: readonly T[]): readonly T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    seen.set(item.name, item);
  }
  return [...seen.values()];
}

function mergeMcp(configs: readonly McpConfig[]): McpConfig {
  const servers: McpConfig["servers"] = {};
  for (const config of configs) {
    Object.assign(servers, config.servers);
  }
  return { servers };
}

/**
 * Deduplicate a list while preserving first-occurrence order, so a single
 * source repeating an entry doesn't produce duplicate rule strings.
 */
function dedupeList(items: readonly string[] | undefined): string[] | undefined {
  if (items === undefined) return undefined;
  return [...new Set(items)];
}

function mergePermissions(configs: readonly (PermissionsConfig | undefined)[]): PermissionsConfig | undefined {
  const defined = configs.filter((c): c is NonNullable<PermissionsConfig> => c != null);
  if (defined.length === 0) return undefined;

  // Base-wins override for every field, including the allow/deny/ask/allowlist
  // lists: a layer that declares a list field replaces the value inherited
  // from lower layers outright (no append), and a layer that omits the field
  // leaves the inherited value untouched. The `{...a, ...b}` spread already
  // gives this for free — Zod omits undeclared optional keys rather than
  // setting them to `undefined` — but the list fields are spread out
  // explicitly below so "declared empty clears it, declaring dedupes it" is
  // visible in the code instead of relying on that spread behavior silently.
  const result: NonNullable<PermissionsConfig> = {};

  for (const config of defined) {
    if (config?.claude) {
      result.claude = {
        ...result.claude,
        ...config.claude,
        allow: dedupeList(config.claude.allow) ?? result.claude?.allow,
        deny: dedupeList(config.claude.deny) ?? result.claude?.deny,
        ask: dedupeList(config.claude.ask) ?? result.claude?.ask,
        additionalDirectories: dedupeList(config.claude.additionalDirectories) ?? result.claude?.additionalDirectories,
      };
    }
    if (config?.opencode) result.opencode = { ...result.opencode, ...config.opencode };
    if (config?.codex) result.codex = { ...result.codex, ...config.codex };
    if (config?.cursor) {
      result.cursor = {
        ...result.cursor,
        ...config.cursor,
        mcpAllowlist: dedupeList(config.cursor.mcpAllowlist) ?? result.cursor?.mcpAllowlist,
        terminalAllowlist: dedupeList(config.cursor.terminalAllowlist) ?? result.cursor?.terminalAllowlist,
      };
    }
  }

  return result;
}

/**
 * Merge an ordered list of ParsedProject objects. Later entries win for
 * scalars; arrays are deduplicated by name with the last occurrence winning.
 * Intended merge order: [preset0, preset1, ..., base] so the base always wins.
 */
export function mergeProjects(projects: readonly ParsedProject[]): ParsedProject {
  if (projects.length === 0) throw new Error("mergeProjects requires at least one project");
  if (projects.length === 1) return projects[0]!;

  const base = projects[projects.length - 1]!;

  const allAgents = projects.flatMap((p) => [...p.agents]);
  const allSkills = projects.flatMap((p) => [...p.skills]);
  const allRules = projects.flatMap((p) => [...p.rules]);

  return {
    agents: deduplicateByName(allAgents),
    skills: deduplicateByName(allSkills),
    rules: deduplicateByName(allRules),
    mcp: mergeMcp(projects.map((p) => p.mcp)),
    permissions: mergePermissions(projects.map((p) => p.permissions)),
    ulisConfig: base.ulisConfig,
    sourceDir: base.sourceDir,
    sourceDirs: projects.flatMap((project) => project.sourceDirs ?? [project.sourceDir]),
  };
}
