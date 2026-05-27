import { describe, expect, it } from "bun:test";

import { formatDiagnostic } from "./diagnostics.js";
import type { Diagnostic } from "./types.js";

function diagnostic(target: Diagnostic["target"]): Diagnostic {
  return {
    level: "error",
    entity: "agent:worker",
    message: "References missing value",
    suggestion: "Remove the reference",
    source: "base",
    relativeFile: "agents/worker.md",
    absoluteFile: "/repo/.ulis/agents/worker.md",
    fieldPath: "skills[]",
    target,
    line: 4,
    column: 3,
  };
}

describe("formatDiagnostic", () => {
  it("renders a compact multi-line diagnostic for all targets", () => {
    expect(formatDiagnostic(diagnostic("all"))).toContain("target: all");
  });

  it("renders none targets", () => {
    expect(formatDiagnostic(diagnostic("none"))).toContain("target: none");
  });

  it("renders specific platform targets", () => {
    const formatted = formatDiagnostic(diagnostic("codex"));
    expect(formatted).toContain("target: codex");
    expect(formatted).toContain("field: skills[]");
    expect(formatted).toContain("at: 4:3");
  });
});
