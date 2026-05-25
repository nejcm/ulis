import type { Platform } from "./platforms.js";

export type DiagnosticTarget = Platform | "all" | "none";

export interface DiagnosticOrigin {
  readonly source: string;
  readonly relativeFile?: string;
  readonly absoluteFile?: string;
  readonly fieldPath?: string;
  readonly target?: DiagnosticTarget;
  readonly line?: number;
  readonly column?: number;
}

export interface Diagnostic {
  readonly level: "error" | "warning";
  readonly kind?: string;
  readonly file?: string;
  readonly entity: string;
  readonly message: string;
  readonly suggestion?: string;
  readonly source?: string;
  readonly relativeFile?: string;
  readonly absoluteFile?: string;
  readonly fieldPath?: string;
  readonly target?: DiagnosticTarget;
  readonly line?: number;
  readonly column?: number;
}
