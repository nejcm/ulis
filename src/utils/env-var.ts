/**
 * Translate canonical ${VAR} syntax to tool-specific format.
 *
 * Targets:
 * - opencode_header: ${VAR} → {env:VAR}  (OpenCode remote server headers)
 * - opencode_env:    ${VAR} → {env:VAR}  (OpenCode local server environment)
 * - codex:           ${VAR} → ${VAR}     (Codex stdio args / env values)
 * - cursor:          ${VAR} → ${env:VAR}  (Cursor mcp.json command, args, env, url, headers)
 * - claude:          ${VAR} → ${VAR}
 * - forgecode:       ${VAR} → ${VAR}
 * - antigravity:     ${VAR} → ${VAR}     (verbatim; Antigravity documents no interpolation)
 * - hermes:          ${VAR} → ${VAR}     (verbatim; Hermes interpolates from env and ~/.hermes/.env)
 */
export function translateEnvVar(
  value: string,
  target: "opencode_env" | "opencode_header" | "codex" | "cursor" | "claude" | "forgecode" | "antigravity" | "hermes",
): string {
  return value.replace(/\$\{(\w+)\}/g, (_match, varName) => {
    switch (target) {
      case "opencode_env":
      case "opencode_header":
        return `{env:${varName}}`;
      case "cursor":
        return `\${env:${varName}}`;
      case "codex":
      case "claude":
      case "forgecode":
      case "antigravity":
      case "hermes":
        return `\${${varName}}`;
      default:
        return `\${${varName}}`;
    }
  });
}
