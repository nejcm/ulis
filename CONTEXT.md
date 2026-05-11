# ULIS Context

## Glossary

- **Source**: The canonical ULIS config tree read by build, validate, install, and the TUI. It can be project-local (`./.ulis/`), global (`~/.ulis/`), or an explicit custom path.
- **Destination**: The base directory where generated platform configs are installed. A project destination writes under the current project; a global destination writes under the user's home directory.
- **Platform**: A supported AI tool target: Claude Code, Codex, Cursor, OpenCode, or ForgeCode.
- **Preset**: A reusable ULIS source tree applied before the base source. Presets are resolved from user-global or bundled preset directories; the base source wins conflicts.
- **Build**: Parse, validate, and generate native platform config files under `<source>/generated/<platform>/`.
- **Validate**: Parse and validate a source plus selected presets without writing generated files.
- **Install**: Deploy generated platform configs to a destination, optionally rebuilding first.
- **Linked Install**: An install mode where eligible local skills are staged as native-safe skills and installed through the skills library so platform skill folders can point at `.agents/skills/`.
- **Backup**: A TUI and CLI install option that copies existing target config files or directories before replacing or merging them.
- **Raw Fragment**: A user-owned native config file under `raw/` that is merged into generated output after platform generation; raw values win at the same path.
- **Preserved Native Config**: An allowlisted destination-native config value or file that ULIS preserves during install, such as MCP servers, hooks, Codex trusted projects, selected Codex preferences, or ForgeCode `.forge.toml`.
