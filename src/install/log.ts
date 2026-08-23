import type { Logger } from "../build.js";
import { sanitizeLogText } from "../utils/redact.js";

// Every install log line is sanitized here rather than at its call site. Much of what these print
// is remote-controlled — manifest entries, preset names, child process output — and a wrapper that
// has to be remembered at each site is one forgotten call away from letting a hostile manifest
// forge the trust preview. Sanitizing at the sink makes that unforgettable. `sanitizeLogText` is
// idempotent, so text already sanitized upstream (a command preview, say) passes through unchanged.

export function logHeader(logger: Logger | undefined, message: string): void {
  // Headers are literals from the call site, never remote text — the only sink that skips sanitizing.
  logger?.header(message);
}

export function logInfo(logger: Logger | undefined, message: string): void {
  logger?.info(sanitizeLogText(message));
}

export function logSuccess(logger: Logger | undefined, message: string): void {
  logger?.success(sanitizeLogText(message));
}

export function logWarn(logger: Logger | undefined, message: string): void {
  logger?.warn(sanitizeLogText(message));
}
