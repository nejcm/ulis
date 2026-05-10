# Preserve Native Integrations Only

ULIS install preserves only allowlisted destination-native sections, such as MCP server maps, hooks, Codex trusted projects, and Codex `tui`, `notice`, and `features`. Existing model defaults, permission settings, and other native preferences are not preserved because ULIS cannot reliably distinguish user intent from stale generated output; raw fragments remain the explicit escape hatch and win at the same config path.
