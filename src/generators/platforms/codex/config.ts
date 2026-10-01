import type { McpServer } from "../../../schema.js";
import { translateEnvVar } from "../../../utils/env-var.js";
import { mcpServerEnabled, mcpServersFor } from "../../../utils/mcp-block.js";
import { toTomlKey, toTomlTableHeader } from "../../shared/keys.js";
import type { ProjectBundle } from "../../types.js";
import { toTomlString } from "./format.js";

const EXACT_ENV_PLACEHOLDER = /^\$\{(\w+)\}$/;
const BEARER_ENV_PLACEHOLDER = /^Bearer \$\{(\w+)\}$/;

/**
 * `bearer_token_env_var` for `Authorization: Bearer ${VAR}`, `env_http_headers` for an exact `${VAR}`,
 * `http_headers` for everything else - Codex does not interpolate inside a header value.
 */
function codexHttpHeaderLines(headers: Record<string, string> | undefined): string[] {
  if (!headers || Object.keys(headers).length === 0) return [];

  const lines: string[] = [];
  const envHeaders: Array<[string, string]> = [];
  const staticHeaders: Array<[string, string]> = [];
  let bearerVar: string | undefined;

  for (const [headerName, headerValue] of Object.entries(headers)) {
    const bearerMatch = headerName.toLowerCase() === "authorization" ? BEARER_ENV_PLACEHOLDER.exec(headerValue) : null;
    if (bearerMatch && !bearerVar) {
      bearerVar = bearerMatch[1];
      continue;
    }
    const envMatch = EXACT_ENV_PLACEHOLDER.exec(headerValue);
    if (envMatch) {
      envHeaders.push([headerName, envMatch[1]!]);
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

function pushEnabledLine(lines: string[], server: McpServer): void {
  const enabled = mcpServerEnabled(server);
  if (enabled !== undefined) lines.push(`enabled = ${enabled}`);
}

export function buildCodexConfigToml(project: ProjectBundle): string {
  const lines: string[] = [];

  const approvalMode = project.permissions?.codex?.approvalMode;
  if (approvalMode) lines.push(`approval_policy = ${toTomlString(approvalMode)}`);

  const sandbox = project.permissions?.codex?.sandbox;
  if (sandbox) {
    if (lines.length > 0) lines.push("");
    lines.push("[windows]");
    lines.push(`sandbox = ${toTomlString(sandbox)}`);
    lines.push("");
  }

  const trustedProjects = project.permissions?.codex?.trustedProjects ?? {};
  for (const [path, level] of Object.entries(trustedProjects)) {
    if (lines.length > 0 && lines.at(-1) !== "") lines.push("");
    lines.push(toTomlTableHeader("projects", path));
    lines.push(`trust_level = ${toTomlString(level)}`);
    lines.push("");
  }

  for (const [name, server] of mcpServersFor(project.mcp, "codex")) {
    if (server.type === "local") {
      lines.push(toTomlTableHeader("mcp_servers", name));
      if (server.command) lines.push(`command = ${toTomlString(server.command)}`);
      if (server.args) {
        const args = server.args.map((a) => toTomlString(translateEnvVar(a, "codex"))).join(", ");
        lines.push(`args = [${args}]`);
      }
      pushEnabledLine(lines, server);
      if (server.env) {
        lines.push("");
        lines.push(toTomlTableHeader("mcp_servers", name, "env"));
        for (const [k, v] of Object.entries(server.env)) {
          lines.push(`${toTomlKey(k)} = ${toTomlString(translateEnvVar(v, "codex"))}`);
        }
      }
      lines.push("");
    } else if (server.url) {
      lines.push(toTomlTableHeader("mcp_servers", name));
      lines.push(`url = ${toTomlString(server.url)}`);
      for (const headerLine of codexHttpHeaderLines(server.headers)) lines.push(headerLine);
      pushEnabledLine(lines, server);
      lines.push("");
    } else if (server.localFallback) {
      lines.push(toTomlTableHeader("mcp_servers", name));
      lines.push(`command = ${toTomlString(server.localFallback.command)}`);
      const args = server.localFallback.args.map((a) => toTomlString(translateEnvVar(a, "codex"))).join(", ");
      lines.push(`args = [${args}]`);
      pushEnabledLine(lines, server);
      lines.push("");
    }
  }

  return lines.join("\n");
}
