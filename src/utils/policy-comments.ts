import type { ContextHints, ToolPolicy, SecurityPolicy } from "../schema.js";

/**
 * Formats contextHints, toolPolicy, and security as a comment block.
 * Used as the polyfill for targets that have no native support for these fields.
 *
 * @param syntax - Comment style for the target format
 */
export type CommentSyntax = "md" | "toml" | "mdc";

/** Keep source-controlled prose visible without letting it open a new line or HTML comment. */
export function sanitizeInstructionText(value: string): string {
  const escaped = value
    .replace(/[\u0000-\u001f\u007f]/gu, (character) =>
      character === "\u007f" ? "\\u007f" : JSON.stringify(character).slice(1, -1),
    )
    .replaceAll("<!--", "<\\!--")
    .replaceAll("-->", "--\\>")
    .replaceAll("--!>", "--!\\>");
  // Backslashes stay literal so Windows restricted paths remain readable. Tradeoff: a literal
  // escape and the character escaped above render alike in this human/model-facing prose.
  return value.trim().length === 0 ? `"${escaped}"` : escaped;
}

function makeComment(line: string, syntax: CommentSyntax): string {
  if (syntax === "toml") return `# ${line}`;
  // md and mdc both use HTML comments block (accumulated outside this fn)
  return line;
}

function wrapBlock(lines: string[], syntax: CommentSyntax): string {
  if (lines.length === 0) return "";
  if (syntax === "toml") {
    return lines.map((l) => makeComment(l, syntax)).join("\n") + "\n";
  }
  // md / mdc: wrap in HTML comment
  return `<!--\n${lines.map((l) => `  ${l}`).join("\n")}\n-->\n`;
}

export function formatContextHintsComment(hints: ContextHints, syntax: CommentSyntax): string {
  const lines: string[] = ["[ULIS contextHints]"];
  if (hints.maxInputTokens !== undefined) {
    lines.push(`  maxInputTokens: ${hints.maxInputTokens}`);
  }
  if (hints.priority !== "normal") {
    lines.push(`  priority: ${hints.priority}`);
  }
  if (hints.excludeFromContext && hints.excludeFromContext.length > 0) {
    lines.push(`  excludeFromContext: ${hints.excludeFromContext.map(sanitizeInstructionText).join(", ")}`);
  }
  return wrapBlock(lines, syntax);
}

export function formatToolPolicyComment(policy: ToolPolicy, syntax: CommentSyntax): string {
  const lines: string[] = ["[ULIS toolPolicy]"];
  if (policy.prefer && policy.prefer.length > 0) {
    lines.push(`  prefer: ${policy.prefer.map(sanitizeInstructionText).join(", ")}`);
  }
  if (policy.avoid && policy.avoid.length > 0) {
    lines.push(`  avoid: ${policy.avoid.map(sanitizeInstructionText).join(", ")}`);
  }
  if (policy.requireConfirmation && policy.requireConfirmation.length > 0) {
    lines.push(`  requireConfirmation: ${policy.requireConfirmation.map(sanitizeInstructionText).join(", ")}`);
  }
  return wrapBlock(lines, syntax);
}

export function formatSecurityComment(sec: SecurityPolicy, syntax: CommentSyntax): string {
  const lines: string[] = [`[ULIS security]`];
  if (sec.permissionLevel !== "readwrite") {
    lines.push(`  permissionLevel: ${sec.permissionLevel}`);
  }
  if (sec.blockedCommands && sec.blockedCommands.length > 0) {
    lines.push(`  blockedCommands: ${sec.blockedCommands.map(sanitizeInstructionText).join(", ")}`);
  }
  if (sec.restrictedPaths && sec.restrictedPaths.length > 0) {
    lines.push(`  restrictedPaths: ${sec.restrictedPaths.map(sanitizeInstructionText).join(", ")}`);
  }
  if (sec.requireApproval && sec.requireApproval.length > 0) {
    lines.push(`  requireApproval: ${sec.requireApproval.map(sanitizeInstructionText).join(", ")}`);
  }
  if (sec.rateLimit) {
    lines.push(`  rateLimit: ${sec.rateLimit.perHour}/hour`);
  }
  return wrapBlock(lines, syntax);
}

/** Concatenates all non-empty policy comment blocks for a given syntax. */
export function buildPolicyCommentBlock(
  agent: {
    contextHints?: ContextHints;
    toolPolicy?: ToolPolicy;
    security?: SecurityPolicy;
  },
  syntax: CommentSyntax,
): string {
  const parts: string[] = [];
  if (agent.contextHints) {
    const block = formatContextHintsComment(agent.contextHints, syntax);
    if (block) parts.push(block);
  }
  if (agent.toolPolicy) {
    const block = formatToolPolicyComment(agent.toolPolicy, syntax);
    if (block) parts.push(block);
  }
  if (agent.security) {
    const block = formatSecurityComment(agent.security, syntax);
    if (block) parts.push(block);
  }
  return parts.join("\n");
}
