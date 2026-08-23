/**
 * Install-review and preset-install-review screens: the trust-gate rendering
 * (`remoteCommandRows`, `remoteWarningRows`, `formatRemoteSource`, `isRemoteReview`) plus the
 * consent-surface command line the user reads before an install runs (`formatInstallCommand`,
 * `quoteCommandArg`) live here rather than in `primitives.ts`, so a security reviewer auditing the
 * trust gate finds the whole surface - warnings and the exact command they gate - in one file.
 */
import { sanitizeConsentText } from "../../utils/redact.js";
import { formatFlow, formatPresetSourceMode, formatPresets, planSource } from "../selectors.js";
import { PRESET_INSTALL_REVIEW_BACK_ROW, PRESET_INSTALL_REVIEW_START_ROW, type TuiState } from "../state-model.js";
import { displayWidth, field, formatPlatforms, middleElide, notice, option, pane } from "./primitives.js";
import { MIN_COLUMNS, REVIEW_CONTROLS, REVIEW_MOUSE_CONTROL, type ScreenView, type ViewRow } from "./types.js";

/**
 * The trust boundary for TUI-initiated remote installs: every entry here is code from a repository
 * the user did not write. The planner decides what qualifies and adds classes over time - some
 * entries run during the install, others are files a host agent executes on its own afterwards -
 * so the framing stays deliberately general rather than naming the classes it happens to list
 * today. Text is pre-sanitised by the planner, so a hostile manifest cannot forge or hide a line.
 * Renders nothing when the install is purely local.
 *
 * An empty list is not "nothing happens": it means nothing this planner recognises as executable,
 * while the remote tree's agents, skills, rules and instructions still land in the destination.
 * `confirmRemoteCommands` in `install/trust-gate.ts` refuses to skip its gate there for exactly that reason,
 * so this screen keeps its own gate - in the CLI's own words, so both surfaces say one thing.
 */
function remoteCommandRows(state: TuiState): ViewRow[] {
  if (!isRemoteReview(state)) return [];
  if (state.remoteCommands.length === 0) {
    return [
      {
        kind: "text",
        text: "Nothing here was recognised as executable - which is not a guarantee.",
        tone: "warn",
      },
      {
        kind: "text",
        text: `  Its files will still be installed for: ${formatPlatforms(state.platforms)}.`,
        tone: "muted",
        // A consent row even though it lists no command: it is the only thing on this screen that
        // has to be read before an empty-plan remote install may start.
        consent: "command",
      },
    ];
  }
  return [
    {
      kind: "text",
      text: "The remote entries below run during install, run later inside your agent, or widen what it may run without asking.",
      tone: "warn",
    },
    ...state.remoteCommands.map(
      (command): ViewRow => ({
        kind: "text",
        text: `  ${sanitizeConsentText(command)}`,
        tone: "muted",
        consent: "command",
      }),
    ),
  ];
}

function remoteWarningRows(state: TuiState, columns: number): ViewRow[] {
  if (!isRemoteReview(state)) return [];
  const source = formatRemoteSource(sanitizeConsentText(state.remoteCommandSource), columns);
  const count = state.remoteCommands.length;
  return [
    {
      kind: "text",
      // With nothing recognised there is no count to state, but the install is no less remote:
      // the banner drops to what remains true rather than disappearing.
      text:
        count === 0
          ? "REMOTE: source files WILL be installed"
          : `REMOTE: ${count} ${count === 1 ? "entry" : "entries"} WILL apply`,
      tone: "error",
      consent: "warning",
    },
    { kind: "text", text: `@ ${source}`, tone: "error", consent: "warning" },
  ];
}

/**
 * Whether this review is installing something the user did not write. Keyed on the source rather
 * than on the command list, because an empty list is a plan the enumeration did not recognise, not
 * a local install.
 */
function isRemoteReview(state: TuiState): boolean {
  return state.remoteCommandSource !== "" || state.remoteCommands.length > 0;
}

function formatRemoteSource(value: string, columns: number): string {
  const protocol = /^[a-z][a-z0-9+.-]*:\/\//iu.exec(value)?.[0];
  const source = protocol
    ? value.slice(protocol.length).replace(/^[^/@]+@/u, "")
    : value.replace(/^(?:[^@/:]+@)?([^/:]+):/u, "$1/");
  const slash = source.indexOf("/");
  const sourceColumns = Math.max(1, columns - 7);
  if (slash < 0) return middleElide(source, sourceColumns);
  if (displayWidth(source) <= sourceColumns) return source;
  const host = source.slice(0, slash);
  const path = source.slice(slash);
  const hostWidth = displayWidth(host);
  if (hostWidth >= sourceColumns) return middleElide(host, sourceColumns);
  return `${host}${middleElide(path, sourceColumns - hostWidth)}`;
}

