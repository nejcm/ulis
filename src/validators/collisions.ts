import { withOrigin } from "../diagnostics.js";
import type { ParsedAgent } from "../parsers/agent.js";
import type { ParsedSkill } from "../parsers/skill.js";
import type { Diagnostic } from "../types.js";

/**
 * Validate that no two entities share an output identifier that would cause
 * generated files to clobber each other.
 *
 * Both checks are emitted at `error` level — the build cannot proceed safely.
 */
export function validateCollisions(
  agents: readonly ParsedAgent[],
  skills: readonly ParsedSkill[],
): readonly Diagnostic[] {
  const diags: Diagnostic[] = [];

  diags.push(
    ...findDuplicates(
      agents.map((agent) => ({ name: agent.name, origin: agent.origin })),
      "agent",
      "Duplicate agent name",
      `Rename one of the colliding files in the ulis agents/ folder (or its \`name:\` frontmatter)`,
    ),
  );

  diags.push(
    ...findDuplicates(
      skills.map((skill) => ({ name: skill.frontmatter?.name ?? skill.name, origin: skill.origin })),
      "skill",
      "Duplicate skill name",
      `Rename one of the colliding directories in the ulis skills/ folder (or its \`name:\` frontmatter)`,
    ),
  );

  return diags;
}

function findDuplicates(
  items: readonly { readonly name: string; readonly origin?: ParsedAgent["origin"] }[],
  entityKind: string,
  message: string,
  suggestion: string,
): readonly Diagnostic[] {
  const seen = new Map<string, (typeof items)[number]>();
  const dupes = new Map<string, (typeof items)[number]>();
  for (const item of items) {
    if (seen.has(item.name)) {
      dupes.set(item.name, item);
    } else {
      seen.set(item.name, item);
    }
  }
  return [...dupes].map(([name, item]) => ({
    level: "error" as const,
    entity: `${entityKind}:${name}`,
    message: `${message} "${name}" — output files would collide`,
    suggestion,
    ...withOrigin(item.origin, { fieldPath: "name", target: "all" }),
  }));
}
