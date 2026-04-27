import { PLATFORMS, type Platform, uniquePlatforms } from "./platforms.js";

export interface WorkflowPlan {
  readonly buildTargets: readonly Platform[];
  readonly installTargets: readonly Platform[];
}

/**
 * Resolve the workflow plan where build targets include everything that may be installed.
 */
export function resolveWorkflowPlan(
  generateTargets: readonly Platform[],
  installTargets: readonly Platform[],
): WorkflowPlan {
  return {
    buildTargets: uniquePlatforms([...generateTargets, ...installTargets]),
    installTargets: uniquePlatforms(installTargets),
  };
}

/**
 * Toggle one platform selection while preserving canonical platform ordering.
 */
export function togglePlatformSelection(selected: readonly Platform[], platform: Platform): Platform[] {
  const next = new Set(selected);
  if (next.has(platform)) {
    next.delete(platform);
  } else {
    next.add(platform);
  }

  return uniquePlatforms([...next]);
}

/**
 * Toggle between selecting all supported platforms and selecting none.
 */
export function toggleAllPlatformSelections(selected: readonly Platform[]): Platform[] {
  return selected.length === PLATFORMS.length ? [] : [...PLATFORMS];
}
