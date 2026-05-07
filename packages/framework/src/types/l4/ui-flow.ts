// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { TeamRefSchema } from "../../shared/refs.js";

export const UI_FLOW_PLATFORMS = ["WEB", "IOS", "ANDROID", "DESKTOP", "TERMINAL"] as const;
export const UiFlowPlatformSchema = z.enum(UI_FLOW_PLATFORMS);
export type UiFlowPlatform = z.infer<typeof UiFlowPlatformSchema>;

export const UI_FLOW_STEP_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const UiFlowStepSchema = z.object({
  id: z
    .string()
    .regex(
      UI_FLOW_STEP_ID_PATTERN,
      "UIFlow.steps[].id must be lower-kebab-case (e.g. 'enter-email')",
    ),
  name: z.string().min(1),
  description: z.string().min(1),
  userAction: z.string().optional(),
  nextStepIds: z.array(z.string()).default([]),
});
export type UiFlowStep = z.infer<typeof UiFlowStepSchema>;

export const UiFlowSchema = TknBaseSchema.extend({
  type: z.literal("UIFlow"),
  layer: z.literal("L4"),
  description: z.string().min(1),
  platform: UiFlowPlatformSchema,
  entryCondition: z.string().min(1, "UIFlow.entryCondition must describe how the flow starts"),
  successCondition: z
    .string()
    .min(1, "UIFlow.successCondition must describe what 'completed' means for this flow"),
  steps: z.array(UiFlowStepSchema).min(1, "UIFlow.steps must contain at least one step"),
  owner: TeamRefSchema,
}).superRefine((value, ctx) => {
  // Step ids must be unique inside a flow; nextStepIds must reference existing
  // step ids — these are the simplest invariants that catch broken flows
  // before they ship.
  const ids = new Set<string>();
  for (const [i, step] of value.steps.entries()) {
    if (ids.has(step.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `UIFlow.steps[].id must be unique within the flow; duplicate: ${step.id}`,
        path: ["steps", i, "id"],
      });
    }
    ids.add(step.id);
  }
  for (const [i, step] of value.steps.entries()) {
    for (const [j, next] of step.nextStepIds.entries()) {
      if (!ids.has(next)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `UIFlow.steps[${i}].nextStepIds references unknown step id '${next}'`,
          path: ["steps", i, "nextStepIds", j],
        });
      }
    }
  }
});
export type UiFlow = z.infer<typeof UiFlowSchema>;

