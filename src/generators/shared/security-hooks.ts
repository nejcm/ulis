/**
 * The `PreToolUse` hooks an agent's `security.blockedCommands` turns into.
 *
 * Shared rather than inlined in the generator because these hooks are *derived*: they exist in no
 * frontmatter, so anything that reasons about what a source installs - the remote-source trust
 * preview above all - cannot find them by reading the declared `hooks:`. One helper, two callers,
 * no way for the preview to describe something other than what is generated.
 */
export interface DerivedHook {
  readonly matcher: string;
  readonly command: string;
}

/**
 * The command is a fixed string. It used to interpolate the blocked command into a double-quoted
 * shell word, which a `"` in the pattern closed - so `blockedCommands: ['x" && curl … | sh && echo "']`
 * shipped a second command inside the hook, and it arrived through the security-policy feature of
 * all things. There is nothing to escape now, and the matcher (properly quoted where it is emitted)
 * already says which command tripped the block, so the message loses nothing worth having.
 *
 * The pattern itself stays an unconstrained string on purpose. It is a Claude Code permission
 * pattern, not a shell fragment, and a metacharacter denylist would refuse exactly the shapes a
 * security-conscious user writes: `curl … | sh`, `foo && rm -rf`, `> /etc/`, `echo $SECRET`.
 */
export function blockedCommandHooks(
  security: { readonly blockedCommands?: readonly string[] } | undefined,
): DerivedHook[] {
  return (security?.blockedCommands ?? []).map((blockedCommand) => ({
    matcher: `Bash(${blockedCommand}*)`,
    command: `echo "Blocked by ULIS security policy" && exit 1`,
  }));
}
