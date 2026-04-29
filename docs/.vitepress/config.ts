import { defineConfig } from "vitepress";

export default defineConfig({
  title: "ulis",
  description: "Unified LLM Interface Specification CLI for Claude Code, Codex, Cursor, OpenCode, and ForgeCode.",
  base: "/ulis/",
  cleanUrls: false,
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
