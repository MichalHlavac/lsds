// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

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

export const ModuleSchema = TknBaseSchema.extend({
  type: z.literal("Module"),
  layer: z.literal("L5"),
  description: z.string().min(1),
  owner: TeamRefSchema,
  language: ModuleLanguageSchema,
  repoRef: RepoRefSchema,
  path: z.string().min(1, "Module.path must be a non-empty repo-relative path"),
  publicApi: z.boolean(),
  testCoverageTarget: z.number().min(0).max(100).optional(),
});
export type Module = z.infer<typeof ModuleSchema>;

export const MODULE_TRAVERSAL_WEIGHT = "LAZY" as const;
