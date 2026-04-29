import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { RepoRefSchema } from "../../shared/refs.js";

// Test (kap. 4 § L5). Tests are referenced via the `validated-by`
// relationship from CodeModule / Service / APIEndpoint / etc. Outside
// the framework the actual test code lives in a repository — we keep
// only the metadata: type, scope, where to find it and whether CI runs
// it on every change.

export const TEST_TYPES = [
  "UNIT",
  "INTEGRATION",
  "CONTRACT",
  "E2E",
  "PERFORMANCE",
  "SECURITY",
] as const;
export const TestTypeSchema = z.enum(TEST_TYPES);
export type TestType = z.infer<typeof TestTypeSchema>;

export const TestSchema = TknBaseSchema.extend({
  type: z.literal("Test"),
  layer: z.literal("L5"),
  testType: TestTypeSchema,
  scopeDescription: z
    .string()
    .min(1, "Test.scopeDescription must state what the test covers"),
  repoRef: RepoRefSchema,
  ciIntegration: z.boolean(),
});
export type Test = z.infer<typeof TestSchema>;
