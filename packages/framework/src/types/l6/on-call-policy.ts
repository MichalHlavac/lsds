// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { PersonRefSchema, TeamRefSchema } from "../../shared/refs.js";
import { DurationSchema } from "./slo.js";

// OnCallPolicy (kap. 4 § L6). Captures who is paged for which Service /
// DeploymentUnit, in what order, and with what response-time SLAs. Schema-
// level invariants enforce only what is locally falsifiable on a single
// object: contiguous escalation levels (1..N), zero delay on the primary
// level, and the required p1/p2 SLAs. The "must cover at least one
// Service / DeploymentUnit" rule (GR-L6-008) is graph-level and lives
// in the relationship registry / guardrail engine, not here.

export const ONCALL_COVERAGE_MODES = [
  "FOLLOW_THE_SUN",
  "ROTATING_WEEKLY",
  "ROTATING_DAILY",
  "DEDICATED",
] as const;
export const OnCallCoverageSchema = z.enum(ONCALL_COVERAGE_MODES);
export type OnCallCoverage = z.infer<typeof OnCallCoverageSchema>;

export const RespondentRefSchema = z.discriminatedUnion("kind", [
  TeamRefSchema,
  PersonRefSchema,
]);
export type RespondentRef = z.infer<typeof RespondentRefSchema>;

// Zero-duration ISO-8601 forms accepted for the primary escalation level.
// Restricting to this set keeps the invariant decidable without parsing.
const ZERO_DURATIONS: ReadonlySet<string> = new Set([
  "PT0S",
  "PT0M",
  "PT0H",
  "P0D",
]);

export const EscalationLevelSchema = z.object({
  level: z.number().int().min(1, "EscalationLevel.level must be >= 1"),
  respondent: RespondentRefSchema,
  escalationDelay: DurationSchema,
  notificationChannels: z
    .array(z.string().min(1, "notificationChannels entries must be non-empty"))
    .min(1, "EscalationLevel.notificationChannels must list at least one channel"),
});
export type EscalationLevel = z.infer<typeof EscalationLevelSchema>;

export const ResponseTimeSlaSchema = z.object({
  p1: DurationSchema,
  p2: DurationSchema,
  p3: DurationSchema.optional(),
  p4: DurationSchema.optional(),
});
export type ResponseTimeSla = z.infer<typeof ResponseTimeSlaSchema>;

export const OnCallPolicySchema = TknBaseSchema.extend({
  type: z.literal("OnCallPolicy"),
  layer: z.literal("L6"),
  description: z
    .string()
    .min(1, "OnCallPolicy.description must explain what this policy covers"),
  owner: TeamRefSchema,
  coverage: OnCallCoverageSchema,
  escalationLevels: z
    .array(EscalationLevelSchema)
    .min(1, "OnCallPolicy.escalationLevels must contain at least one level"),
  responseTimeSla: ResponseTimeSlaSchema,
}).superRefine((value, ctx) => {
  // Levels must be contiguous starting at 1: [1, 2, 3, ...]. Gaps or
  // duplicates would let a producer ship a policy with a phantom escalation
  // tier that no responder is bound to.
  for (let i = 0; i < value.escalationLevels.length; i++) {
    if (value.escalationLevels[i].level !== i + 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `OnCallPolicy.escalationLevels[${i}].level must be ${i + 1} (levels are contiguous starting at 1)`,
        path: ["escalationLevels", i, "level"],
      });
    }
  }
  // Primary level (the first responder) is paged immediately — a non-zero
  // delay there contradicts the meaning of "primary".
  const primary = value.escalationLevels[0];
  if (primary && !ZERO_DURATIONS.has(primary.escalationDelay)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "OnCallPolicy.escalationLevels[0].escalationDelay must be a zero duration (e.g. PT0S) — the primary level pages immediately",
      path: ["escalationLevels", 0, "escalationDelay"],
    });
  }
});
export type OnCallPolicy = z.infer<typeof OnCallPolicySchema>;

export const ON_CALL_POLICY_TRAVERSAL_WEIGHT = "EAGER" as const;
