// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { TeamRefSchema } from "../../shared/refs.js";

// SLO (kap. 4 § L6). Each SLO traces to a QualityAttribute (L3) and
// validates a Service / ArchitectureComponent — those graph-level edges
// live in the relationship registry, not on the schema. The schema-level
// invariants here cover only what is locally falsifiable.

export const SLO_TYPES = ["AVAILABILITY", "LATENCY", "ERROR_RATE", "THROUGHPUT"] as const;
export const SloTypeSchema = z.enum(SLO_TYPES);
export type SloType = z.infer<typeof SloTypeSchema>;

// ISO 8601 duration (rolling window). Permissive subset that covers the
// common shapes operators reach for: P30D, PT1H, PT15M, P1Y.
const ISO_DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(\d+H)?(\d+M)?(\d+S)?)?$/;
export const DurationSchema = z.string().regex(ISO_DURATION, "must be an ISO-8601 duration (e.g. P30D, PT1H)");

export const SloSchema = TknBaseSchema.extend({
  type: z.literal("SLO"),
  layer: z.literal("L6"),
  sloType: SloTypeSchema,
  target: z.number(),
  targetUnit: z.string().min(1, "SLO.targetUnit must name the unit (e.g. ms, %, rps)"),
  window: DurationSchema,
  measurementMethod: z
    .string()
    .min(1, "SLO.measurementMethod must describe how the metric is collected"),
  owner: TeamRefSchema,
}).superRefine((value, ctx) => {
  if ((value.sloType === "AVAILABILITY" || value.sloType === "ERROR_RATE") && (value.target < 0 || value.target > 100)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${value.sloType} target must be a percentage in [0, 100]`,
      path: ["target"],
    });
  }
  if ((value.sloType === "LATENCY" || value.sloType === "THROUGHPUT") && value.target < 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${value.sloType} target must be non-negative`,
      path: ["target"],
    });
  }
});
export type Slo = z.infer<typeof SloSchema>;
