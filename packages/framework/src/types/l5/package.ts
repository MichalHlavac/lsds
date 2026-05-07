// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { RepoRefSchema } from "../../shared/refs.js";

export const PACKAGE_MANAGERS = [
  "NPM",
  "PYPI",
  "MAVEN",
  "GRADLE",
  "CARGO",
  "GO_MOD",
  "NUGET",
  "OTHER",
] as const;
export const PackageManagerSchema = z.enum(PACKAGE_MANAGERS);
export type PackageManager = z.infer<typeof PackageManagerSchema>;

export const PackageSchema = TknBaseSchema.extend({
  type: z.literal("Package"),
  layer: z.literal("L5"),
  description: z.string().min(1),
  packageManager: PackageManagerSchema,
  packageName: z.string().min(1),
  registryUrl: z.string().url("Package.registryUrl must be a valid URL").optional(),
  repoRef: RepoRefSchema.optional(),
  isPublic: z.boolean(),
});
export type Package = z.infer<typeof PackageSchema>;

