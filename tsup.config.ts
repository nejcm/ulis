import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    target: "node20",
    platform: "node",
    outDir: "dist",
    clean: true,
    shims: true,
    splitting: false,
    sourcemap: false,
    dts: false,
    minify: false,
    // The Node CLI must never pull in OpenTUI; it only ever spawns dist/tui.js.
    external: ["@opentui/core"],
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
  {
    // Separate Bun-only entrypoint. `dist/cli.js` re-launches this file with Bun
    // because OpenTUI's renderer needs Bun's FFI. Keep @opentui/core external so
    // Bun resolves the matching platform-native package at runtime.
    entry: { tui: "src/tui.ts" },
    format: ["esm"],
    target: "esnext",
    platform: "neutral",
    outDir: "dist",
    clean: false,
    shims: false,
    splitting: false,
    sourcemap: false,
    dts: false,
    minify: false,
    external: ["@opentui/core"],
    banner: {
      js: "#!/usr/bin/env bun",
    },
  },
]);
