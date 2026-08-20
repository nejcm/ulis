# ULIS Context

## Glossary

- **Source**: The canonical ULIS config tree read by build, validate, install, and the TUI. It can be project-local (`./.ulis/`), global (`~/.ulis/`), an explicit custom path, or a remote source.
- **Destination**: The base directory where generated platform configs are installed. A project destination writes under the current project; a global destination writes under the user's home directory.
- **Platform**: A supported AI tool target: Claude Code, Codex, Cursor, OpenCode, or ForgeCode.
- **Preset**: A reusable ULIS source tree resolved from user-global or bundled preset directories, or from a remote source. A preset can be layered before a base source, where the base source wins conflicts, or installed by itself as a preset-only source.
- **Preset Layer**: A preset merged before a base source in a validate, build, or install plan.
- **Preset Source**: One or more presets used as the whole input for preset-only install, without reading a base source.
- **Remote Source**: A source tree shallow-cloned from a git repository into a temporary directory for the duration of a single run. It is discarded afterwards and is never cached.
- **Trust Gate**: The confirmation that stands between a remote source and the destination. It lists the execution surface it can recognise, read off the generated output rather than the source declarations: each `skills.yaml` and `extensions.yaml` command as it will be spawned, everything in a generated config that carries a `command` (MCP servers, hooks), every file copied through verbatim that runs by its destination or its contents, and the approval settings from `permissions.yaml`. It installs nothing at all unless it is accepted. It is shown for every remote source, including one with an empty list, because the list is best-effort and the install writes the source either way. `-y` accepts it up front; the TUI's install review screen is the same consent, checked again at the point of execution.
- **Provenance Record**: Install-time state stored in each remote-authored `<source>/generated/<platform>/.ulis-provenance.json`. The platform writer creates and destroys the record with the output it describes. A later install that skips the rebuild reads the selected platforms' records and refuses rather than deploy a tree it cannot re-preview. This closes the gap the Trust Gate alone leaves across two separate runs.
- **Preset Order**: The user-selected order in which presets are merged; earlier presets are merged first, later presets can override earlier presets, and the base source wins after all preset layers.
- **Diagnostic**: A parse or validation message with source label, source-relative file, absolute path, field path, target platform, optional line/column, and suggested fix.
- **Build**: Parse, validate, and generate native platform config files under `<source>/generated/<platform>/`.
- **Validate**: Parse and validate a source plus selected presets without writing generated files.
- **Install**: Deploy generated platform configs to a destination, optionally rebuilding first.
- **TUI Flow**: A guided interactive path that starts from a user intent, preselects source, destination, and install options, and still lets the user adjust those choices before running.
- **TUI Plan**: The editable source, destination, preset, platform, and install-option selections prepared by a TUI flow before the user chooses validate, build only, or install.
- **Edited TUI Plan**: A TUI plan whose source or destination no longer matches the defaults implied by the first selected flow intent.
- **TUI Preference**: A locally persisted choice that pre-fills future TUI plans without preventing the current plan from being edited.
- **TUI Preference Scope**: The flow-specific preference bucket used to remember choices separately for project, global, custom-source, and preset-only flows.
- **Backup**: A TUI and CLI install option that copies existing target config files or directories before replacing or merging them.
- **Ownership Manifest**: A versioned `.ulis-manifest.json` in a platform config root that records the relative agent files and local skill directories installed by ULIS.
- **Managed Entry**: An agent file or local skill directory whose relative path appears in the destination platform's ULIS ownership manifest.
- **Prune**: The default-on install reconciliation that removes previously managed entries absent from the current generated set. `--no-prune` retains stale entries and makes them unmanaged.
- **Raw Fragment**: A user-owned native config file under `raw/` that is merged into generated output after platform generation; raw values win at the same path.
- **Preserved Native Config**: An allowlisted destination-native config value or file that ULIS preserves during install, such as MCP servers, hooks, Codex trusted projects, selected Codex preferences, or ForgeCode `.forge.toml`.
- **Unmanaged Entry**: A destination agent or skill absent from the previous ULIS ownership manifest. Install preserves it unless current generated output overwrites the same native path.
