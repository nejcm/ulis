/**
 * ESLint Configuration
 * Recommended rules for TypeScript/JavaScript projects
 * Includes security, best practices, and accessibility checks
 */

module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
    browser: true,
  },

  // Parser for TypeScript
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    project: "./tsconfig.json",
  },

  // Plugins
  plugins: ["@typescript-eslint", "security", "import", "promise", "node"],

  // Extends
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "plugin:security/recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "plugin:promise/recommended",
    "plugin:node/recommended",
  ],

  rules: {
    // TypeScript-specific rules
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/explicit-function-return-type": "warn",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      },
    ],
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-misused-promises": "error",
    "@typescript-eslint/await-thenable": "error",
    "@typescript-eslint/no-unnecessary-type-assertion": "error",
    "@typescript-eslint/prefer-nullish-coalescing": "warn",
    "@typescript-eslint/prefer-optional-chain": "warn",
    "@typescript-eslint/strict-boolean-expressions": "warn",

    // Security rules (CRITICAL)
    "security/detect-object-injection": "warn",
    "security/detect-non-literal-regexp": "warn",
    "security/detect-unsafe-regex": "error",
    "security/detect-buffer-noassert": "error",
    "security/detect-child-process": "warn",
    "security/detect-disable-mustache-escape": "error",
    "security/detect-eval-with-expression": "error",
    "security/detect-no-csrf-before-method-override": "error",
    "security/detect-non-literal-fs-filename": "warn",
    "security/detect-non-literal-require": "warn",
    "security/detect-possible-timing-attacks": "warn",
    "security/detect-pseudoRandomBytes": "error",

    // Import rules
    "import/no-unresolved": "error",
    "import/named": "error",
    "import/default": "error",
    "import/no-duplicates": "error",
    "import/order": [
      "warn",
      {
        groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
        "newlines-between": "always",
        alphabetize: { order: "asc" },
      },
    ],

    // Promise rules
    "promise/always-return": "error",
    "promise/catch-or-return": "error",
    "promise/no-nesting": "warn",
    "promise/no-promise-in-callback": "warn",
    "promise/no-callback-in-promise": "warn",

    // Best practices
    eqeqeq: ["error", "always"],
    "no-console": "warn",
    "no-debugger": "error",
    "no-alert": "error",
    "no-var": "error",
    "prefer-const": "error",
    "prefer-arrow-callback": "warn",
    "prefer-template": "warn",
    "no-param-reassign": "warn",
    "no-return-await": "error",
    "require-await": "error",
    "no-async-promise-executor": "error",

    // Error prevention
    "no-throw-literal": "error",
    "no-unmodified-loop-condition": "error",
    "no-unreachable-loop": "error",
    "array-callback-return": "error",
    "no-constructor-return": "error",

    // Code style (enforced by Prettier, but good to document)
    "max-len": ["warn", { code: 120, ignoreUrls: true }],
    "max-lines": ["warn", { max: 500, skipBlankLines: true, skipComments: true }],
    "max-lines-per-function": ["warn", { max: 100, skipBlankLines: true, skipComments: true }],
    complexity: ["warn", 15],
    "max-depth": ["warn", 4],
    "max-nested-callbacks": ["warn", 3],
  },

  // Environment-specific overrides
  overrides: [
    {
      // Test files
      files: ["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**"],
      env: {
        jest: true,
      },
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "max-lines-per-function": "off",
      },
    },
    {
      // JavaScript files (non-TypeScript)
      files: ["**/*.js"],
      rules: {
        "@typescript-eslint/no-var-requires": "off",
      },
    },
    {
      // Configuration files
      files: ["*.config.js", ".eslintrc.js"],
      env: {
        node: true,
      },
      rules: {
        "@typescript-eslint/no-var-requires": "off",
      },
    },
  ],

  // Files to ignore
  ignorePatterns: ["node_modules/", "dist/", "build/", "coverage/", "*.min.js", "*.bundle.js"],
};
