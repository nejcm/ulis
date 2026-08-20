# Changelog

All notable changes to this project are documented here. The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project follows [SemVer](https://semver.org/).

Releases before this one predate this file. See [GitHub Releases](https://github.com/nejcm/ulis/releases) for their notes.

## [Unreleased]

0.7.0 introduced remote sources (`--source`/`--preset` accepting a git URL) behind a trust gate meant to stop unreviewed remote code from reaching your machine. That gate had several ways around it, closed in this release. **If you have used a remote `--source` or `--preset` on 0.7.0, treat anything it installed as unreviewed and re-run the install after upgrading.** If you have only ever used local sources, none of this applies to you.

Re-running the install replaces the managed files, but it cannot undo commands that already ran during a 0.7.0 install, and it does not remove anything written outside ULIS's ownership manifest — there is no `ulis uninstall`; removal only happens via prune against a shrinking generated set. If you installed from a source you do not fully trust, audit what those `npx`/`bunx` commands did as well.

### Security

- **The gate shipped in 0.7.0 was broken in three ways.** It confirmed only _after_ the generated config files were already written to disk, so declining left them installed regardless of the answer. It listed only what a source _declared_ in `skills.yaml`/`extensions.yaml`, not what the generator actually _emitted_ — MCP servers weren't enumerated at all, and a hook that reached the output through another path never appeared in the prompt either. Running with no terminal attached (a script, a CI job) silently declined and exited `0` — indistinguishable from a successful, reviewed run.

  Fixed: the gate now stands in front of every write and lists what the generators actually emit — regenerated in memory from the same inputs the install uses, so the preview cannot drift from what lands — including approval-policy entries that widen what your agent may do without asking (a new entry class in what's shown — see **Changed** below); declining installs nothing at all; and no terminal is a hard failure instead of a silent decline (pass `-y` for scripted/CI runs that have already reviewed the source).

- **A remote source's `.env` was read before the gate ran**, letting it set environment variables that 0.7.0's denylist did not cover — `HOME` and `XDG_CONFIG_HOME` (which is how an attacker reaches `~/.npmrc` indirectly), `USERPROFILE`, `ComSpec`, and `SSH_AUTH_SOCK` — that the very `npx`/`bunx` command you were about to approve would then trust. Fixed: a remote source's `.env` is never read at all, and the denylist that protects a local source's `.env` gained those keys.

- **Cross-run bypass.** `ulis build --preset <url>` followed later by `ulis install --skip-rebuild` installed the remote preset's MCP servers, hooks, and raw config fragments with no prompt at all, because the second run had no way to know the tree it was about to install came from a remote source. Fixed: each platform's provenance record now lives in the output it describes and is written by the same operation. `--skip-rebuild` refuses if any platform it is about to install carries one. See **Behaviour changes** below; this fix is behind two of the three breaking changes in this release.

- **Identity mixup in the TUI.** The interactive installer decided whether a source was "remote" by checking whether its temp directory name started with `ulis-remote-`, rather than asking the resolver that already knew the answer. A local project directory that happened to share that name prefix had its own `.env` silently skipped for the run. Fixed: the TUI now uses the resolver's own answer instead of guessing from a name.

- **Injection in generated output.** A remote source's `mcp.yaml` server name, or an unrecognised key that ULIS carried through verbatim, could break out of its position in generated Codex TOML or YAML output and smuggle in an extra config block — including a `hooks:` block the trust preview never looked for, because it appeared nowhere a source declares hooks. A `security.blockedCommands` pattern containing a `"` could break out of the shell command it was interpolated into. Fixed by quoting/removing the interpolation rather than filtering characters, since a character blocklist would have refused exactly the patterns a security-conscious user writes.

### Changed

- The TUI's remote-review header no longer reads "These commands come from `<source>` and WILL RUN if you continue" — some listed entries (approval-policy changes, files a host agent reads later) don't run as a command themselves. It now reads "`<source>` contributes the entries below, and they WILL take effect if you continue. Review them first:", followed by a line naming the three ways an entry can matter: it runs during the install, it runs later inside your agent, or it widens what your agent may run without asking.
- The TUI now rejects a review used to start a different action with an explicit error, rather than relying on the settings fingerprint incidentally encoding which action it was generated for.

### Added

- CI now regenerates the README's `tui.svg` screenshot on every pull request and fails if it doesn't match the committed file, so it can no longer drift from what the TUI actually renders unnoticed.

### Fixed

- A full build now replaces removable files, symlinks, FIFOs, and sockets at a generated platform path, so the full build that ULIS's provenance errors tell you to run can actually regenerate the tree.

- A second Ctrl-C while a remote clone was still being aborted used to be ignored, and a cleanup step that itself threw (a locked file on Windows, a flaky network mount) could strand every cleanup still queued behind it and surface as an uncaught exception inside the signal handler. A repeat interrupt now exits regardless, and cleanups run inside a `try`/`catch`.

### ⚠ Behaviour changes

1. **A previously-approved `--skip-rebuild` may now refuse.** If you have run `ulis install --preset <url>` (or `--source <url>`) and approved its commands, that install now leaves a provenance marker inside each generated platform it touched. Any _later_ `ulis install --skip-rebuild` against that same generated tree hard-fails with an error naming the recorded source — `-y`/`--yes` does **not** override this. It is deliberate: skipping the rebuild also skips the one thing that lets the gate re-verify what it is about to install.

   **If a pipeline does `install --preset <url>` once and then repeatedly `install --skip-rebuild`:** drop `--skip-rebuild` from the later step — but note this rebuilds from your local source alone, so the remote preset's contributions stop being installed; or keep re-supplying `--preset <url>` so the gate reviews it fresh each time and its contributions are preserved.

2. **Upgrading from 0.7.0: run one full `ulis build` before your first `--skip-rebuild`.** A tree built by 0.7.0 with `--preset <url>` has no provenance record — the feature didn't exist yet — and this release reads "no record" as "purely local," so it will not refuse that tree.

   It must be a _full_ build, and the reason is not the record: it is that a build only regenerates the platforms it targets. A full build overwrites every platform directory with purely local output, so the remote-authored files from 0.7.0 are gone. A narrow `--target codex` build leaves every other platform's 0.7.0 output exactly where it is — checking the provenance record afterwards would show it clean either way, because a clean record and a remote-authored file still sitting on disk are two different things.

   This is a known, deliberate limitation, not a defect. The alternative — refusing every `--skip-rebuild` on any tree with no record at all — would break the common case: everyone who has only ever used local sources and has never touched `--preset <url>`.

3. **`--skip-rebuild` no longer applies when this run resolves a remote source.** `ulis install --preset <url> --skip-rebuild` now rebuilds anyway and logs why: the gate previews what the build produces, so installing a pre-existing `generated/` tree would show you one thing and install another.

[Unreleased]: https://github.com/nejcm/ulis/compare/v0.7.0...HEAD
