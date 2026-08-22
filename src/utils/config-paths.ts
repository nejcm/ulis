export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ConfigPath = readonly string[];

export function pickConfigPaths(source: unknown, paths: readonly ConfigPath[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const path of paths) {
    if (path.length === 0) {
      if (isPlainObject(source)) Object.assign(result, source);
      continue;
    }
    const value = getConfigPath(source, path);
    if (value !== undefined) setConfigPath(result, path, value);
  }
  return result;
}

/**
 * Return a deep clone of `source` with the given paths removed. Used by the
 * `ownership: "paths"` preservation mode to capture "everything except the
 * paths ULIS owns" — the inverse of {@link pickConfigPaths}.
 */
export function omitConfigPaths(source: unknown, paths: readonly ConfigPath[]): Record<string, unknown> {
  if (!isPlainObject(source)) return {};
  // Empty path => caller wants to drop the entire object; honor it.
  if (paths.some((p) => p.length === 0)) return {};
  const result = structuredClone(source) as Record<string, unknown>;
  for (const path of paths) {
    deleteConfigPath(result, path);
  }
  return result;
}

function deleteConfigPath(target: Record<string, unknown>, path: readonly string[]): void {
  if (path.length === 0) return;
  let current: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    const next = current[path[i]!];
    if (!isPlainObject(next)) return;
    current = next;
  }
  delete current[path[path.length - 1]!];
}

export function getConfigPath(source: unknown, path: readonly string[]): unknown {
  let current = source;
  for (const key of path) {
    if (!isPlainObject(current) || !(key in current)) return undefined;
    current = current[key];
  }
  return current;
}

function setConfigPath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let current = target;
  for (const key of path.slice(0, -1)) {
    const next = current[key];
    if (isPlainObject(next)) {
      current = next;
    } else {
      const created: Record<string, unknown> = {};
      current[key] = created;
      current = created;
    }
  }
  current[path[path.length - 1]!] = value;
}
