# Preserve Native Config Only

ULIS install preserves only allowlisted destination-native config values or files, such as MCP server maps, hooks, Claude Code UI/plugin settings, Codex trusted projects, selected Codex preferences like `tui`, `notice`, and `features`, and ForgeCode `.forge.toml`. Existing model defaults, permission settings, and other native preferences are not preserved because ULIS cannot reliably distinguish user intent from stale generated output; raw fragments remain the explicit escape hatch and win at the same config path.
