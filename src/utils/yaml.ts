import { z } from "zod";

/**
 * Empty / whitespace-only YAML documents parse as `null`. Coerce `null` / `undefined`
 * to `{}` before object validation so tree configs validate as “no keys set”.
 */
export function emptyYamlAsEmptyObject<S extends z.ZodType>(schema: S) {
  return z.preprocess((input: unknown) => (input == null ? {} : input), schema);
}
