---
title: Remote Sources
---

# Remote Sources

`--source` and `--preset` accept a **git repository URL** instead of a local path, so a shared team config can be installed without cloning it by hand first. ULIS shallow-clones the repository into a temporary directory and then treats it exactly like a local source tree.

For the reasoning behind the design, see [ADR 0003](/adr/0003-remote-sources-via-git-clone).

```bash
ulis install --source https://github.com/acme/ulis-config
```

```bash
ulis preset install https://github.com/acme/ulis-presets/tree/main/presets/backend
```

## URL forms

| Form                                           | Meaning                                             |
| ---------------------------------------------- | --------------------------------------------------- |
| `https://host/owner/repo` / `…/repo.git`       | Clone the default branch, use the repository root   |
| `git@host:owner/repo.git`                      | Same, over SSH                                      |
| `<url>#<ref>`                                  | Check out branch or tag `<ref>` — works on any host |
| `https://github.com/o/r/tree/<ref>/<subdir>`   | GitHub web URL: ref plus subdirectory               |
| `https://gitlab.com/o/r/-/tree/<ref>/<subdir>` | GitLab web URL: ref plus subdirectory               |

The `#<ref>` fragment wins over a ref in the path, which is how you reach a **branch name containing `/`**: the web-URL form takes only the first path segment as the ref, so use `…/tree/main/presets/team#feat/my-branch`.

**Refs are branches and tags only.** A commit SHA is refused with an explicit message, and so is a branch whose name is seven or more hex characters, since nothing local can tell the two apart. There is no commit pinning — a branch is mutable, so what you reviewed last week is not necessarily what runs today.

Only **HTTPS and SSH** are accepted; `http://` and `git://` are refused.

## Requirements and behaviour

- **`git` must be on `PATH`.** There is no archive fallback. If a `github.com` clone fails and the [`gh` CLI](https://cli.github.com/) is installed, ULIS retries once through `gh repo clone`, which carries your GitHub token — useful for private repositories where plain `git` is not signed in. `gh` is optional.
- **Nothing is cached.** Every run clones fresh, and the temporary directory is removed on success, on failure, and on Ctrl-C.
- Clones are **shallow, single-branch, and time-limited** (60s). Credential and ssh prompts are disabled, so an unauthenticated private repository fails fast instead of hanging.
- **Symlinks in the cloned tree are rejected** — a committed symlink could otherwise point outside the clone.
- A remote source installs into the **current directory**, or into your **home directory with `--global`**. A temporary directory has no meaningful parent to install alongside.
- **`build --source <url>` is refused.** Build writes its output into the source tree, and a remote source is discarded after the run. Use `install`, or clone the repo yourself and point `--source` at the checkout.

## The trust gate

A remote source can hand your agents code you did not write, and not only by spawning something. Before **anything** is written or run, ULIS prints the whole execution surface and asks:

```
━━━ Remote Source Commands ━━━
[info] From https://github.com/acme/ulis-config
[info]   claude/.claude.json runs: npx -y @acme/review-mcp
[info]   codex/config.toml runs: npx -y @acme/review-mcp
[info]   installs claude/settings.json
[info]   claude/settings.json runs: ./setup.sh
[info]   sets approval policy claude.defaultMode = bypassPermissions
[info]   npx skills@latest add acme/review -a claude-code --project --yes
Run these commands? [y/N]
```

ULIS answers that question by **generating the configs and reading them back**, rather than by trusting what the source declares. Whatever a payload looked like in the source, if it survives into a file that is about to be installed, it is listed. Four kinds of entry appear:

- **Commands** from `skills.yaml` and `extensions.yaml`, exactly as they will be spawned.
- **Anything in a generated config that carries a `command`** — an MCP server your agent spawns on its next launch, a hook it runs on a tool call, at stop, or at session start. A remote MCP server appears as `connects to <url>`: nothing runs locally, but your agent talks to that endpoint and every tool it advertises becomes callable. Each line names the file it lands in.
- **Files copied through untouched** from `raw/`, from skill directories, and from doc directories. One is listed when the destination itself makes it run — a platform's own config file, a directory a platform auto-loads such as `plugin/` or `hooks/`, an executable extension — or when its contents declare a command. A file too large or too odd to read says `(contents not readable by the preview)` rather than passing as clean.
- **Approval settings** from `permissions.yaml`, which decide what your agent may do without asking you.

This is a best-effort reading, not a proof. It is why the gate is shown for **every** remote source, including one where nothing was recognised — in that case it says exactly that, and still asks, because the source's agents, skills and instructions are installed either way.

**Decline and nothing is installed** — not the commands, and not the generated config files either. The gate stands in front of the whole install, so saying no leaves the destination exactly as it was. The run exits 0: declining is a choice, not a failure.

Notes on how the gate behaves:

- **A piped `y` does not answer it.** The prompt requires a real terminal. Without one the run **fails with exit 1** rather than quietly installing nothing — a cron job or wrapper script that could not be asked has not consented. Use `-y` for those.
- **`-y` / `--yes` accepts it**, along with the overwrite confirmation. This is the one escape hatch, for non-interactive runs — do not use it with a URL you have not read.
- **In the TUI**, the same command list appears on the install review screen; proceeding from that screen is the consent. If anything about the plan changes after you review it, the install refuses to run rather than executing commands you did not see.
- On Windows, a skill or extension argument containing a **shell metacharacter or a space** is refused rather than escaped, because the preview would otherwise show one argument where two would run.

## Credentials in URLs

A URL may carry `user:password@`. ULIS clones with it but redacts it from every log line, error, and stored value. URL shapes that redaction cannot reliably strip — whitespace in the authority, an empty authority, an unencoded `@` in the path — are **refused without echoing the URL back**, since printing it could reveal the password. Percent-encode a literal `@` in a path as `%40`.

Prefer an SSH remote or a `gh`/git credential helper over putting a token in the URL.
