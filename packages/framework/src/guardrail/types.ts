// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { LAYER_IDS as BASE_LAYER_IDS } from "../layer/index.js";

// Guardrails operate over the six framework layers PLUS an "XL" pseudo-layer
// for cross-layer rules (kap. 5). The framework's `LayerId` type covers
// L1–L6 only; guardrails widen it to include XL via `GuardrailLayerId`.
export const GUARDRAIL_LAYER_IDS = [...BASE_LAYER_IDS, "XL"] as const;
export const GuardrailLayerIdSchema = z.enum(GUARDRAIL_LAYER_IDS);
export type GuardrailLayerId = z.infer<typeof GuardrailLayerIdSchema>;

export const ORIGINS = ["STRUCTURAL", "SEMANTIC"] as const;
export const OriginSchema = z.enum(ORIGINS);
export type Origin = z.infer<typeof OriginSchema>;

export const EVALUATIONS = ["PRESCRIPTIVE", "DESCRIPTIVE"] as const;
export const EvaluationSchema = z.enum(EVALUATIONS);
export type Evaluation = z.infer<typeof EvaluationSchema>;

export const SEVERITIES = ["ERROR", "WARNING", "INFO"] as const;
export const SeveritySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof SeveritySchema>;

export const TRIGGERS = ["CREATE", "UPDATE", "DELETE", "ARCHIVE", "PERIODIC"] as const;
export const TriggerSchema = z.enum(TRIGGERS);
export type Trigger = z.infer<typeof TriggerSchema>;

export const PROPAGATIONS = [
  "NONE",
  "UPWARD",
  "DOWNWARD",
  "BOTH",
  "LATERAL",
] as const;
export const PropagationSchema = z.enum(PROPAGATIONS);
export type Propagation = z.infer<typeof PropagationSchema>;

const RULE_ID_PATTERN = /^GR-(L[1-6]|XL)-\d{3}$/;
export const RuleIdSchema = z
  .string()
  .regex(RULE_ID_PATTERN, "rule_id must match GR-{L1..L6|XL}-NNN");
export type RuleId = z.infer<typeof RuleIdSchema>;

export const ScopeSchema = z
  .object({
    object_type: z.string().min(1),
    triggers: z.array(TriggerSchema).min(1),
    relationship_type: z.string().min(1).optional(),
  })
  .strict();
export type Scope = z.infer<typeof ScopeSchema>;

export const GuardrailRuleSchema = z
  .object({
    rule_id: RuleIdSchema,
    name: z.string().min(1).max(120),
    layer: GuardrailLayerIdSchema,
    origin: OriginSchema,
    evaluation: EvaluationSchema,
    severity: SeveritySchema,
    scope: ScopeSchema,
    condition: z.string().min(1),
    rationale: z.string().min(20),
    remediation: z.string().min(20),
    propagation: PropagationSchema,
  })
  .strict()
  .superRefine((rule, ctx) => {
    const layerFromId = rule.rule_id.split("-")[1];
    if (layerFromId !== rule.layer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `rule_id layer (${layerFromId}) must match layer field (${rule.layer})`,
        path: ["rule_id"],
      });
    }
  });

export type GuardrailRule = z.infer<typeof GuardrailRuleSchema>;
