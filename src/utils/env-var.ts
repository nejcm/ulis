/**
 * Translate canonical ${VAR} syntax to tool-specific format.
 *
 * Targets:
 * - opencode_header: ${VAR} → {env:VAR}  (OpenCode remote server headers)
 * - opencode_env:    ${VAR} → ${VAR}     (OpenCode local server environment)
 * - codex:           ${VAR} → ${VAR}     (Codex stdio args / env values)
 * - codex_header:    ${VAR} → VAR        (Codex env_http_headers — value is just the var name)
 * - cursor:          ${VAR} → ${VAR}
 * - claude:          ${VAR} → ${VAR}
 * - forgecode:       ${VAR} → ${VAR}
 */
export function translateEnvVar(
  value: string,
  target: "opencode_env" | "opencode_header" | "codex" | "codex_header" | "cursor" | "claude" | "forgecode",
): string {
  return value.replace(/\$\{(\w+)\}/g, (_match, varName) => {
    switch (target) {
      case "opencode_header":
        return `{env:${varName}}`;
      case "codex_header":
        return varName;
      case "opencode_env":
      case "codex":
      case "cursor":
      case "claude":
      case "forgecode":
        return `\${${varName}}`;
      default:
        return `\${${varName}}`;
    }
  });
}
