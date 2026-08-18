/**
 * URL credential redaction and untrusted-text escaping. This module imports nothing, so every
 * layer — parsers, the cloner, the installer, the TUI — can reach it. `install.ts` needs it and
 * `remote-source.ts` imports from `install.ts`, so a shared leaf is what breaks the cycle.
 */

/** C0 controls plus DEL, written as escapes so the source stays copy-pasteable text. */
const CONTROL_CHARS = /[\x00-\x1f\x7f]/u;

/**
 * Anything that can move the cursor, erase a line, or reorder what the reader sees: C0/C1 controls
 * plus the Unicode bidi overrides and line/paragraph separators.
 */
const DISPLAY_CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029]/gu;

/**
 * Make untrusted text safe to print: redact URL credentials, then escape every character that could
 * forge or erase what surrounds it. Without this, a remote manifest can rewrite the trust preview
 * or the logs that follow it. Idempotent — an already-escaped string passes through unchanged.
 */
export function sanitizeLogText(value: string): string {
  return redactUserinfo(value).replace(
    DISPLAY_CONTROL_CHARS,
    (control: string) => "\\u" + control.codePointAt(0)!.toString(16).padStart(4, "0"),
  );
}

/**
 * Strip `user:password@` from a URL before it reaches a log line, an error, or a returned field.
 * Greedy up to the last `@` before the path, query or fragment, so neither an `@` nor whitespace
 * leaves a tail behind, and `\/*` covers the empty-authority form (`https:///user:pw@host/…`).
 * It over-redacts a line that happens to hold an unrelated `@` after a URL — the safe direction.
 */
export function redactUserinfo(value: string): string {
  return value.replace(/([a-z][a-z0-9+.-]*:\/\/)\/*[^/?#]*@/giu, "$1");
}

/**
 * True when `value` could hide a credential in a shape {@link redactUserinfo} cannot strip:
 * whitespace in the authority hides the userinfo from any host-anchored pattern, and an extra
 * slash (`https:///user:pw@host/…`) pushes it into what parses as the path. Callers refuse these
 * outright rather than trying to redact them.
 */
export function hasUnredactableCredential(value: string): boolean {
  return (
    // Any `@` surviving redaction means a credential could still be in there: a slash or whitespace
    // inside the password pushes it past the authority, where no host-anchored pattern reaches it.
    // Over-strict for an `@` in a legitimate path — percent-encode it as %40.
    (value.includes("://") && redactUserinfo(value).includes("@")) ||
    // An extra slash pushes the credential into what parses as the path.
    /:\/\/\/+[^/]*@/u.test(value) ||
    // Whitespace hides the userinfo from any host-anchored pattern, here or in a caller's split.
    urlAuthorities(value).some((authority) => /\s/u.test(authority)) ||
    // Control characters (a NUL especially) can make process launch throw with the raw argv attached.
    CONTROL_CHARS.test(value)
  );
}

/**
 * Every `scheme://` authority in `value` — the only region of a URL a credential can hide in.
 * Callers decide which shapes they refuse; a comma here, for one, cannot survive a comma-separated
 * list. An empty authority is legitimate for `file:///…`, so it is not refused on its own.
 */
export function urlAuthorities(value: string): string[] {
  const found: string[] = [];
  for (let at = value.indexOf("://"); at >= 0; at = value.indexOf("://", at + 3)) {
    const rest = value.slice(at + 3);
    const end = rest.search(/[/?#]/u);
    found.push(end === -1 ? rest : rest.slice(0, end));
  }
  return found;
}
