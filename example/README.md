# example/

Reference source tree used for local smoke tests and demos with:

```bash
ulis build --source example
```

## Layout

`example/` mirrors a normal `.ulis/` source directory:

- `config.yaml` - minimal project metadata
- `mcp.yaml` - MCP servers
- `permissions.yaml` - per-platform permissions
- `skills.yaml` - external skill installs
- `agents/` - agent markdown files
- `skills/` - skill directories (`SKILL.md`)
- `commands/` - command markdown files
- `raw/` - platform-native files copied verbatim after generation (for overrides)

## Notes

- Generated output goes to `example/generated/<platform>/`.
- If you need to customize native platform files directly, place them in `raw/all/` or `raw/<platform>/`.
- Existing `raw/common/` directories must be renamed to `raw/all/`; the legacy name is no longer recognized.
