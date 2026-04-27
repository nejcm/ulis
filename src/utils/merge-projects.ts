import type { ParsedProject } from "../parsers/index.js";
import type { McpConfig, PermissionsConfig, PluginsConfig } from "../schema.js";

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

function mergePermissions(configs: readonly (PermissionsConfig | undefined)[]): PermissionsConfig | undefined {
  const defined = configs.filter((c): c is NonNullable<PermissionsConfig> => c != null);
  if (defined.length === 0) return undefined;

  // Last-wins merge for scalars; array concatenation for allow/deny/ask lists.
  const result: NonNullable<PermissionsConfig> = {};

  for (const config of defined) {
    if (config?.claude) {
      result.claude = {
        ...result.claude,
        ...config.claude,
        allow: [...(result.claude?.allow ?? []), ...(config.claude.allow ?? [])],
        deny: [...(result.claude?.deny ?? []), ...(config.claude.deny ?? [])],
        ask: [...(result.claude?.ask ?? []), ...(config.claude.ask ?? [])],
        additionalDirectories: [
          ...(result.claude?.additionalDirectories ?? []),
          ...(config.claude.additionalDirectories ?? []),
        ],
      };
    }
    if (config?.opencode) result.opencode = { ...result.opencode, ...config.opencode };
    if (config?.codex) result.codex = { ...result.codex, ...config.codex };
    if (config?.cursor) {
      result.cursor = {
        ...result.cursor,
        ...config.cursor,
        mcpAllowlist: [...(result.cursor?.mcpAllowlist ?? []), ...(config.cursor.mcpAllowlist ?? [])],
        terminalAllowlist: [...(result.cursor?.terminalAllowlist ?? []), ...(config.cursor.terminalAllowlist ?? [])],
      };
    }
  }

  return result;
}

function mergePlugins(configs: readonly (PluginsConfig | undefined)[]): PluginsConfig | undefined {
  const defined = configs.filter((c): c is NonNullable<PluginsConfig> => c != null);
  if (defined.length === 0) return undefined;

  const result: NonNullable<PluginsConfig> = {};
  for (const config of defined) {
    for (const key of Object.keys(config) as Array<keyof typeof config>) {
      const entry = config[key];
      if (!entry?.plugins) continue;
      const existing = result[key]?.plugins ?? [];
      result[key] = { plugins: [...existing, ...entry.plugins] };
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
    plugins: mergePlugins(projects.map((p) => p.plugins ?? undefined)),
    ulisConfig: base.ulisConfig,
    sourceDir: base.sourceDir,
  };
}
