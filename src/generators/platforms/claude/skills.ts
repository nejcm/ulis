import type { ParsedSkill } from "../../../parsers/skill.js";
import type { Hooks, SkillFrontmatter } from "../../../schema.js";
import { mapTools } from "../../../utils/tool-mapper.js";
import type { PostEmit } from "../../types.js";

function toClaudeHooks(hooks: Hooks): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [event, entries] of Object.entries(hooks)) {
    if (!entries || entries.length === 0) continue;
    out[event] = (entries as Array<{ matcher?: string; command: string }>).map((entry) => ({
      ...(entry.matcher ? { matcher: entry.matcher } : {}),
      hooks: [{ type: "command", command: entry.command }],
    }));
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function nativeSkillFrontmatter(fm: NonNullable<SkillFrontmatter>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (fm.argumentHint) data["argument-hint"] = fm.argumentHint;
  if (fm.allowModelInvocation === false) data["disable-model-invocation"] = true;
  if (fm.userInvocable === false) data["user-invocable"] = false;
  if (fm.effort) data.effort = fm.effort;
  if (fm.isolation === "fork") data.context = "fork";
  if (fm.paths !== undefined) data.paths = fm.paths;
  // A literal `allowed-tools` in the source is already native and survives the copy as written.
  if (fm.tools !== undefined && fm["allowed-tools"] === undefined) {
    const tools = mapTools(fm.tools, "claude");
    if (tools.length > 0) data["allowed-tools"] = tools.join(", ");
  }
  const hooks = fm.hooks ? toClaudeHooks(fm.hooks) : undefined;
  if (hooks) data.hooks = hooks;
  return data;
}

export function buildClaudeSkillDirs(skills: readonly ParsedSkill[]): PostEmit["skillDirs"] {
  return skills.map((s) => {
    const p = s.frontmatter?.platforms?.claude;
    const { enabled: _e, model: _m, ...extra } = (p ?? {}) as Record<string, unknown>;
    const model = p?.model ?? s.frontmatter?.model;
    const native = s.frontmatter ? nativeSkillFrontmatter(s.frontmatter) : {};
    return { name: s.name, dir: s.dir, extraFrontmatter: { ...native, ...(model ? { model } : {}), ...extra } };
  });
}
