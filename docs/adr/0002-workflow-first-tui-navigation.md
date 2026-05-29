# Workflow-first TUI navigation

The TUI should start from user intent, not from independent source, destination, preset, and action settings. We will replace the settings-dashboard model with guided flows such as updating the current project, updating home-level configs, using a custom source, or installing presets only; each flow pre-fills an editable TUI plan, then lets the user choose validate, build only, or install.

## Consequences

- First-screen choices are defaults, not locks: users can still edit source, destination, platforms, preset selections, backup, latest-output, and extension options before writing files.
- Preset layers and preset sources are separate concepts in the UI. Preset layers merge before a base source; preset sources are the whole input for preset-only install.
- Preferences are scoped by flow so project, global, custom-source, and preset-only choices do not overwrite each other accidentally.
- Legacy single-scope TUI preferences migrate into the matching project, global, or custom-source flow. They do not infer the newer preset-only flow because older preferences had no preset-only intent marker.
- Install keeps a focused review screen because it writes native tool config directories. Validate and build-only run from the configured plan after required-source and platform checks.
