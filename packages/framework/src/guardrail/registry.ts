import { GUARDRAIL_CATALOG } from "./catalog";
import {
  GuardrailRule,
  GuardrailRuleSchema,
  LayerId,
  Trigger,
  Origin,
  Evaluation,
  Severity,
} from "./types";

const BY_ID: ReadonlyMap<string, GuardrailRule> = (() => {
  const map = new Map<string, GuardrailRule>();
  for (const rule of GUARDRAIL_CATALOG) {
    if (map.has(rule.rule_id)) {
      throw new Error(`Duplicate guardrail rule_id: ${rule.rule_id}`);
    }
    map.set(rule.rule_id, rule);
  }
  return map;
})();

export function listGuardrails(): ReadonlyArray<GuardrailRule> {
  return GUARDRAIL_CATALOG;
}

export function getGuardrail(ruleId: string): GuardrailRule | undefined {
  return BY_ID.get(ruleId);
}

export function getGuardrailOrThrow(ruleId: string): GuardrailRule {
  const rule = BY_ID.get(ruleId);
  if (!rule) {
    throw new Error(`Unknown guardrail rule_id: ${ruleId}`);
  }
  return rule;
}

export function guardrailsByLayer(layer: LayerId): GuardrailRule[] {
  return GUARDRAIL_CATALOG.filter((r) => r.layer === layer);
}

export function guardrailsByObjectType(objectType: string): GuardrailRule[] {
  return GUARDRAIL_CATALOG.filter(
    (r) => r.scope.object_type === objectType || r.scope.object_type === "*",
  );
}

export function guardrailsByTrigger(trigger: Trigger): GuardrailRule[] {
  return GUARDRAIL_CATALOG.filter((r) => r.scope.triggers.includes(trigger));
}

export function guardrailsByOrigin(origin: Origin): GuardrailRule[] {
  return GUARDRAIL_CATALOG.filter((r) => r.origin === origin);
}

export function guardrailsByEvaluation(evaluation: Evaluation): GuardrailRule[] {
  return GUARDRAIL_CATALOG.filter((r) => r.evaluation === evaluation);
}

export function guardrailsBySeverity(severity: Severity): GuardrailRule[] {
  return GUARDRAIL_CATALOG.filter((r) => r.severity === severity);
}

export interface GuardrailQuery {
  layer?: LayerId;
  objectType?: string;
  trigger?: Trigger;
  origin?: Origin;
  evaluation?: Evaluation;
  severity?: Severity;
}

export function findGuardrails(query: GuardrailQuery): GuardrailRule[] {
  return GUARDRAIL_CATALOG.filter((rule) => {
    if (query.layer && rule.layer !== query.layer) return false;
    if (query.origin && rule.origin !== query.origin) return false;
    if (query.evaluation && rule.evaluation !== query.evaluation) return false;
    if (query.severity && rule.severity !== query.severity) return false;
    if (query.trigger && !rule.scope.triggers.includes(query.trigger)) return false;
    if (
      query.objectType &&
      rule.scope.object_type !== query.objectType &&
      rule.scope.object_type !== "*"
    ) {
      return false;
    }
    return true;
  });
}

export function validateCatalog(): void {
  for (const rule of GUARDRAIL_CATALOG) {
    GuardrailRuleSchema.parse(rule);
  }
}
