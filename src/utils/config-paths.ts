export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export type ConfigPath = readonly string[];

export function pickConfigPaths(source: unknown, paths: readonly ConfigPath[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const path of paths) {
    if (path.length === 0) {
      if (isPlainObject(source)) {
        for (const [key, value] of Object.entries(source)) setConfigPath(result, [key], value);
      }
      continue;
    }
    const value = getConfigPath(source, path);
    if (value !== undefined) setConfigPath(result, path, value);
  }
  return result;
}

/** Copy `source` with the given paths removed, preserving atomic values. */
export function omitConfigPaths(source: unknown, paths: readonly ConfigPath[]): Record<string, unknown> {
  if (!isPlainObject(source)) return {};
  // Empty path => caller wants to drop the entire object; honor it.
  if (paths.some((p) => p.length === 0)) return {};
  const result = { ...source };
  for (const path of paths) {
    deleteConfigPath(result, path);
  }
  return result;
}

function deleteConfigPath(target: Record<string, unknown>, path: readonly string[]): void {
  if (path.length === 0) return;
  let current: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    if (!Object.hasOwn(current, path[i]!)) return;
    const next = current[path[i]!];
    if (!isPlainObject(next)) return;
    current = current[path[i]!] = { ...next };
  }
  delete current[path[path.length - 1]!];
}

export function getConfigPath(source: unknown, path: readonly string[]): unknown {
  let current = source;
  for (const key of path) {
    if (!isPlainObject(current) || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

function setConfigPath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let current = target;
  for (const key of path.slice(0, -1)) {
    const next = Object.hasOwn(current, key) ? current[key] : undefined;
    if (isPlainObject(next)) {
      current = next;
    } else {
      const created: Record<string, unknown> = {};
      Object.defineProperty(current, key, { value: created, enumerable: true, writable: true, configurable: true });
      current = created;
    }
  }
  Object.defineProperty(current, path[path.length - 1]!, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
