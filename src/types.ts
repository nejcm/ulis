export interface Diagnostic {
  readonly level: "error" | "warning";
  readonly entity: string;
  readonly message: string;
  readonly suggestion?: string;
}
