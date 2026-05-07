// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { PersonRefSchema, TeamRefSchema } from "../../shared/refs.js";
import { DurationSchema } from "./slo.js";

// OnCallPolicy (kap. 4 § L6, lines 637–682). On-call coverage policy:
// who is paged, in what order, and with what response-time SLA. The
// graph-level edges (`covers` → Service|DeploymentUnit, `uses` → Runbook)
// live in the relationship registry. The schema-level invariants here
// cover only what is locally falsifiable from the TKN itself — the
// "must have ≥1 covers" rule is a graph guardrail (GR-L6-008).

export const COVERAGE_TYPES = [
  "FOLLOW_THE_SUN",
  "ROTATING_WEEKLY",
  "ROTATING_DAILY",
  "DEDICATED",
] as const;
export const CoverageTypeSchema = z.enum(COVERAGE_TYPES);
export type CoverageType = z.infer<typeof CoverageTypeSchema>;

// Either a TeamRef or PersonRef can be paged — the kap. 4 spec admits both.
export const RespondentSchema = z.union([TeamRefSchema, PersonRefSchema]);
export type Respondent = z.infer<typeof RespondentSchema>;

export const EscalationLevelSchema = z.object({
  // Level 1 = primary, 2 = secondary, etc. Contiguous numbering enforced
  // at the policy level (see superRefine below).
  level: z.number().int().min(1),
  respondent: RespondentSchema,
  // ISO-8601 duration. For level=1 the spec mandates 0 / PT0S — primary
  // is paged immediately, escalation delays only apply for levels ≥ 2.
  escalationDelay: DurationSchema,
  // Free-form channel identifiers (pagerduty, slack, email, etc.). At
  // least one channel must be declared for the level to be actionable.
  notificationChannels: z
    .array(z.string().min(1))
    .min(1, "EscalationLevel.notificationChannels must list ≥ 1 channel"),
});
export type EscalationLevel = z.infer<typeof EscalationLevelSchema>;

// Level-1 delay must be zero. Permissive subset matching the kap. 4 spec.
const ZERO_DURATION_PATTERN = /^P(T0[HMS]?|0D)$|^PT0S$/;

export const ResponseTimeSlaSchema = z
  .object({
    p1: DurationSchema,
    p2: DurationSchema,
    p3: DurationSchema.optional(),
    p4: DurationSchema.optional(),
  })
  .strict();
export type ResponseTimeSla = z.infer<typeof ResponseTimeSlaSchema>;

export const OnCallPolicySchema = TknBaseSchema.extend({
  type: z.literal("OnCallPolicy"),
  layer: z.literal("L6"),
  description: z.string().min(1),
  owner: TeamRefSchema,
  coverage: CoverageTypeSchema,
  escalationLevels: z
    .array(EscalationLevelSchema)
    .min(1, "OnCallPolicy.escalationLevels must contain ≥ 1 level"),
  responseTimeSla: ResponseTimeSlaSchema,
}).superRefine((value, ctx) => {
  // escalation_levels must be numbered 1..N contiguously (kap. 4 § L6
  // structural invariant — GR-L6-008).
  const sorted = [...value.escalationLevels].sort((a, b) => a.level - b.level);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].level !== i + 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `OnCallPolicy.escalationLevels must be numbered 1..N contiguously; expected level ${i + 1} at index ${i}, got ${sorted[i].level}`,
        path: ["escalationLevels"],
      });
      break;
    }
  }

  // Level 1 escalationDelay must be 0 / PT0S — primary is paged at t=0.
  const level1 = value.escalationLevels.find((lvl) => lvl.level === 1);
  if (level1 && !ZERO_DURATION_PATTERN.test(level1.escalationDelay)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "OnCallPolicy.escalationLevels[level=1].escalationDelay must be PT0S (primary is paged immediately)",
      path: ["escalationLevels"],
    });
  }
});
export type OnCallPolicy = z.infer<typeof OnCallPolicySchema>;

