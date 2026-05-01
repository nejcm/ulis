import { defineConfig } from "vitepress";

const base = "/ulis/";

export default defineConfig({
  title: "ulis",
  description: "Unified LLM Interface Specification CLI for Claude Code, Codex, Cursor, OpenCode, and ForgeCode.",
  base,
  cleanUrls: false,
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: `${base}favicon.svg` }],
    ["link", { rel: "icon", type: "image/png", sizes: "96x96", href: `${base}favicon-96x96.png` }],
    ["link", { rel: "icon", href: `${base}favicon.ico` }],
    ["link", { rel: "apple-touch-icon", href: `${base}apple-touch-icon.png` }],
    ["link", { rel: "manifest", href: `${base}site.webmanifest` }],
    ["meta", { name: "theme-color", content: "#ffffff" }],
  ],
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "CLI", link: "/CLI" },
      { text: "Spec", link: "/SPEC" },
      { text: "Reference", link: "/REFERENCE" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "Project vs Global Mode", link: "/guide/project-vs-global" },
          { text: "Source Layout", link: "/guide/source-layout" },
          { text: "Presets", link: "/guide/presets" },
          { text: "Examples", link: "/guide/examples" },
        ],
      },
      {
        text: "Core Docs",
        items: [
          { text: "CLI Reference", link: "/CLI" },
          { text: "Specification", link: "/SPEC" },
          { text: "Field Reference", link: "/REFERENCE" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/nejcm/ulis" }],
    search: {
      provider: "local",
    },
    outline: {
      level: [2, 3],
      label: "On this page",
    },
    footer: {
      message: "Released under the ISC License.",
      copyright: "Copyright © nejcm",
    },
  },
});
