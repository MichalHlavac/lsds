// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { TeamRefSchema } from "../../shared/refs.js";
import { DurationSchema } from "./slo.js";

// Runbook (kap. 4 § L6). Captures the on-call playbook for a known
// failure mode. Steps are ordered and must be ≥ 2 — a one-step "page
// the on-call" is not a runbook. Alert.runbookReference is the inbound
// edge that enforces "every alert must have a runbook" (kap. 4 § L6).

export const RUNBOOK_SEVERITIES = ["P1", "P2", "P3", "P4"] as const;
export const RunbookSeveritySchema = z.enum(RUNBOOK_SEVERITIES);
export type RunbookSeverity = z.infer<typeof RunbookSeveritySchema>;

export const RunbookStepSchema = z.object({
  order: z.number().int().min(1),
  action: z.string().min(1, "RunbookStep.action must describe a concrete operator action"),
  expectedOutcome: z.string().optional(),
});
export type RunbookStep = z.infer<typeof RunbookStepSchema>;

export const RunbookSchema = TknBaseSchema.extend({
  type: z.literal("Runbook"),
  layer: z.literal("L6"),
  title: z.string().min(1),
  triggerCondition: z
    .string()
    .min(1, "Runbook.triggerCondition must describe when this runbook applies"),
  severity: RunbookSeveritySchema,
  steps: z.array(RunbookStepSchema).min(2, "Runbook.steps must contain at least 2 ordered steps"),
  owner: TeamRefSchema,
  lastTested: z.string().date().optional(),
  estimatedResolutionTime: DurationSchema.optional(),
}).superRefine((value, ctx) => {
  for (let i = 0; i < value.steps.length; i++) {
    if (value.steps[i].order !== i + 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Runbook.steps[${i}].order must be ${i + 1} (steps are sequentially ordered starting at 1)`,
        path: ["steps", i, "order"],
      });
    }
  }
});
export type Runbook = z.infer<typeof RunbookSchema>;
