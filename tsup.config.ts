import { defineConfig } from "tsup";

export default defineConfig({
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
  // @cel-tui/core ships raw .ts source (main: "src/index.ts"), which Node
  // cannot load from node_modules. Bundle it into our output; let all other
  // deps resolve at runtime so their CJS/dynamic-require behavior stays intact.
  noExternal: ["@cel-tui/core"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
