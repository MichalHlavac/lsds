// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { TknRefSchema } from "../../shared/refs.js";
import { PackageManagerSchema } from "./package.js";

export const DEPENDENCY_CRITICALITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const DependencyCriticalitySchema = z.enum(DEPENDENCY_CRITICALITIES);
export type DependencyCriticality = z.infer<typeof DependencyCriticalitySchema>;

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

export const EXTERNAL_DEPENDENCY_TRAVERSAL_WEIGHT = "LAZY" as const;
