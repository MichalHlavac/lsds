// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { RepoRefSchema, TeamRefSchema } from "../../shared/refs.js";

// Environment (kap. 4 § L6). Named execution environment where DeploymentUnits
// run. The schema enforces only the locally falsifiable invariants from the
// spec; access-restriction recommendations and the lowercase-slug name rule
// are semantic guardrails handled by the guardrail engine.

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

const ENVIRONMENT_TYPES_REQUIRING_IAC: ReadonlyArray<EnvironmentType> = [
  "PRODUCTION",
  "DR",
];

export const EnvironmentSchema = TknBaseSchema.extend({
  type: z.literal("Environment"),
  layer: z.literal("L6"),
  description: z.string().min(1, "Environment.description must describe what runs in this environment"),
  environmentType: EnvironmentTypeSchema,
  owner: TeamRefSchema,
  accessRestriction: AccessRestrictionSchema,
  promotionGate: z.string().min(1).optional(),
  iacReference: RepoRefSchema.optional(),
}).superRefine((value, ctx) => {
  const requiresIac = ENVIRONMENT_TYPES_REQUIRING_IAC.includes(value.environmentType);
  if (requiresIac && !value.iacReference) {
    // GR-L6-006: PRODUCTION / DR environments must be reproducible from IaC.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Environment.iacReference is required for environmentType=${value.environmentType} (GR-L6-006)`,
      path: ["iacReference"],
    });
  }
  if (requiresIac && (!value.promotionGate || value.promotionGate.trim() === "")) {
    // GR-L6-007: PRODUCTION / DR deploys must pass an explicit gate.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Environment.promotionGate is required for environmentType=${value.environmentType} (GR-L6-007)`,
      path: ["promotionGate"],
    });
  }
});
export type Environment = z.infer<typeof EnvironmentSchema>;

export const ENVIRONMENT_TRAVERSAL_WEIGHT = "EAGER" as const;
