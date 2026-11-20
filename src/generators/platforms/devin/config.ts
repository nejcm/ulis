import type { PermissionsConfig } from "../../../schema.js";
import type { FileArtifact } from "../../types.js";

export function buildDevinConfigArtifacts(permissions: PermissionsConfig | undefined): FileArtifact[] {
  const devin = permissions?.devin;
  if (!devin) return [];
  // All three lists, so the install overlay replaces the saved ones instead of merging into them.
  const config = { permissions: { allow: devin.allow ?? [], deny: devin.deny ?? [], ask: devin.ask ?? [] } };
  return [{ path: "config.json", contents: JSON.stringify(config, null, 2) }];
}
