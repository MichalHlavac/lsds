// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import {
  RepoRefSchema,
  TechnologyRefSchema,
} from "../../shared/refs.js";

export const MODULE_TYPES = [
  "DOMAIN",
  "APPLICATION",
  "INFRASTRUCTURE",
  "PRESENTATION",
  "SHARED",
] as const;
export const ModuleTypeSchema = z.enum(MODULE_TYPES);
export type ModuleType = z.infer<typeof ModuleTypeSchema>;

// Spec kap. 4: CodeModule.repository_reference is (url + path) — both required.
// RepoRefSchema marks `path` optional for general repo references; CodeModule
// requires it so the catalog can point to a concrete location in source control.
const CodeModuleRepositoryReferenceSchema = RepoRefSchema.extend({
  path: z
    .string()
    .min(
      1,
      "CodeModule.repositoryReference.path must be a non-empty repo-relative path",
    ),
});

export const CodeModuleSchema = TknBaseSchema.extend({
  type: z.literal("CodeModule"),
  layer: z.literal("L5"),
  description: z.string().min(1),
  language: TechnologyRefSchema,
  moduleType: ModuleTypeSchema,
  repositoryReference: CodeModuleRepositoryReferenceSchema,
});
export type CodeModule = z.infer<typeof CodeModuleSchema>;

