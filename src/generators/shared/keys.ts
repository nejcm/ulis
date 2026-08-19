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

/**
 * One dotted segment of a TOML key or table header. `[mcp_servers.<name>]` must pass `<name>`
 * through here, or a `]`, a newline or a quote in it opens a table the user never wrote.
 */
export function toTomlKey(segment: string): string {
  return BARE_KEY.test(segment) ? segment : JSON.stringify(segment);
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
  return BARE_KEY.test(key) ? key : JSON.stringify(key);
}
