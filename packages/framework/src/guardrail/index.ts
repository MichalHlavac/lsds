export {
  ORIGINS, OriginSchema, type Origin,
  EVALUATIONS, EvaluationSchema, type Evaluation,
  SEVERITIES, SeveritySchema, type Severity,
  TRIGGERS, TriggerSchema, type Trigger,
  PROPAGATIONS, PropagationSchema, type Propagation,
  RuleIdSchema,
  GuardrailRuleSchema, type GuardrailRule,
} from "./types";
// LAYER_IDS/LayerId/LayerIdSchema from guardrail/types are intentionally not
// re-exported here — they extend the canonical LayerId with "XL" (cross-layer)
// which is a guardrail-internal concept. Use layer/index for the domain types.
export * from "./violation";
export { GUARDRAIL_CATALOG } from "./catalog";
export {
  listGuardrails,
  getGuardrail,
  getGuardrailOrThrow,
  guardrailsByLayer,
  guardrailsByObjectType,
  guardrailsByTrigger,
  guardrailsByOrigin,
  guardrailsByEvaluation,
  guardrailsBySeverity,
  findGuardrails,
  validateCatalog,
} from "./registry";
export type { GuardrailQuery } from "./registry";
