/**
 * Prettier Configuration
 * Standard formatting rules for consistent code style
 */

module.exports = {
  // Basics
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  quoteProps: "as-needed",

  // JSX
  jsxSingleQuote: false,
  jsxBracketSameLine: false,

  // Trailing commas (ES5 = objects/arrays, all = including function params)
  trailingComma: "es5",

  // Spacing
  bracketSpacing: true,
  arrowParens: "always",

  // Line endings (LF for consistency across platforms)
  endOfLine: "lf",

  // Embedded language formatting
  embeddedLanguageFormatting: "auto",

  // HTML whitespace sensitivity
  htmlWhitespaceSensitivity: "css",

  // Prose wrapping (markdown)
  proseWrap: "preserve",

  // Vue files
  vueIndentScriptAndStyle: false,

  // Overrides for specific file types
  overrides: [
    {
      files: "*.md",
      options: {
        printWidth: 80,
        proseWrap: "always",
      },
    },
    {
      files: "*.json",
      options: {
        printWidth: 120,
        tabWidth: 2,
      },
    },
    {
      files: "*.yml",
      options: {
        tabWidth: 2,
        singleQuote: false,
      },
    },
    {
      files: "*.css",
      options: {
        singleQuote: false,
      },
    },
  ],
};
