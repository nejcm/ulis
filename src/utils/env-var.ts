/**
 * Translate canonical ${VAR} syntax to tool-specific format.
 *
 * Targets:
 * - opencode_header: ${VAR} → {env:VAR}  (OpenCode remote server headers)
 * - opencode_env:    ${VAR} → ${VAR}     (OpenCode local server environment)
 * - codex:           ${VAR} → ${VAR}     (Codex stdio args / env values)
 * - cursor:          ${VAR} → ${env:VAR}  (Cursor mcp.json command, args, env, url, headers)
 * - claude:          ${VAR} → ${VAR}
 * - forgecode:       ${VAR} → ${VAR}
 */
export function translateEnvVar(
  value: string,
  target: "opencode_env" | "opencode_header" | "codex" | "cursor" | "claude" | "forgecode",
): string {
  return value.replace(/\$\{(\w+)\}/g, (_match, varName) => {
    switch (target) {
      case "opencode_header":
        return `{env:${varName}}`;
      case "cursor":
        return `\${env:${varName}}`;
      case "opencode_env":
      case "codex":
      case "claude":
      case "forgecode":
        return `\${${varName}}`;
      default:
        return `\${${varName}}`;
    }
  });
}
