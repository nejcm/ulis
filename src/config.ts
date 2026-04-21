/**
 * Default names for user-controlled source and output directories.
 */
export const ULIS_SOURCE_DIRNAME = ".ulis" as const;
export const ULIS_GENERATED_DIRNAME = "generated" as const;

/**
 * Default build configuration.
 *
 * Every machine-specific or platform-specific constant lives here under
 * `platforms.<tool>`. Users can override any leaf field by creating
 * `.ai/global/build.config.json` with the same shape — see `utils/build-config.ts`
 * for the deep-merge loader. Code defaults stay in this file; user overrides
 * never live in source.
 *
 * `envVarSyntax` is functions only (not data) so it stays in code; it is
 * intentionally not overridable from JSON.
 */

export interface BuildConfig {
  readonly platforms: {
    readonly claude: {
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
      readonly agentNameMap: Readonly<Record<string, string>>;
    };
    readonly codex: {
      readonly model: string;
      readonly modelReasoningEffort: string;
      readonly sandbox: string;
      readonly trustedProjects: Readonly<Record<string, string>>;
      readonly mcpStartupTimeoutSec: number;
    };
    readonly cursor: {
      readonly toolNames: {
        readonly read: readonly string[];
        readonly write: readonly string[];
        readonly edit: readonly string[];
        readonly bash: readonly string[];
        readonly search: readonly string[];
        readonly browser: readonly string[];
      };
    };
    readonly forgecode: {
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
      defaultModel: "anthropic/sonnet",
      smallModel: "opencode/kimi-k2.5-free",
      schema: "https://opencode.ai/config.json",
      agentNameMap: {
        debugger: "debug",
        devops: "devops-engineer",
        architect: "code-architect",
      },
    },
    codex: {
      model: "gpt-5.4",
      modelReasoningEffort: "high",
      sandbox: "elevated",
      trustedProjects: {},
      mcpStartupTimeoutSec: 20,
    },
    cursor: {
      toolNames: {
        read: ["read_file", "list_directory", "search_files"],
        write: ["write_file"],
        edit: ["edit_file"],
        bash: ["run_terminal_command"],
        search: ["web_search"],
        browser: ["browser_action"],
      },
    },
    forgecode: {
      toolNames: {
        read: ["read"],
        write: ["write"],
        edit: ["patch"],
        bash: ["shell"],
        search: ["search", "fetch"],
        browser: ["mcp_*"],
      },
    },
  },
};
