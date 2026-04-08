/**
 * Default build configuration.
 *
 * Every machine-specific or platform-specific constant lives here under
 * `platforms.<tool>`. Users can override any leaf field by creating
 * `.ai/build.config.json` with the same shape — see `utils/build-config.ts`
 * for the deep-merge loader. Code defaults stay in this file; user overrides
 * never live in source.
 *
 * `envVarSyntax` is functions only (not data) so it stays in code; it is
 * intentionally not overridable from JSON.
 */

export interface BuildConfig {
  readonly platforms: {
    readonly claude: {
      readonly modelMap: Readonly<Record<string, string>>;
      readonly toolNames: {
        readonly read: readonly string[];
        readonly write: readonly string[];
        readonly edit: readonly string[];
        readonly bash: readonly string[];
        readonly search: readonly string[];
        readonly browser: readonly string[];
      };
    };
    readonly opencode: {
      readonly defaultModel: string;
      readonly smallModel: string;
      readonly schema: string;
      readonly modelMap: Readonly<Record<string, string>>;
      readonly agentNameMap: Readonly<Record<string, string>>;
      readonly bashAllowlist: Readonly<Record<string, "ask" | "allow" | "deny">>;
      readonly skillAllowlist: Readonly<Record<string, "ask" | "allow" | "deny">>;
      readonly toolPermissions: Readonly<Record<string, "ask" | "allow" | "deny">>;
      readonly readAllowlist: Readonly<Record<string, "ask" | "allow" | "deny">>;
      readonly externalDirectoryAllowlist: Readonly<Record<string, "ask" | "allow" | "deny">>;
    };
    readonly codex: {
      readonly model: string;
      readonly modelReasoningEffort: string;
      readonly sandbox: string;
      readonly trustedProjects: Readonly<Record<string, string>>;
      readonly mcpStartupTimeoutSec: number;
    };
    readonly cursor: {
      readonly modelMap: Readonly<Record<string, string>>;
      readonly toolNames: {
        readonly read: readonly string[];
        readonly write: readonly string[];
        readonly edit: readonly string[];
        readonly bash: readonly string[];
        readonly search: readonly string[];
        readonly browser: readonly string[];
      };
    };
  };
}

export const BUILD_CONFIG: BuildConfig = {
  platforms: {
    claude: {
      modelMap: {
        opus: "opus",
        sonnet: "sonnet",
        haiku: "haiku",
      },
      toolNames: {
        read: ["Read", "Glob", "Grep"],
        write: ["Write"],
        edit: ["Edit"],
        bash: ["Bash"],
        search: ["WebSearch", "WebFetch"],
        browser: ["mcp__playwright__navigate", "mcp__playwright__screenshot"],
      },
    },
    opencode: {
      defaultModel: "sonnet",
      smallModel: "opencode/kimi-k2.5-free",
      schema: "https://opencode.ai/config.json",
      modelMap: {
        opus: "anthropic/claude-opus-4-6",
        sonnet: "sonnet",
        haiku: "haiku",
      },
      agentNameMap: {
        debugger: "debug",
        devops: "devops-engineer",
        architect: "code-architect",
      },
      bashAllowlist: {
        "*": "ask",
        "bq query*": "allow",
        "bun run build:*": "allow",
        "bun run lint:file:*": "allow",
        "bun run test:*": "allow",
        "bun run test:file:*": "allow",
        "bun test:*": "allow",
        "cc:*": "allow",
        "comm:*": "allow",
        "find*": "allow",
      },
      skillAllowlist: {
        "*": "ask",
        "read-*": "allow",
        "search-*": "allow",
        "internal-*": "deny",
      },
      toolPermissions: {
        bash: "ask",
        write: "ask",
        edit: "ask",
        read: "allow",
      },
      readAllowlist: {},
      externalDirectoryAllowlist: {},
    },
    codex: {
      model: "gpt-5.4",
      modelReasoningEffort: "high",
      sandbox: "elevated",
      trustedProjects: {},
      mcpStartupTimeoutSec: 20,
    },
    cursor: {
      modelMap: {
        opus: "claude-opus-4-6",
        sonnet: "claude-sonnet-4-6",
        haiku: "claude-haiku-4-5-20251001",
      },
      toolNames: {
        read: ["read_file", "list_directory", "search_files"],
        write: ["write_file"],
        edit: ["edit_file"],
        bash: ["run_terminal_command"],
        search: ["web_search"],
        browser: ["browser_action"],
      },
    },
  },
};
