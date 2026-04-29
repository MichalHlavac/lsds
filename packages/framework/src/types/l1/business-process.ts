// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { TeamRefSchema } from "../../shared/refs.js";

export const ProcessStepSchema = z.object({
  order: z.number().int().nonnegative(),
  name: z.string().min(1),
  description: z.string().optional(),
});
export type ProcessStep = z.infer<typeof ProcessStepSchema>;

export const BusinessProcessSchema = TknBaseSchema.extend({
  type: z.literal("BusinessProcess"),
  layer: z.literal("L1"),
  steps: z
    .array(ProcessStepSchema)
    .min(2, "BusinessProcess.steps must contain at least two steps"),
  owner: TeamRefSchema,
  triggers: z.array(z.string().min(1)).optional(),
  outcomes: z
    .array(z.string().min(1))
    .min(1, "BusinessProcess.outcomes must contain at least one outcome"),
});
export type BusinessProcess = z.infer<typeof BusinessProcessSchema>;
