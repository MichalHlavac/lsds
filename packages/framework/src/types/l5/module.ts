import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { RepoRefSchema, TeamRefSchema } from "../../shared/refs.js";

export const MODULE_LANGUAGES = [
  "TYPESCRIPT",
  "JAVASCRIPT",
  "PYTHON",
  "JAVA",
  "KOTLIN",
  "GO",
  "RUST",
  "CSHARP",
  "OTHER",
] as const;
export const ModuleLanguageSchema = z.enum(MODULE_LANGUAGES);
export type ModuleLanguage = z.infer<typeof ModuleLanguageSchema>;

// Kap. 4 § L5 / CodeModule.module_type — clean/hexagonal architecture
// classification. Distinct from `language` (TechnologyRef analogue): module_type
// answers "where does this module sit in the dependency rule" and powers
// guardrails like GR-L5-003 (DOMAIN must not depend on INFRASTRUCTURE).
export const MODULE_TYPES = [
  "DOMAIN",
  "APPLICATION",
  "INFRASTRUCTURE",
  "PRESENTATION",
  "SHARED",
] as const;
export const ModuleTypeSchema = z.enum(MODULE_TYPES);
export type ModuleType = z.infer<typeof ModuleTypeSchema>;

export const ModuleSchema = TknBaseSchema.extend({
  type: z.literal("Module"),
  layer: z.literal("L5"),
  description: z.string().min(1),
  owner: TeamRefSchema,
  language: ModuleLanguageSchema,
  moduleType: ModuleTypeSchema,
  repoRef: RepoRefSchema,
  path: z.string().min(1, "Module.path must be a non-empty repo-relative path"),
  publicApi: z.boolean(),
  testCoverageTarget: z.number().min(0).max(100).optional(),
});
export type Module = z.infer<typeof ModuleSchema>;

export const MODULE_TRAVERSAL_WEIGHT = "LAZY" as const;
