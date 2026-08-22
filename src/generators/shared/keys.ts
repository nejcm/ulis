/**
 * Key and table-header serialization for the generators.
 *
 * Every one of these takes a string a source controls - an `mcp.yaml` server name, a
 * `trustedProjects` path, an unknown key that survived a `looseObject` platform block - and puts it
 * in a *structural* position: a TOML table header, a bare key, a YAML mapping key. Concatenating
 * there is how `a]\ncommand = "sh"\n[mcp_servers.b` became a second, spawning `[mcp_servers]` table
 * in someone's `config.toml`. Quoting is the fix, not a denylist: a quoted key cannot end its own
 * quoting, whatever it contains.
 */

/** Bare where the format allows it, quoted where it does not. TOML basic strings escape like JSON. */
const BARE_KEY = /^[A-Za-z0-9_-]+$/u;
const YAML_RESOLVES_NON_STRING = /^[-+]?(?:[0-9]|\.[0-9])/u;
const YAML_RESERVED_SCALAR = /^(?:true|false|null|~|y|n|yes|no|on|off|\.nan|[-+]?\.inf)$/iu;

export function yamlScalarResolvesNonString(value: string): boolean {
  return YAML_RESOLVES_NON_STRING.test(value) || YAML_RESERVED_SCALAR.test(value);
}

/**
 * One dotted segment of a TOML key or table header. `[mcp_servers.<name>]` must pass `<name>`
 * through here, or a `]`, a newline or a quote in it opens a table the user never wrote.
 */
export function toTomlKey(segment: string): string {
  return BARE_KEY.test(segment) && !/^-+$/u.test(segment)
    ? segment
    : JSON.stringify(segment).replaceAll("\u007f", "\\u007f");
}

/** A dotted TOML table header, each segment quoted independently: `[a.b]`, `[a."odd key"]`. */
export function toTomlTableHeader(...segments: readonly string[]): string {
  return `[${segments.map(toTomlKey).join(".")}]`;
}

/**
 * A YAML mapping key. `toYamlScalar` would do for most values, but a key needs quoting in cases a
 * value does not - anything holding a `:` or a newline would otherwise start a sibling key, which
 * is how an unknown `platforms.claude` key smuggled a whole `hooks:` block into an agent file.
 */
export function toYamlKey(key: string): string {
  return BARE_KEY.test(key) && !/^-+$/u.test(key) && !yamlScalarResolvesNonString(key)
    ? key
    : escapeYamlChars(JSON.stringify(key));
}

/**
 * Characters every YAML quoting path escapes because `JSON.stringify` leaves them literal: the C1
 * block, plus LS and PS. A YAML 1.1 reader (PyYAML, Ruby Psych) treats LS/PS as line breaks, so a
 * literal one ends a comment or folds a quoted scalar or key and opens a live sibling — the readers
 * ULIS targets are 1.2 and do not, but the emitted file is not ours to assume a reader for. TOML
 * has no such hazard: its only line terminators are LF and CRLF.
 *
 * This lives here rather than in `yaml.ts` because `yaml.ts` already depends on this module; keys
 * and values must escape identically, and a second copy of the class is how they drift apart.
 * `src/utils/redact.ts` classifies the same two codepoints over a wider display-safety set.
 */
const YAML_ESCAPED_CHARS = /[\u007f-\u009f\u2028\u2029]/gu;

/** Escape, in already-quoted YAML text, everything `JSON.stringify` left literal. */
export function escapeYamlChars(value: string): string {
  return value.replace(
    YAML_ESCAPED_CHARS,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
