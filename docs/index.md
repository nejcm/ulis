---
layout: home

hero:
  name: "ulis"
  text: "One config source to rule them all."
  tagline: "Define agents, skills, MCP servers, plugins, and permissions once, then generate native configs for Claude Code, Codex, Cursor, OpenCode, and ForgeCode."
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: CLI Reference
      link: /CLI
    - theme: alt
      text: Specification
      link: /SPEC
    - theme: alt
      text: Field Reference
      link: /REFERENCE
    - theme: alt
      text: GitHub
      link: https://github.com/nejcm/ulis

features:
  - title: Source of Truth
    details: Keep one canonical `.ulis/` tree and remove config drift across tool-specific formats.
  - title: Build + Install
    details: Generate into `<source>/generated/` and deploy straight into each tool's expected directory layout.
  - title: Safe Validation
    details: Parse with schemas, catch collisions and broken references early, and fail fast before writing invalid configs.
---

<div class="terminal">
  <div class="terminal-header">
    <span class="circle red"></span>
    <span class="circle yellow"></span>
    <span class="circle green"></span>
    <span class="loc">~</span>
  </div>
  <div class="terminal-body">
    <div>
      <span class="sign">$</span>
      <span class="text">bun add -g @nejcm/ulis</span>
    </div>
    <div>
      <span class="sign">$</span>
      <span class="text">ulis init</span>
    </div>
    <div>
      <span class="sign">$</span>
      <span class="text">ulis install --yes</span>
      <span class="cursor"></span>
    </div>
  </div>
</div>

## Why ulis

Every AI coding tool has different file formats and feature naming. `ulis` gives you a neutral model in `.ulis/` and compiles that into native outputs for each target platform.

## Supported targets

- Claude Code
- Codex
- Cursor
- OpenCode
- ForgeCode
