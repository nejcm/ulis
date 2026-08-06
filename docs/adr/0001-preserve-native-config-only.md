# Preserve Native Config by Ownership

ULIS uses base-first overlays for Codex `config.toml`, Claude `settings.json` and `settings.local.json`, and global `.claude.json`. The existing native file is the base, current generated values overwrite matching leaf paths, and values absent from the generated config remain. Codex TOML is patched in place so unrelated comments, formatting, and ordering survive.

Project `.mcp.json` and other destination-native configs keep their existing allowlisted preservation rules. Raw fragments remain the explicit override and win at the same config path because they are merged into generated output before install.

Generated agents and local skills use a separate ownership mechanism. Each platform config root contains a versioned `.ulis-manifest.json` with the relative paths installed by ULIS. A later install may remove only tracked paths that are absent from the current generated output. Native config values, external `skills.yaml` installs, extensions, and untracked agents or skills are never added to this manifest.

The first manifest-aware install adopts the current generated set without trying to identify historical files. `--no-prune` keeps stale tracked files but replaces the manifest with the current set, intentionally making those stale files unmanaged.