function formatInstallCommand(state: TuiState, cwd?: string, userHome?: string): string {
  const plan = planSource(state, cwd, userHome);
  // Redacted, so a copied command may need its credentials re-added - better than showing them.
  const args = [
    "ulis",
    "install",
    "--source",
    sanitizeConsentText(plan.sourceDir),
    "--target",
    state.platforms.join(","),
    "--yes",
  ];
  if (state.destinationMode === "global") args.push("--global");
  if (state.selectedPresetNames.length > 0)
    args.push("--preset", sanitizeConsentText(state.selectedPresetNames.join(",")));
  if (!state.rebuild) args.push("--skip-rebuild");
  if (state.backup) args.push("--backup");
  if (!state.prune) args.push("--no-prune");
  if (state.skipExternalSkills) args.push("--skip-external-skills");
  return `Command: ${args.map(quoteCommandArg).join(" ")}`;
}

function quoteCommandArg(value: string): string {
  return /\s/u.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

export function installReviewView(state: TuiState, cwd?: string, userHome?: string, columns = MIN_COLUMNS): ScreenView {
  const plan = planSource(state, cwd, userHome);
  const reviewRows: ViewRow[] = [
    field("Source", sanitizeConsentText(plan.sourceDir)),
    field("Destination", plan.destBase),
    field("Platforms", formatPlatforms(state.platforms)),
    field("Presets", sanitizeConsentText(formatPresets(state))),
    { kind: "blank" },
    { kind: "text", text: formatInstallCommand(state, cwd, userHome), tone: "muted" },
    { kind: "blank" },
    ...remoteCommandRows(state),
  ];
  const actionRows: ViewRow[] = [
    ...remoteWarningRows(state, columns),
    option(state, 0, "Start install"),
    option(state, 1, "Back to plan"),
  ];

  return {
    title: "Review install",
    subtitle: "Confirm install settings before anything is written.",
    breadcrumbs: ["Start", formatFlow(state.flow), "Plan", "Review install"],
    panes: [pane("review", "Install plan", reviewRows), pane("review-actions", "Actions", actionRows, 0)],
    notice: notice(state, "Nothing is written until you start the install."),
    controls: [...REVIEW_CONTROLS, REVIEW_MOUSE_CONTROL],
  };
}

export function presetInstallReviewView(
  state: TuiState,
  cwd?: string,
  userHome?: string,
  columns = MIN_COLUMNS,
): ScreenView {
  const plan = planSource(state, cwd, userHome);
  const reviewRows: ViewRow[] = [
    field(
      "Preset location",
      sanitizeConsentText(formatPresetSourceMode(state.presetSourceMode, state.customPresetSource)),
    ),
    field("Destination", plan.destBase),
    field("Platforms", formatPlatforms(state.platforms)),
    field("Presets", sanitizeConsentText(formatPresets(state))),
    { kind: "blank" },
    { kind: "text", text: "Action: install the selected preset directories resolved by the TUI.", tone: "muted" },
    { kind: "blank" },
    ...remoteCommandRows(state),
  ];
  const actionRows: ViewRow[] = [
    option(state, 0, "Backup existing configs before install", { checked: state.backup }),
    option(state, 1, "Prune removed agents and skills", { checked: state.prune }),
    option(state, 2, "Run preset extensions", { checked: state.presetInstallExtensions }),
    ...(state.presetSourceMode === "custom" && state.presetInstallExtensions
      ? [
          {
            kind: "text" as const,
            text: "Warning: extensions.yaml in this custom directory may run npx or bunx commands.",
            tone: "warn" as const,
          },
        ]
      : []),
    { kind: "blank" },
    ...remoteWarningRows(state, columns),
    option(state, PRESET_INSTALL_REVIEW_START_ROW, "Start preset install"),
    option(state, PRESET_INSTALL_REVIEW_BACK_ROW, "Back to presets"),
  ];

  return {
    title: "Review preset install",
    subtitle: "Confirm preset install settings before anything is written.",
    breadcrumbs: ["Start", formatFlow(state.flow), "Plan", "Review preset install"],
    panes: [pane("review", "Preset install plan", reviewRows), pane("review-actions", "Actions", actionRows, 0)],
    notice: notice(state, "Preset install ignores the current source."),
    controls: [...REVIEW_CONTROLS, "x/space: toggle", REVIEW_MOUSE_CONTROL],
  };
}
