// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

// Attribute set tracks research kap. 4 § L5 / ExternalDependency.
// `license` backs GR-L5-007 (GPL-in-COMMERCIAL); `dependencyType` and
// `updatePolicy` are the kap. 4 taxonomy/maintenance attributes.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { TknRefSchema } from "../../shared/refs.js";
import { PackageManagerSchema } from "./package.js";

export const DEPENDENCY_CRITICALITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const DependencyCriticalitySchema = z.enum(DEPENDENCY_CRITICALITIES);
export type DependencyCriticality = z.infer<typeof DependencyCriticalitySchema>;

export const DEPENDENCY_TYPES = ["LIBRARY", "SERVICE", "TOOL"] as const;
export const DependencyTypeSchema = z.enum(DEPENDENCY_TYPES);
export type DependencyType = z.infer<typeof DependencyTypeSchema>;

export const DEPENDENCY_UPDATE_POLICIES = ["IMMEDIATE", "SCHEDULED", "MANUAL"] as const;
export const DependencyUpdatePolicySchema = z.enum(DEPENDENCY_UPDATE_POLICIES);
export type DependencyUpdatePolicy = z.infer<typeof DependencyUpdatePolicySchema>;

export const ExternalDependencySchema = TknBaseSchema.extend({
  type: z.literal("ExternalDependency"),
  layer: z.literal("L5"),
  description: z.string().min(1),
  // Link to the L3 ExternalSystem node this dependency binds to (ADR A8).
  externalSystemRef: TknRefSchema.optional(),
  packageManager: PackageManagerSchema,
  packageName: z.string().min(1),
  versionConstraint: z.string().min(1, "ExternalDependency.versionConstraint must be a non-empty SemVer constraint (e.g. '^3.2.1')"),
  isDirect: z.boolean(),
  hasKnownVulnerability: z.boolean(),
  criticality: DependencyCriticalitySchema,
  // ISO date of last security audit (license + CVE + provenance). Required by GR-L5-004 for CRITICAL deps.
  securityAuditDate: z.string().date().optional(),
  // SPDX identifier string (e.g. "MIT", "Apache-2.0", "GPL-3.0-only"). Read by GR-L5-007 (kap. 4 § L5 / ExternalDependency).
  // Optional: legacy private deps may have no upstream metadata.
  license: z.string().min(1).optional(),
  // Taxonomy (kap. 4 § L5 / ExternalDependency). Default LIBRARY keeps existing rows migration-safe.
  dependencyType: DependencyTypeSchema.default("LIBRARY"),
  // Maintenance policy (kap. 4 § L5 / ExternalDependency). Reserved for future GR-L5 rules; optional today.
  updatePolicy: DependencyUpdatePolicySchema.optional(),
}).superRefine((value, ctx) => {
  // When a vulnerability is flagged, externalSystemRef must be set so the
  // L3 owner is traceable for remediation escalation (ADR A8).
  if (value.hasKnownVulnerability && !value.externalSystemRef) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "ExternalDependency.externalSystemRef is required when hasKnownVulnerability=true (ADR A8: L3 owner traceability)",
      path: ["externalSystemRef"],
    });
  }
});
export type ExternalDependency = z.infer<typeof ExternalDependencySchema>;

