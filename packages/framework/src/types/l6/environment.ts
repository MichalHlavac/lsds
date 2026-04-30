// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { RepoRefSchema, TeamRefSchema } from "../../shared/refs.js";

// Environment (kap. 4 § L6, lines 606–635). Named execution environment
// where deployment units run — captures promotion chain, access control
// and IaC traceability. The schema-level invariants here cover only what
// is locally falsifiable from the TKN itself; cross-graph rules live as
// guardrails (GR-L6-006/007).

export const ENVIRONMENT_TYPES = [
  "PRODUCTION",
  "STAGING",
  "DEVELOPMENT",
  "PREVIEW",
  "DR",
] as const;
export const EnvironmentTypeSchema = z.enum(ENVIRONMENT_TYPES);
export type EnvironmentType = z.infer<typeof EnvironmentTypeSchema>;

export const ACCESS_RESTRICTIONS = [
  "UNRESTRICTED",
  "TEAM_ONLY",
  "APPROVALS_REQUIRED",
] as const;
export const AccessRestrictionSchema = z.enum(ACCESS_RESTRICTIONS);
export type AccessRestriction = z.infer<typeof AccessRestrictionSchema>;

export const EnvironmentSchema = TknBaseSchema.extend({
  type: z.literal("Environment"),
  layer: z.literal("L6"),
  description: z.string().min(1),
  environmentType: EnvironmentTypeSchema,
  owner: TeamRefSchema,
  accessRestriction: AccessRestrictionSchema,
  // Required when environmentType ∈ {PRODUCTION, DR} (GR-L6-007). Free-text
  // description of what must pass before deploys reach this environment
  // (e.g. "smoke tests + manual approval from #ops").
  promotionGate: z.string().min(1).optional(),
  // Required when environmentType ∈ {PRODUCTION, DR} (GR-L6-006). RepoRef
  // pointing at the IaC definition that creates and reconciles this env.
  iacReference: RepoRefSchema.optional(),
}).superRefine((value, ctx) => {
  const requiresIacAndGate =
    value.environmentType === "PRODUCTION" || value.environmentType === "DR";
  if (requiresIacAndGate && !value.iacReference) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Environment.iacReference is required for environmentType=PRODUCTION or DR (GR-L6-006)",
      path: ["iacReference"],
    });
  }
  if (requiresIacAndGate && !value.promotionGate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Environment.promotionGate is required for environmentType=PRODUCTION or DR (GR-L6-007)",
      path: ["promotionGate"],
    });
  }
});
export type Environment = z.infer<typeof EnvironmentSchema>;

export const ENVIRONMENT_TRAVERSAL_WEIGHT = "EAGER" as const;
