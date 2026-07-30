const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const DIM = "\x1b[2m";

type LogLevel = "info" | "success" | "warn" | "error" | "dim";

function paint(code: string, message: string, enabled: boolean): string {
  return enabled ? `${code}${message}${RESET}` : message;
}

function supportsColor(stream: NodeJS.WriteStream): boolean {
  if (process.env.NO_COLOR !== undefined || process.env.FORCE_COLOR === "0") return false;
  return process.env.FORCE_COLOR !== undefined || stream.isTTY === true;
}

export function formatLogMessage(level: LogLevel, message: string, enabled = supportsColor(process.stdout)): string {
  if (level === "dim") return paint(DIM, message, enabled);

  const installMatch = message.match(/^(Installing) (.+?) (skill|extension): (.+)$/u);
  if (installMatch) {
    const [, action, platform, kind, name] = installMatch;
    return `${paint(BLUE, action, enabled)} ${paint(CYAN, platform, enabled)} ${paint(DIM, kind, enabled)}${paint(
      DIM,
      ":",
      enabled,
    )} ${paint(MAGENTA, name, enabled)}`;
  }

  const failureMatch = message.match(/^(Failed to install) (.+?) \((.+)\)$/u);
  if (failureMatch && level === "warn") {
    const [, action, subject, detail] = failureMatch;
    return `${paint(RED, action, enabled)} ${paint(RED, subject, enabled)} ${paint(DIM, `(${detail})`, enabled)}`;
  }

  const resultMatch = message.match(/^(.+?) (skill|extension): (.+)$/u);
  if (resultMatch && (level === "success" || level === "warn")) {
    const [, platform, kind, name] = resultMatch;
    const nameColor = level === "success" ? GREEN : RED;
    return `${paint(level === "success" ? GREEN : YELLOW, platform, enabled)} ${paint(DIM, kind, enabled)}${paint(
      DIM,
      ":",
      enabled,
    )} ${paint(nameColor, name, enabled)}`;
  }

  const commandMatch = message.match(/^(Will run:) (\S+)(?: (.*))?$/u);
  if (commandMatch) {
    const [, label, command, args] = commandMatch;
    return `${paint(CYAN, label, enabled)} ${paint(BLUE, command, enabled)}${args ? ` ${paint(MAGENTA, args, enabled)}` : ""}`;
  }

  const metadataMatch = message.match(/^([^:]+): (.+)$/u);
  if (metadataMatch && level === "info") {
    const [, label, value] = metadataMatch;
    return `${paint(CYAN, `${label}:`, enabled)} ${paint(DIM, value, enabled)}`;
  }

  return paint(
    level === "success" ? GREEN : level === "warn" ? YELLOW : level === "error" ? RED : CYAN,
    message,
    enabled,
  );
}

function formatTaggedMessage(
  level: Exclude<LogLevel, "dim">,
  tag: string,
  tagColor: string,
  message: string,
  enabled: boolean,
): string {
  return message
    .split(/\r?\n/u)
    .map((line) => `${paint(tagColor, tag, enabled)} ${formatLogMessage(level, line, enabled)}`)
    .join("\n");
}

export const logger = {
  info: (msg: string) => {
    const enabled = supportsColor(process.stdout);
    console.log(formatTaggedMessage("info", "[info]", CYAN, msg, enabled));
  },
  success: (msg: string) => {
    const enabled = supportsColor(process.stdout);
    console.log(formatTaggedMessage("success", "[done]", GREEN, msg, enabled));
  },
  warn: (msg: string) => {
    const enabled = supportsColor(process.stdout);
    console.log(formatTaggedMessage("warn", "[warn]", YELLOW, msg, enabled));
  },
  error: (msg: string) => {
    const enabled = supportsColor(process.stderr);
    console.error(formatTaggedMessage("error", "[error]", RED, msg, enabled));
  },
  dim: (msg: string) => console.log(formatLogMessage("dim", msg)),
  header: (msg: string) => console.log(`\n${paint(BOLD + CYAN, `━━━ ${msg} ━━━`, supportsColor(process.stdout))}`),
};
