# Preserve Native Config by Ownership

ULIS uses base-first overlays for Codex `config.toml`, Claude `settings.json`, and global `.claude.json`. The existing native file is the base, current generated values overwrite matching leaf paths, and values absent from the generated config remain. This intentionally keeps both user-owned values and stale values because ULIS does not maintain an ownership manifest. Codex TOML is patched in place so unrelated comments, formatting, and ordering survive.

Project `.mcp.json` and other destination-native configs keep their existing allowlisted preservation rules. Raw fragments remain the explicit override and win at the same config path because they are merged into generated output before install.
