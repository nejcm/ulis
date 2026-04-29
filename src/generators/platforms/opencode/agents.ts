import { join } from "node:path";

import type { ParsedAgent } from "../../../parsers/agent.js";
import { buildPolicyCommentBlock } from "../../../utils/policy-comments.js";
import type { FileArtifact } from "../../types.js";

export function buildOpencodeAgentBodyArtifact(agent: ParsedAgent): FileArtifact {
  const isCore = agent.frontmatter.tags.includes("core");
  const destDir = isCore ? join("agents", "core") : join("agents", "specialized");
  const commentOnlyHints = agent.frontmatter.contextHints ? { contextHints: agent.frontmatter.contextHints } : {};
  const commentOnlySec = agent.frontmatter.security?.restrictedPaths?.length
    ? { security: { ...agent.frontmatter.security, blockedCommands: [], requireApproval: [] } }
    : {};
  const policyBlock = buildPolicyCommentBlock({ ...commentOnlyHints, ...commentOnlySec }, "md");
  const body = policyBlock ? `${policyBlock}\n${agent.body}` : agent.body;
  return { path: join(destDir, `${agent.name}.md`), contents: body };
}
