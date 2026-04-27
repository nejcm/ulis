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
      agents.map((a) => a.name),
      "agent",
      "Duplicate agent name",
      `Rename one of the colliding files in the ulis agents/ folder`,
    ),
  );

  diags.push(
    ...findDuplicates(
      skills.map((s) => s.frontmatter?.name ?? s.name),
      "skill",
      "Duplicate skill name",
      `Rename one of the colliding directories in the ulis skills/ folder (or its \`name:\` frontmatter)`,
    ),
  );

  return diags;
}

function findDuplicates(
  names: readonly string[],
  entityKind: string,
  message: string,
  suggestion: string,
): readonly Diagnostic[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      dupes.add(name);
    } else {
      seen.add(name);
    }
  }
  return [...dupes].map((name) => ({
    level: "error" as const,
    entity: `${entityKind}:${name}`,
    message: `${message} "${name}" — output files would collide`,
    suggestion,
  }));
}
