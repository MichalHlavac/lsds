// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";

export const INTEGRATION_PATTERN_TYPES = [
  "REQUEST_RESPONSE",
  "PUB_SUB",
  "SAGA_ORCHESTRATION",
  "SAGA_CHOREOGRAPHY",
  "OUTBOX",
  "ANTI_CORRUPTION_LAYER",
  "CIRCUIT_BREAKER",
  "BACKEND_FOR_FRONTEND",
  "GATEWAY_AGGREGATOR",
  "CHANGE_DATA_CAPTURE",
  "API_COMPOSITION",
] as const;
export const IntegrationPatternTypeSchema = z.enum(INTEGRATION_PATTERN_TYPES);
export type IntegrationPatternType = z.infer<typeof IntegrationPatternTypeSchema>;

export const IntegrationPatternSchema = TknBaseSchema.extend({
  type: z.literal("IntegrationPattern"),
  layer: z.literal("L4"),
  description: z
    .string()
    .min(30, "IntegrationPattern.description must explain the integration shape (≥ 30 chars)"),
  patternType: IntegrationPatternTypeSchema,
  rationale: z
    .string()
    .min(
      30,
      "IntegrationPattern.rationale must explain why this pattern was chosen over alternatives (≥ 30 chars)",
    ),
  referenceUrl: z.string().url().optional(),
});
export type IntegrationPattern = z.infer<typeof IntegrationPatternSchema>;

export const INTEGRATION_PATTERN_TRAVERSAL_WEIGHT = "LAZY" as const;
