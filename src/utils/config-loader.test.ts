import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { z } from "zod";

import { createTempRoot, writeTextFile } from "../test-utils/fs.js";
import { loadRequiredConfigFile, loadValidatedConfigFile } from "./config-loader.js";

function writeConfig(root: string, filename: string, contents: string): void {
  writeTextFile(join(root, filename), contents);
}

describe("loadValidatedConfigFile", () => {
  const Schema = z.object({
    name: z.string(),
    count: z.number().optional(),
  });

  it("prefers .yaml over .yml and .json", () => {
    const root = createTempRoot("ulis-config-loader-");
    writeConfig(root, "config.json", JSON.stringify({ name: "json" }));
    writeConfig(root, "config.yml", "name: yml\n");
    writeConfig(root, "config.yaml", "name: yaml\n");

    expect(loadValidatedConfigFile({ dir: root, baseName: "config", schema: Schema, required: true })).toEqual({
      name: "yaml",
    });
  });

  it("falls back from .yaml to .yml before .json", () => {
    const root = createTempRoot("ulis-config-loader-");
    writeConfig(root, "config.json", JSON.stringify({ name: "json" }));
    writeConfig(root, "config.yml", "name: yml\n");

    expect(loadValidatedConfigFile({ dir: root, baseName: "config", schema: Schema, required: true })).toEqual({
      name: "yml",
    });
  });

  it("returns a validated default value for optional missing files", () => {
    const root = createTempRoot("ulis-config-loader-");

    expect(
      loadValidatedConfigFile({
        dir: root,
        baseName: "missing",
        schema: Schema,
        defaultValue: { name: "default", count: 1 },
      }),
    ).toEqual({ name: "default", count: 1 });
  });

  it("throws the existing required-file style error for required missing files", () => {
    const root = createTempRoot("ulis-config-loader-");

    expect(() => loadRequiredConfigFile(root, "missing")).toThrow(
      `Required config file not found: missing.{yaml,yml,json} in ${root}`,
    );
    expect(() => loadValidatedConfigFile({ dir: root, baseName: "missing", schema: Schema, required: true })).toThrow(
      `Required config file not found: missing.{yaml,yml,json} in ${root}`,
    );
  });

  it("includes the file path in YAML parse errors", () => {
    const root = createTempRoot("ulis-config-loader-");
    const filePath = join(root, "config.yaml");
    writeConfig(root, "config.yaml", "name: [\n");

    expect(() => loadValidatedConfigFile({ dir: root, baseName: "config", schema: Schema, required: true })).toThrow(
      `Failed to parse ${filePath}:`,
    );
  });

  it("includes the file path in JSON parse errors", () => {
    const root = createTempRoot("ulis-config-loader-");
    const filePath = join(root, "config.json");
    writeConfig(root, "config.json", "{");

    expect(() => loadValidatedConfigFile({ dir: root, baseName: "config", schema: Schema, required: true })).toThrow(
      `Failed to parse ${filePath}:`,
    );
  });

  it("surfaces Zod validation failures from the validated helper with file path", () => {
    const root = createTempRoot("ulis-config-loader-");
    const filePath = join(root, "config.yaml");
    writeConfig(root, "config.yaml", "count: 1\n");

    expect(() => loadValidatedConfigFile({ dir: root, baseName: "config", schema: Schema, required: true })).toThrow(
      `Failed to validate config (${filePath}):`,
    );
  });
});
