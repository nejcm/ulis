import { translateEnvVar } from "../../../utils/env-var.js";
import { mcpServersFor } from "../../../utils/mcp-block.js";
import type { ProjectBundle } from "../../types.js";
import { toTomlString } from "./format.js";

const CODEX_DEFAULT_MODEL = "gpt-5.4";
const CODEX_DEFAULT_MODEL_REASONING_EFFORT = "high";
const CODEX_DEFAULT_SANDBOX = "elevated";
const CODEX_DEFAULT_MCP_STARTUP_TIMEOUT_SEC = 20;

/**
 * Codex distinguishes three HTTP header cases:
 * - `bearer_token_env_var`: header value is exactly `Bearer ${VAR}`
 * - `env_http_headers`:     table mapping header-name -> env-var-name (for `${VAR}` values)
 * - `http_headers`:         table of static key-value pairs
 */
function codexHttpHeaderLines(headers: Record<string, string> | undefined): string[] {
  if (!headers || Object.keys(headers).length === 0) return [];

  const lines: string[] = [];
  const envHeaders: Array<[string, string]> = [];
  const staticHeaders: Array<[string, string]> = [];
  let bearerVar: string | undefined;

  for (const [headerName, headerValue] of Object.entries(headers)) {
    const bearerMatch = headerValue.match(/^Bearer \$\{(\w+)\}$/);
    if (bearerMatch && !bearerVar) {
      bearerVar = bearerMatch[1];
      continue;
    }
    if (/\$\{(\w+)\}/.test(headerValue)) {
      envHeaders.push([headerName, translateEnvVar(headerValue, "codex_header")]);
      continue;
    }
    staticHeaders.push([headerName, headerValue]);
  }

  if (bearerVar) lines.push(`bearer_token_env_var = ${toTomlString(bearerVar)}`);
  if (staticHeaders.length > 0) {
    const pairs = staticHeaders.map(([k, v]) => `${toTomlString(k)} = ${toTomlString(v)}`).join(", ");
    lines.push(`http_headers = { ${pairs} }`);
  }
  if (envHeaders.length > 0) {
    const pairs = envHeaders.map(([k, v]) => `${toTomlString(k)} = ${toTomlString(v)}`).join(", ");
    lines.push(`env_http_headers = { ${pairs} }`);
  }

  return lines;
}

export function buildCodexConfigToml(project: ProjectBundle): string {
  const lines: string[] = [];
  lines.push(`model = ${toTomlString(CODEX_DEFAULT_MODEL)}`);
  lines.push(`model_reasoning_effort = ${toTomlString(CODEX_DEFAULT_MODEL_REASONING_EFFORT)}`);

  const approvalMode = project.permissions?.codex?.approvalMode;
  if (approvalMode) lines.push(`approval_policy = ${toTomlString(approvalMode)}`);

  lines.push("");
  lines.push("[windows]");
  const sandbox = project.permissions?.codex?.sandbox ?? CODEX_DEFAULT_SANDBOX;
  lines.push(`sandbox = ${toTomlString(sandbox)}`);
  lines.push("");

  const trustedProjects = project.permissions?.codex?.trustedProjects ?? {};
  for (const [path, level] of Object.entries(trustedProjects)) {
    lines.push(`[projects.'${path}']`);
    lines.push(`trust_level = ${toTomlString(level)}`);
    lines.push("");
  }

  for (const [name, server] of mcpServersFor(project.mcp, "codex")) {
    if (server.type === "local") {
      lines.push(`[mcp_servers.${name}]`);
      if (server.command) lines.push(`command = ${toTomlString(server.command)}`);
      if (server.args) {
        const args = server.args.map((a) => toTomlString(translateEnvVar(a, "codex"))).join(", ");
        lines.push(`args = [${args}]`);
      }
      lines.push(`startup_timeout_sec = ${CODEX_DEFAULT_MCP_STARTUP_TIMEOUT_SEC}`);
      if (server.env) {
        lines.push("");
        lines.push(`[mcp_servers.${name}.env]`);
        for (const [k, v] of Object.entries(server.env)) {
          lines.push(`${k} = ${toTomlString(translateEnvVar(v, "codex"))}`);
        }
      }
      lines.push("");
    } else if (server.url) {
      lines.push(`[mcp_servers.${name}]`);
      lines.push(`url = ${toTomlString(server.url)}`);
      for (const headerLine of codexHttpHeaderLines(server.headers)) lines.push(headerLine);
      lines.push(`startup_timeout_sec = ${CODEX_DEFAULT_MCP_STARTUP_TIMEOUT_SEC}`);
      lines.push("");
    } else if (server.localFallback) {
      lines.push(`[mcp_servers.${name}]`);
      lines.push(`command = ${toTomlString(server.localFallback.command)}`);
      const args = server.localFallback.args.map((a) => toTomlString(translateEnvVar(a, "codex"))).join(", ");
      lines.push(`args = [${args}]`);
      lines.push(`startup_timeout_sec = ${CODEX_DEFAULT_MCP_STARTUP_TIMEOUT_SEC}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}
