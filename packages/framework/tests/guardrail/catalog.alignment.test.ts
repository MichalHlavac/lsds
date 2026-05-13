// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import { getGuardrailOrThrow } from "../../src/guardrail";
import { ExternalDependencySchema } from "../../src/types/l5/external-dependency.js";
import { tknBase } from "../fixtures.js";

// Lock-in test for the kap. 4 alignment scan (LSDS-83 → LSDS-90).
// Each assertion captures a previously drifted field/edge name; if the
// catalog drifts again, this file fails loudly with the exact rule.
describe("catalog field-name alignment with kap. 4", () => {
  it("GR-L1-007 measures BusinessGoal staleness from last_review_date", () => {
    const rule = getGuardrailOrThrow("GR-L1-007");
    expect(rule.condition).toContain("object.last_review_date");
    expect(rule.condition).not.toContain("last_reviewed_at");
  });

  it("GR-L1-008 measures Requirement staleness from approved_at, not created_at", () => {
    const rule = getGuardrailOrThrow("GR-L1-008");
    expect(rule.condition).toContain("requirement.approved_at");
    expect(rule.condition).not.toContain("requirement.created_at");
  });

  it("GR-L1-001 walks BusinessCapability `traces-to` BusinessGoal (canonical strategic-alignment edge)", () => {
    // Positive: capability→goal alignment is the canonical traces-to edge
    // (kap. 2.2). Rule blocks creation of orphan capabilities (PRESCRIPTIVE+ERROR)
    // and propagates UPWARD so a missing strategic root surfaces violations on
    // downstream nodes that depend on the capability.
    const rule = getGuardrailOrThrow("GR-L1-001");
    expect(rule.scope.object_type).toBe("BusinessCapability");
    expect(rule.condition).toContain("type='traces-to'");
    expect(rule.condition).toContain("target_type='BusinessGoal'");
    expect(rule.condition).toContain(">= 1");
    expect(rule.scope.relationship_type).toBe("traces-to");
    expect(rule.origin).toBe("STRUCTURAL");
    expect(rule.evaluation).toBe("PRESCRIPTIVE");
    expect(rule.severity).toBe("ERROR");
    expect(rule.propagation).toBe("UPWARD");
    // Negative: drift guard — must not use invented relationship names or
    // non-canonical target types for the strategic-alignment edge.
    expect(rule.condition).not.toContain("type='supports'");
    expect(rule.condition).not.toContain("type='advances'");
    expect(rule.condition).not.toContain("type='aligned-with'");
    expect(rule.condition).not.toContain("type='realizes-goal'");
    expect(rule.condition).not.toContain("target_type='BusinessObjective'");
    expect(rule.condition).not.toContain("target_type='Goal'");
  });

  it("GR-L1-002 reads BusinessGoal.success_metrics (kap. 4 attribute name)", () => {
    // Positive: rule reads the canonical success_metrics attribute and blocks
    // when none are declared. Sloganeering goals are caught at CREATE/UPDATE.
    const rule = getGuardrailOrThrow("GR-L1-002");
    expect(rule.scope.object_type).toBe("BusinessGoal");
    expect(rule.condition).toContain("object.success_metrics");
    expect(rule.condition).toContain(">= 1");
    expect(rule.origin).toBe("STRUCTURAL");
    expect(rule.evaluation).toBe("PRESCRIPTIVE");
    expect(rule.severity).toBe("ERROR");
    // Negative: drift guard — must not use shortened or alternative metric
    // field names that have appeared in earlier drafts.
    expect(rule.condition).not.toContain("object.metrics");
    expect(rule.condition).not.toContain("object.kpis");
    expect(rule.condition).not.toContain("object.outcomes");
    expect(rule.condition).not.toContain("object.objectives");
    expect(rule.condition).not.toContain("object.goal_metrics");
  });

  it("GR-L1-003 reads Requirement.motivation (kap. 4 attribute name) for non-empty check", () => {
    // Positive: rule blocks Requirements with missing or empty motivation —
    // the "why" anchor for downstream impact analysis (kap. 2.7).
    const rule = getGuardrailOrThrow("GR-L1-003");
    expect(rule.scope.object_type).toBe("Requirement");
    expect(rule.condition).toContain("object.motivation");
    expect(rule.condition).toContain("!= null");
    expect(rule.condition).toContain("object.motivation.length > 0");
    expect(rule.origin).toBe("STRUCTURAL");
    expect(rule.evaluation).toBe("PRESCRIPTIVE");
    expect(rule.severity).toBe("ERROR");
    // Negative: drift guard — `rationale`/`justification`/`reason` are common
    // synonyms but not the canonical kap. 4 field name on Requirement.
    expect(rule.condition).not.toContain("object.rationale");
    expect(rule.condition).not.toContain("object.justification");
    expect(rule.condition).not.toContain("object.reason");
    expect(rule.condition).not.toContain("object.purpose");
    expect(rule.condition).not.toContain("object.why");
  });

  it("GR-L1-004 reads Requirement.acceptance_criteria (kap. 4 snake_case attribute)", () => {
    // Positive: rule reads the canonical acceptance_criteria attribute and
    // blocks Requirements with no testable acceptance contract.
    const rule = getGuardrailOrThrow("GR-L1-004");
    expect(rule.scope.object_type).toBe("Requirement");
    expect(rule.condition).toContain("object.acceptance_criteria");
    expect(rule.condition).toContain(">= 1");
    expect(rule.origin).toBe("STRUCTURAL");
    expect(rule.evaluation).toBe("PRESCRIPTIVE");
    expect(rule.severity).toBe("ERROR");
    // Negative: drift guard — must not use shortened or non-canonical field
    // names. Catalog conditions use snake_case even though the TS schema
    // declares acceptanceCriteria in camelCase.
    expect(rule.condition).not.toContain("object.criteria");
    expect(rule.condition).not.toMatch(/object\.acceptance(?!_criteria)/);
    expect(rule.condition).not.toContain("object.acceptanceCriteria");
    expect(rule.condition).not.toContain("object.ac_list");
    expect(rule.condition).not.toContain("object.tests");
  });

  it("GR-L1-005 walks Requirement `part-of` BusinessCapability (canonical ownership edge)", () => {
    // Positive: ownership of a Requirement under a BusinessCapability is
    // expressed as a part-of edge (kap. 2.2). Rule blocks free-floating
    // requirements (PRESCRIPTIVE+ERROR, propagation UPWARD).
    const rule = getGuardrailOrThrow("GR-L1-005");
    expect(rule.scope.object_type).toBe("Requirement");
    expect(rule.condition).toContain("type='part-of'");
    expect(rule.condition).toContain("target_type='BusinessCapability'");
    expect(rule.condition).toContain(">= 1");
    expect(rule.scope.relationship_type).toBe("part-of");
    expect(rule.origin).toBe("STRUCTURAL");
    expect(rule.evaluation).toBe("PRESCRIPTIVE");
    expect(rule.severity).toBe("ERROR");
    expect(rule.propagation).toBe("UPWARD");
    // Negative: drift guard — synonyms for ownership/membership are easy to
    // reach for but break the kap. 2.2 catalog. The edge MUST be `part-of`.
    expect(rule.condition).not.toContain("type='belongs-to'");
    expect(rule.condition).not.toContain("type='owned-by'");
    expect(rule.condition).not.toContain("type='member-of'");
    expect(rule.condition).not.toContain("type='in'");
    expect(rule.condition).not.toContain("type='child-of'");
  });

  it("GR-L1-006 walks BusinessGoal incoming `traces-to` from BusinessCapability (orphan-goal scan)", () => {
    // Positive: incoming traces-to from BusinessCapability is the canonical
    // signal that a goal will be delivered. Rule fires when that count is 0
    // (DESCRIPTIVE+WARNING, PERIODIC scan + UPDATE re-check).
    const rule = getGuardrailOrThrow("GR-L1-006");
    expect(rule.scope.object_type).toBe("BusinessGoal");
    expect(rule.condition).toContain("incoming_relationships");
    expect(rule.condition).toContain("type='traces-to'");
    expect(rule.condition).toContain("source_type='BusinessCapability'");
    expect(rule.condition).toContain("== 0");
    expect(rule.origin).toBe("SEMANTIC");
    expect(rule.evaluation).toBe("DESCRIPTIVE");
    expect(rule.severity).toBe("WARNING");
    expect(rule.scope.triggers).toContain("PERIODIC");
    expect(rule.scope.triggers).toContain("UPDATE");
    expect(rule.propagation).toBe("DOWNWARD");
    // Negative: drift guard — the orphan check MUST walk the incoming side
    // (capability→goal) and MUST NOT read object.relationships (which would
    // be the goal's outgoing edges, not its supporters), and MUST NOT swap
    // the source type for BusinessGoal (self-loops aren't the signal).
    expect(rule.condition).not.toMatch(/^object\.relationships/);
    expect(rule.condition).not.toContain("outgoing_relationships");
    expect(rule.condition).not.toContain("source_type='BusinessGoal'");
    expect(rule.condition).not.toContain("type='supports'");
    expect(rule.condition).not.toContain("type='advances'");
  });

  it("GR-L1-009 reads Requirement.status='APPROVED' and object.impacts (kap. 4 attribute name)", () => {
    // Positive: rule fires on APPROVED requirements with empty impacts —
    // the gating signal for change-propagation analysis (kap. 2.7). INFO
    // severity because pre-implementation, but visible on PERIODIC scan.
    const rule = getGuardrailOrThrow("GR-L1-009");
    expect(rule.scope.object_type).toBe("Requirement");
    expect(rule.condition).toContain("object.status != 'APPROVED'");
    expect(rule.condition).toContain("object.impacts");
    expect(rule.condition).toContain("> 0");
    expect(rule.origin).toBe("SEMANTIC");
    expect(rule.evaluation).toBe("DESCRIPTIVE");
    expect(rule.severity).toBe("INFO");
    expect(rule.scope.triggers).toContain("PERIODIC");
    expect(rule.scope.triggers).toContain("UPDATE");
    // Negative: drift guard — must not target the wrong status (the rule is
    // pre-implementation, not in-progress) and must not use renamed field
    // names that have appeared in earlier drafts.
    expect(rule.condition).not.toContain("object.status == 'IMPLEMENTED'");
    expect(rule.condition).not.toContain("object.status == 'IN_PROGRESS'");
    expect(rule.condition).not.toContain("object.changes");
    expect(rule.condition).not.toContain("object.impacted_objects");
    expect(rule.condition).not.toContain("object.impact_targets");
    expect(rule.condition).not.toContain("object.affected");
  });

  it("GR-L3-009 measures ExternalSystem staleness from last_review_date", () => {
    const rule = getGuardrailOrThrow("GR-L3-009");
    expect(rule.condition).toContain("object.last_review_date");
    expect(rule.condition).not.toContain("last_reviewed_at");
  });

  it("GR-XL-007 measures generic staleness from last_review_date (condition + remediation)", () => {
    const rule = getGuardrailOrThrow("GR-XL-007");
    expect(rule.condition).toContain("object.last_review_date");
    expect(rule.condition).not.toContain("last_reviewed_at");
    expect(rule.remediation).toContain("last_review_date");
    expect(rule.remediation).not.toContain("last_reviewed_at");
  });

  it("GR-L4-006 reads APIEndpoint deprecation from object.status (DESCRIPTIVE+WARNING with PERIODIC trigger)", () => {
    const rule = getGuardrailOrThrow("GR-L4-006");
    expect(rule.condition).toContain("object.status == 'DEPRECATED'");
    expect(rule.condition).toContain("object.sunset_at");
    expect(rule.condition).not.toContain("object.lifecycle");
    // CTO ratification: PRESCRIPTIVE+WARNING is invalid → DESCRIPTIVE+WARNING.
    expect(rule.evaluation).toBe("DESCRIPTIVE");
    expect(rule.severity).toBe("WARNING");
    // CTO ratification: deprecated endpoints without sunset_at must also fire on background scan.
    expect(rule.scope.triggers).toContain("PERIODIC");
    expect(rule.scope.triggers).toContain("UPDATE");
  });

  it("GR-L5-003 distinguishes CodeModule layers via module_type (kap. 4 attribute)", () => {
    const rule = getGuardrailOrThrow("GR-L5-003");
    expect(rule.condition).toContain("object.module_type");
    expect(rule.condition).toContain("target.module_type");
    expect(rule.condition).not.toContain("classification");
  });

  it("GR-L5-005 reads TechnicalDebt.interest_rate and ages from TknBase.created_at", () => {
    const rule = getGuardrailOrThrow("GR-L5-005");
    expect(rule.condition).toContain("object.interest_rate == 'HIGH'");
    expect(rule.condition).toContain("now - object.created_at");
    expect(rule.condition).not.toContain("object.opened_at");
    expect(rule.condition).not.toMatch(/object\.interest [^_]/);
  });

  it("GR-L6-004 walks SLO `validates` Service and infers PRODUCTION via deploys-to → DeploymentUnit.environment", () => {
    const rule = getGuardrailOrThrow("GR-L6-004");
    expect(rule.condition).toContain("validates");
    expect(rule.condition).toContain("deploys-to");
    expect(rule.condition).toContain("DeploymentUnit");
    expect(rule.condition).not.toContain("type='has-slo'");
    expect(rule.condition).not.toMatch(/object\.environment\s*==/);
    // The `validates` edge is the canonical relationship type for the SLO link.
    expect(rule.scope.relationship_type).toBe("validates");
  });

  it("GR-L2-001 rationale documents the configurable default of 3", () => {
    const rule = getGuardrailOrThrow("GR-L2-001");
    expect(rule.rationale).toContain("default 3");
    expect(rule.rationale).toContain("configurable");
  });

  it("GR-L2-001 reads BoundedContext.ubiquitous_language and config.l2.min_terms_per_context (kap. 4 field)", () => {
    // Positive: rule reads the canonical ubiquitous_language field array and
    // gates on the configurable threshold. PRESCRIPTIVE+ERROR blocks creation
    // of contexts without shared vocabulary.
    const rule = getGuardrailOrThrow("GR-L2-001");
    expect(rule.scope.object_type).toBe("BoundedContext");
    expect(rule.condition).toContain("object.ubiquitous_language");
    expect(rule.condition).toContain("config.l2.min_terms_per_context");
    expect(rule.evaluation).toBe("PRESCRIPTIVE");
    expect(rule.severity).toBe("ERROR");
    // Negative: drift guard — must not use shortened field names, plural
    // 'language_terms', or camelCase variants that have appeared in earlier
    // drafts. The canonical kap. 4 attribute is 'ubiquitous_language'.
    expect(rule.condition).not.toContain("object.language_terms");
    expect(rule.condition).not.toContain("object.vocabulary");
    expect(rule.condition).not.toContain("object.terms");
    expect(rule.condition).not.toContain("object.glossary");
    expect(rule.condition).not.toContain("object.ubiquitousLanguage");
    // Threshold must come from config (not a hardcoded literal).
    expect(rule.condition).not.toMatch(/>=\s*\d+(?!\s*config)/);
  });

  it("GR-L3-008 is DESCRIPTIVE+WARNING (PRESCRIPTIVE+WARNING is not a valid combination)", () => {
    const rule = getGuardrailOrThrow("GR-L3-008");
    expect(rule.evaluation).toBe("DESCRIPTIVE");
    expect(rule.severity).toBe("WARNING");
    expect(rule.scope.triggers).toContain("PERIODIC");
  });

  it("GR-L3-008 reads ArchitectureSystem.quality_attributes as a field array (not a relationship walk)", () => {
    // ArchitectureSystem.qualityAttributes is a field array (`min(1)` enforced
    // by the Zod schema). The catalog rule provides DESCRIPTIVE coverage on
    // PERIODIC scans for nodes that bypass Zod (e.g. legacy/imported data).
    // Earlier drafts walked a `satisfies` relationship that does not exist in
    // the registry — guard against that drift by pinning the field-level
    // condition and the absence of any relationship walk.
    const rule = getGuardrailOrThrow("GR-L3-008");
    expect(rule.scope.object_type).toBe("ArchitectureSystem");
    expect(rule.condition).toContain("object.quality_attributes");
    expect(rule.condition).toContain(">= 1");
    // Negative: drift guard — `satisfies` is not a registered relationship
    // type, and field-level rules must not pretend to walk edges.
    expect(rule.condition).not.toContain("type='satisfies'");
    expect(rule.condition).not.toContain("object.relationships");
    expect(rule.condition).not.toContain("type='realizes'");
    expect(rule.condition).not.toContain("type='has-quality-attr'");
    // Negative: drift guard — must not switch to camelCase or shortened names
    // (catalog conditions are snake_case even though the schema is camelCase).
    expect(rule.condition).not.toContain("object.qualityAttributes");
    expect(rule.condition).not.toMatch(/object\.quality\b/);
    // Scope must remain field-level (no relationship_type implies edge eval).
    expect(rule.scope.relationship_type).toBeUndefined();
  });

  it("GR-L2-005 is DESCRIPTIVE+WARNING with PERIODIC trigger (CTO ratification, LSDS-102)", () => {
    // Past-tense check on DomainEvent name is non-blocking style guidance, so
    // PRESCRIPTIVE+WARNING was downgraded to DESCRIPTIVE+WARNING. PERIODIC
    // ensures legacy/imported events get surfaced by background scans, not
    // only on CREATE/UPDATE.
    const rule = getGuardrailOrThrow("GR-L2-005");
    expect(rule.evaluation).toBe("DESCRIPTIVE");
    expect(rule.severity).toBe("WARNING");
    expect(rule.scope.triggers).toContain("PERIODIC");
    expect(rule.scope.triggers).toContain("CREATE");
    expect(rule.scope.triggers).toContain("UPDATE");
  });

  it("GR-L2-005 reads DomainEvent.name via is_past_tense() (kap. 4 attribute + canonical check function)", () => {
    // Positive: rule calls is_past_tense() on object.name — the canonical kap. 4
    // attribute for the event identifier string. Fires on DomainEvent nodes only.
    const rule = getGuardrailOrThrow("GR-L2-005");
    expect(rule.scope.object_type).toBe("DomainEvent");
    expect(rule.condition).toContain("is_past_tense(");
    expect(rule.condition).toContain("object.name");
    // Negative: drift guard — must not substitute the function for ad-hoc
    // string checks, and must not read object.title or object.event_name instead
    // of the canonical name field.
    expect(rule.condition).not.toContain("object.title");
    expect(rule.condition).not.toContain("object.event_name");
    expect(rule.condition).not.toContain("is_command_form(");
    expect(rule.condition).not.toContain('endsWith("ed")');
    // must use is_past_tense() not a bare past_tense() variant
    expect(rule.condition).not.toMatch(/(?<!is_)past_tense\(/);
  });

  it("GR-L6-006 reads Environment.environment_type and Environment.iac_reference", () => {
    const rule = getGuardrailOrThrow("GR-L6-006");
    expect(rule.condition).toContain("object.environment_type");
    expect(rule.condition).toContain("'PRODUCTION'");
    expect(rule.condition).toContain("'DR'");
    expect(rule.condition).toContain("object.iac_reference");
    expect(rule.evaluation).toBe("PRESCRIPTIVE");
    expect(rule.severity).toBe("ERROR");
    // Negative: drift guard — must not use renamed IaC field names or non-canonical environment type names.
    expect(rule.condition).not.toContain("object.iac_path");
    expect(rule.condition).not.toContain("object.infra_ref");
    expect(rule.condition).not.toContain("'PROD'");
    expect(rule.condition).not.toContain("'DISASTER_RECOVERY'");
  });

  it("GR-L6-007 reads Environment.environment_type and Environment.promotion_gate", () => {
    const rule = getGuardrailOrThrow("GR-L6-007");
    expect(rule.condition).toContain("object.environment_type");
    expect(rule.condition).toContain("object.promotion_gate");
    expect(rule.evaluation).toBe("PRESCRIPTIVE");
    expect(rule.severity).toBe("ERROR");
    // Negative: drift guard — must not use renamed promotion_gate variants or non-canonical environment type names.
    expect(rule.condition).not.toContain("object.deploy_gate");
    expect(rule.condition).not.toContain("object.release_gate");
    expect(rule.condition).not.toContain("object.promotion_policy");
    expect(rule.condition).not.toContain("'PROD'");
    expect(rule.condition).not.toContain("'DISASTER_RECOVERY'");
  });

  it("GR-L6-008 walks OnCallPolicy `covers` edge and reads response_time_sla.p1", () => {
    const rule = getGuardrailOrThrow("GR-L6-008");
    expect(rule.condition).toContain("type='covers'");
    expect(rule.condition).toContain("object.response_time_sla.p1");
    expect(rule.condition).toContain("escalation_levels");
    expect(rule.scope.relationship_type).toBe("covers");
    expect(rule.evaluation).toBe("PRESCRIPTIVE");
    expect(rule.severity).toBe("ERROR");
    // Negative: drift guard — must not use invented edge names or alternative SLA field names.
    expect(rule.condition).not.toContain("type='has-oncall'");
    expect(rule.condition).not.toContain("type='oncall-policy'");
    expect(rule.condition).not.toContain("object.sla_p1");
    expect(rule.condition).not.toContain("object.response_sla");
  });

  it("GR-L6-009 walks OnCallPolicy `covers` edge and infers PRODUCTION via deploys-to → DeploymentUnit.environment", () => {
    // Positive: production status is inferred from the deploys-to →
    // DeploymentUnit.environment edge (Service has no direct environment
    // attribute) and the on-call link is the canonical incoming `covers`
    // edge from OnCallPolicy. Mirrors GR-L6-004's pattern.
    const rule = getGuardrailOrThrow("GR-L6-009");
    expect(rule.layer).toBe("L6");
    expect(rule.scope.object_type).toBe("Service");
    expect(rule.condition).toContain("deploys-to");
    expect(rule.condition).toContain("DeploymentUnit");
    expect(rule.condition).toContain("'PRODUCTION'");
    expect(rule.condition).toContain("type='covers'");
    expect(rule.condition).toContain("source_type='OnCallPolicy'");
    expect(rule.scope.relationship_type).toBe("covers");
    expect(rule.origin).toBe("SEMANTIC");
    expect(rule.evaluation).toBe("DESCRIPTIVE");
    expect(rule.severity).toBe("WARNING");
    expect(rule.scope.triggers).toContain("PERIODIC");
    expect(rule.scope.triggers).toContain("UPDATE");
  });

  it("GR-L6-009 does not infer environment via a direct attribute or a non-canonical edge", () => {
    // Negative: catch the two ways this rule has historically drifted —
    // (a) reading object.environment as if Service had a direct attribute,
    // (b) using an invented `oncalled-by`/`has-oncall` edge instead of the
    // canonical incoming `covers` from OnCallPolicy (kap. 2.2).
    const rule = getGuardrailOrThrow("GR-L6-009");
    expect(rule.condition).not.toMatch(/object\.environment\s*==/);
    expect(rule.condition).not.toContain("type='oncalled-by'");
    expect(rule.condition).not.toContain("type='has-oncall'");
    expect(rule.condition).not.toContain("type='oncall-for'");
    expect(rule.rationale.length).toBeGreaterThanOrEqual(20);
    expect(rule.remediation).toContain("OnCallPolicy");
    expect(rule.remediation).toContain("covers");
  });

  it("no rule uses the invalid PRESCRIPTIVE+WARNING combination", async () => {
    // PRESCRIPTIVE rules must block (severity=ERROR); WARNING/INFO must be
    // DESCRIPTIVE. Ratified by CTO on LSDS-90; enforced here as a regression
    // guard so the catalog cannot drift back into PRESCRIPTIVE+WARNING.
    const { GUARDRAIL_CATALOG } = await import("../../src/guardrail/catalog");
    const offenders = GUARDRAIL_CATALOG.filter(
      (r) => r.evaluation === "PRESCRIPTIVE" && r.severity === "WARNING",
    ).map((r) => r.rule_id);
    expect(offenders).toEqual([]);
  });

  it("GR-L6-001 condition checks InfrastructureComponent.iac_reference is non-null", () => {
    // Positive: rule reads the canonical field name and blocks on absence.
    const rule = getGuardrailOrThrow("GR-L6-001");
    expect(rule.scope.object_type).toBe("InfrastructureComponent");
    expect(rule.condition).toContain("object.iac_reference");
    expect(rule.condition).toContain("!= null");
    expect(rule.origin).toBe("STRUCTURAL");
    expect(rule.evaluation).toBe("PRESCRIPTIVE");
    expect(rule.severity).toBe("ERROR");
    // Negative: drift guard — condition must not use renamed/alternative field names.
    expect(rule.condition).not.toContain("object.terraform_path");
    expect(rule.condition).not.toContain("object.iac_definition");
    expect(rule.condition).not.toContain("object.infra_ref");
  });

  it("GR-L6-002 reads Alert.runbook_reference as a field (not a relationship walk)", () => {
    // Alert.runbookReference is a typed scalar reference (`RunbookRef`) on the
    // Zod schema, not a registered edge. The rule is field-level — it asserts
    // the foreign-key attribute is present on the Alert. Earlier drafts pinned
    // a fake `runbook_reference` relationship_type on the scope which implied
    // edge-level evaluation and would have silently no-op'd in any traversal-
    // backed evaluator (it is not in the relationship registry — kap. 2.2).
    // This test pins the field-level shape and guards against re-introducing
    // an invented edge name.
    const rule = getGuardrailOrThrow("GR-L6-002");
    expect(rule.scope.object_type).toBe("Alert");
    expect(rule.condition).toContain("object.runbook_reference");
    expect(rule.condition).toContain("!= null");
    expect(rule.origin).toBe("STRUCTURAL");
    expect(rule.evaluation).toBe("PRESCRIPTIVE");
    expect(rule.severity).toBe("ERROR");
    // Scope must remain field-level (no relationship_type implies edge eval).
    expect(rule.scope.relationship_type).toBeUndefined();
    // Negative: drift guard — must not invent edge names for what is a field,
    // and must not switch to camelCase or alternative field names.
    expect(rule.condition).not.toContain("type='has-runbook'");
    expect(rule.condition).not.toContain("type='runbook-for'");
    expect(rule.condition).not.toContain("type='runbook_reference'");
    expect(rule.condition).not.toContain("type='references-runbook'");
    expect(rule.condition).not.toContain("object.runbookReference");
    expect(rule.condition).not.toContain("object.runbook_url");
    // Word-boundary guard: catch `object.runbook` as a bare attribute, but
    // tolerate the canonical `object.runbook_reference` substring.
    expect(rule.condition).not.toMatch(/object\.runbook(?!_reference)/);
  });

  it("GR-L6-003 condition detects P1 Runbook with last_tested > 90 days", () => {
    // Positive: rule reads severity + last_tested with the 90-day threshold.
    const rule = getGuardrailOrThrow("GR-L6-003");
    expect(rule.scope.object_type).toBe("Runbook");
    expect(rule.condition).toContain("object.severity == 'P1'");
    expect(rule.condition).toContain("object.last_tested");
    expect(rule.condition).toContain("90 days");
    expect(rule.scope.triggers).toContain("PERIODIC");
    expect(rule.origin).toBe("SEMANTIC");
    expect(rule.evaluation).toBe("DESCRIPTIVE");
    expect(rule.severity).toBe("ERROR");
    // Negative: drift guard — must not use renamed fields for the tested-at timestamp.
    expect(rule.condition).not.toContain("object.last_run");
    expect(rule.condition).not.toContain("object.last_exercise_date");
    expect(rule.condition).not.toContain("object.tested_at");
  });

  it("GR-L6-005 condition links SLO to QualityAttribute via `traces-to` (not an invented edge)", () => {
    // Positive: rule reads the canonical traces-to edge to QualityAttribute.
    const rule = getGuardrailOrThrow("GR-L6-005");
    expect(rule.scope.object_type).toBe("SLO");
    expect(rule.condition).toContain("traces-to");
    expect(rule.condition).toContain("QualityAttribute");
    expect(rule.scope.relationship_type).toBe("traces-to");
    expect(rule.severity).toBe("WARNING");
    expect(rule.evaluation).toBe("DESCRIPTIVE");
    expect(rule.origin).toBe("SEMANTIC");
    // Negative: drift guard — must not use invented relationship names.
    expect(rule.condition).not.toContain("type='has-quality-attr'");
    expect(rule.condition).not.toContain("type='links-to'");
    expect(rule.condition).not.toContain("type='supports'");
    expect(rule.condition).not.toContain("type='maps-to'");
  });
});

describe("GR-XL cross-layer guardrail drift guards (GR-XL-001..011)", () => {
  describe("GR-XL-001 object without owner", () => {
    it("condition reads object.owner (not ownerId or owner_id)", () => {
      const rule = getGuardrailOrThrow("GR-XL-001");
      expect(rule.condition).toContain("object.owner");
      expect(rule.condition).not.toContain("ownerId");
      expect(rule.condition).not.toContain("owner_id");
    });

    it("remediation references owner field", () => {
      const rule = getGuardrailOrThrow("GR-XL-001");
      expect(rule.remediation).toContain("owner");
    });

    it("remediation does not advise PersonRef (TknBase.owner is TeamRef-only per kap. 2.6)", () => {
      const rule = getGuardrailOrThrow("GR-XL-001");
      expect(rule.remediation).not.toMatch(/PersonRef/);
    });

    it("propagation is NONE", () => {
      const rule = getGuardrailOrThrow("GR-XL-001");
      expect(rule.propagation).toBe("NONE");
    });

    it("severity is ERROR and evaluation is PRESCRIPTIVE", () => {
      const rule = getGuardrailOrThrow("GR-XL-001");
      expect(rule.severity).toBe("ERROR");
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
    });
  });

  describe("GR-XL-002 dangling relationship target", () => {
    it("condition checks target_object_id (not target_id)", () => {
      const rule = getGuardrailOrThrow("GR-XL-002");
      expect(rule.condition).toContain("target_object_id");
      expect(rule.condition).not.toContain("target_id");
    });

    it("remediation references the missing target", () => {
      const rule = getGuardrailOrThrow("GR-XL-002");
      expect(rule.remediation.toLowerCase()).toMatch(/target/);
    });

    it("propagation is LATERAL", () => {
      const rule = getGuardrailOrThrow("GR-XL-002");
      expect(rule.propagation).toBe("LATERAL");
    });

    it("scope applies to Relationship objects and severity is ERROR", () => {
      const rule = getGuardrailOrThrow("GR-XL-002");
      expect(rule.scope.object_type).toBe("Relationship");
      expect(rule.severity).toBe("ERROR");
    });
  });

  describe("GR-XL-003 relationship violates layer ordinal rules", () => {
    it("condition reads source.layer and target.layer (not ordinal aliases)", () => {
      const rule = getGuardrailOrThrow("GR-XL-003");
      expect(rule.condition).toContain("source.layer");
      expect(rule.condition).toContain("target.layer");
      expect(rule.condition).not.toContain("source.ordinal");
      expect(rule.condition).not.toContain("target.ordinal");
    });

    it("remediation references layer", () => {
      const rule = getGuardrailOrThrow("GR-XL-003");
      expect(rule.remediation.toLowerCase()).toMatch(/layer/);
    });

    it("propagation is LATERAL", () => {
      const rule = getGuardrailOrThrow("GR-XL-003");
      expect(rule.propagation).toBe("LATERAL");
    });

    it("scope applies to Relationship objects and severity is ERROR", () => {
      const rule = getGuardrailOrThrow("GR-XL-003");
      expect(rule.scope.object_type).toBe("Relationship");
      expect(rule.severity).toBe("ERROR");
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
    });
  });

  describe("GR-XL-004 archiving with ACTIVE dependents", () => {
    it("condition checks incoming_relationships filtered by ACTIVE lifecycle (not status)", () => {
      const rule = getGuardrailOrThrow("GR-XL-004");
      expect(rule.condition).toContain("incoming_relationships");
      expect(rule.condition).toContain("ACTIVE");
      expect(rule.condition).not.toContain("source.status");
    });

    it("remediation references ACTIVE dependents", () => {
      const rule = getGuardrailOrThrow("GR-XL-004");
      expect(rule.remediation).toMatch(/ACTIVE|dependent/i);
    });

    it("propagation is DOWNWARD", () => {
      const rule = getGuardrailOrThrow("GR-XL-004");
      expect(rule.propagation).toBe("DOWNWARD");
    });

    it("triggers include ARCHIVE and severity is ERROR", () => {
      const rule = getGuardrailOrThrow("GR-XL-004");
      expect(rule.scope.triggers).toContain("ARCHIVE");
      expect(rule.severity).toBe("ERROR");
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
    });
  });

  describe("GR-XL-005 hard delete with incoming relationships", () => {
    it("condition checks incoming_relationships count (not a named edge)", () => {
      const rule = getGuardrailOrThrow("GR-XL-005");
      expect(rule.condition).toContain("incoming_relationships");
      expect(rule.condition).not.toContain("incoming_refs");
      expect(rule.condition).not.toContain("inbound_edges");
    });

    it("remediation references the ARCHIVED lifecycle path", () => {
      const rule = getGuardrailOrThrow("GR-XL-005");
      expect(rule.remediation).toMatch(/ARCHIVED|lifecycle/i);
    });

    it("propagation is BOTH (merged from GR-XL-005 DOWNWARD + GR-XL-011 UPWARD)", () => {
      const rule = getGuardrailOrThrow("GR-XL-005");
      expect(rule.propagation).toBe("BOTH");
      expect(rule.propagation).not.toBe("DOWNWARD");
      expect(rule.propagation).not.toBe("UPWARD");
    });

    it("triggers include DELETE and severity is ERROR", () => {
      const rule = getGuardrailOrThrow("GR-XL-005");
      expect(rule.scope.triggers).toContain("DELETE");
      expect(rule.severity).toBe("ERROR");
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
    });
  });

  describe("GR-XL-006 DEPRECATED object with active depends-on dependents", () => {
    it("condition checks lifecycle == DEPRECATED and depends-on edge (not status or DECOMMISSIONED)", () => {
      const rule = getGuardrailOrThrow("GR-XL-006");
      expect(rule.condition).toContain("DEPRECATED");
      expect(rule.condition).toContain("depends-on");
      expect(rule.condition).toContain("ACTIVE");
      expect(rule.condition).not.toContain("DECOMMISSIONED");
      expect(rule.condition).not.toContain("object.status");
    });

    it("scope.relationship_type is depends-on", () => {
      const rule = getGuardrailOrThrow("GR-XL-006");
      expect(rule.scope.relationship_type).toBe("depends-on");
    });

    it("propagation is BOTH (merged from GR-XL-006 DOWNWARD + GR-XL-009 UPWARD)", () => {
      const rule = getGuardrailOrThrow("GR-XL-006");
      expect(rule.propagation).toBe("BOTH");
      expect(rule.propagation).not.toBe("DOWNWARD");
      expect(rule.propagation).not.toBe("UPWARD");
    });

    it("evaluation is DESCRIPTIVE and severity is WARNING (not PRESCRIPTIVE+WARNING)", () => {
      const rule = getGuardrailOrThrow("GR-XL-006");
      expect(rule.evaluation).toBe("DESCRIPTIVE");
      expect(rule.severity).toBe("WARNING");
    });
  });

  describe("GR-XL-007 object without review for > threshold (staleness)", () => {
    it("condition reads last_review_date (not last_reviewed_at)", () => {
      const rule = getGuardrailOrThrow("GR-XL-007");
      expect(rule.condition).toContain("object.last_review_date");
      expect(rule.condition).not.toContain("last_reviewed_at");
    });

    it("remediation references last_review_date (not last_reviewed_at)", () => {
      const rule = getGuardrailOrThrow("GR-XL-007");
      expect(rule.remediation).toContain("last_review_date");
      expect(rule.remediation).not.toContain("last_reviewed_at");
    });

    it("propagation is NONE", () => {
      const rule = getGuardrailOrThrow("GR-XL-007");
      expect(rule.propagation).toBe("NONE");
    });

    it("evaluation is DESCRIPTIVE and severity is INFO", () => {
      const rule = getGuardrailOrThrow("GR-XL-007");
      expect(rule.evaluation).toBe("DESCRIPTIVE");
      expect(rule.severity).toBe("INFO");
    });
  });

  describe("GR-XL-008 god object with >20 direct relationships", () => {
    it("condition reads direct_relationships.length with threshold 20 (not edge_count or relationship_count)", () => {
      const rule = getGuardrailOrThrow("GR-XL-008");
      expect(rule.condition).toContain("direct_relationships");
      expect(rule.condition).toContain("20");
      expect(rule.condition).not.toContain("edge_count");
      expect(rule.condition).not.toContain("relationship_count");
      expect(rule.condition).not.toContain("relationships.count");
    });

    it("remediation references decomposition", () => {
      const rule = getGuardrailOrThrow("GR-XL-008");
      expect(rule.remediation).toMatch(/[Dd]ecompos/);
    });

    it("propagation is LATERAL", () => {
      const rule = getGuardrailOrThrow("GR-XL-008");
      expect(rule.propagation).toBe("LATERAL");
    });

    it("evaluation is DESCRIPTIVE and severity is INFO", () => {
      const rule = getGuardrailOrThrow("GR-XL-008");
      expect(rule.evaluation).toBe("DESCRIPTIVE");
      expect(rule.severity).toBe("INFO");
    });
  });

  describe("GR-XL-010 ARCHIVED object with non-archived contains children", () => {
    it("condition checks lifecycle ARCHIVED and outgoing contains edge (not children.status)", () => {
      const rule = getGuardrailOrThrow("GR-XL-010");
      expect(rule.condition).toContain("ARCHIVED");
      expect(rule.condition).toContain("contains");
      expect(rule.condition).not.toContain("children.status");
      expect(rule.condition).not.toContain("child.status");
    });

    it("scope.relationship_type is contains", () => {
      const rule = getGuardrailOrThrow("GR-XL-010");
      expect(rule.scope.relationship_type).toBe("contains");
    });

    it("propagation is DOWNWARD", () => {
      const rule = getGuardrailOrThrow("GR-XL-010");
      expect(rule.propagation).toBe("DOWNWARD");
    });

    it("triggers include ARCHIVE, evaluation is PRESCRIPTIVE, severity is ERROR", () => {
      const rule = getGuardrailOrThrow("GR-XL-010");
      expect(rule.scope.triggers).toContain("ARCHIVE");
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
    });
  });

});

describe("GR-L2 Domain Layer guardrail drift guards (GR-L2-002..004, 006..008)", () => {
  describe("GR-L2-002 BoundedContext must trace to BusinessCapability", () => {
    it("walks the canonical `traces-to` edge to BusinessCapability", () => {
      const rule = getGuardrailOrThrow("GR-L2-002");
      expect(rule.scope.object_type).toBe("BoundedContext");
      expect(rule.condition).toContain("type='traces-to'");
      expect(rule.condition).toContain("target_type='BusinessCapability'");
      expect(rule.condition).toContain(">= 1");
      expect(rule.scope.relationship_type).toBe("traces-to");
    });

    it("does not use synonyms for the strategic-alignment edge", () => {
      const rule = getGuardrailOrThrow("GR-L2-002");
      expect(rule.condition).not.toContain("type='supports'");
      expect(rule.condition).not.toContain("type='realises'");
      expect(rule.condition).not.toContain("type='realizes'");
      expect(rule.condition).not.toContain("type='aligned-with'");
      expect(rule.condition).not.toContain("type='part-of'");
      expect(rule.condition).not.toContain("target_type='Capability'");
    });

    it("propagation is UPWARD (orphan context surfaces on capability dependents)", () => {
      const rule = getGuardrailOrThrow("GR-L2-002");
      expect(rule.propagation).toBe("UPWARD");
    });

    it("origin is STRUCTURAL, evaluation is PRESCRIPTIVE, severity is ERROR", () => {
      const rule = getGuardrailOrThrow("GR-L2-002");
      expect(rule.origin).toBe("STRUCTURAL");
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
    });
  });

  describe("GR-L2-003 DomainEntity must declare ≥ 1 invariant", () => {
    it("reads the canonical `invariants` array on DomainEntity", () => {
      const rule = getGuardrailOrThrow("GR-L2-003");
      expect(rule.scope.object_type).toBe("DomainEntity");
      expect(rule.condition).toContain("object.invariants");
      expect(rule.condition).toContain(">= 1");
    });

    it("does not use synonyms for entity invariants", () => {
      const rule = getGuardrailOrThrow("GR-L2-003");
      expect(rule.condition).not.toContain("object.rules");
      expect(rule.condition).not.toContain("object.constraints");
      expect(rule.condition).not.toContain("object.businessRules");
      expect(rule.condition).not.toContain("object.business_rules");
      expect(rule.condition).not.toContain("object.guarantees");
    });

    it("remediation references invariant authoring or downgrade to ValueObject", () => {
      const rule = getGuardrailOrThrow("GR-L2-003");
      expect(rule.remediation.toLowerCase()).toMatch(/invariant/);
      expect(rule.remediation).toContain("ValueObject");
    });

    it("propagation is NONE; origin STRUCTURAL; evaluation PRESCRIPTIVE; severity ERROR", () => {
      const rule = getGuardrailOrThrow("GR-L2-003");
      expect(rule.propagation).toBe("NONE");
      expect(rule.origin).toBe("STRUCTURAL");
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
    });
  });

  describe("GR-L2-004 Aggregate must declare transaction_boundary", () => {
    it("reads the canonical `transaction_boundary` attribute (snake_case)", () => {
      const rule = getGuardrailOrThrow("GR-L2-004");
      expect(rule.scope.object_type).toBe("Aggregate");
      expect(rule.condition).toContain("object.transaction_boundary");
      expect(rule.condition).toContain("!= null");
    });

    it("does not use camelCase or alternative boundary names", () => {
      const rule = getGuardrailOrThrow("GR-L2-004");
      expect(rule.condition).not.toContain("transactionBoundary");
      expect(rule.condition).not.toContain("object.boundary");
      expect(rule.condition).not.toContain("object.consistency_boundary");
      expect(rule.condition).not.toContain("object.aggregate_boundary");
      expect(rule.condition).not.toContain("object.tx_boundary");
    });

    it("remediation references transaction_boundary explicitly", () => {
      const rule = getGuardrailOrThrow("GR-L2-004");
      expect(rule.remediation).toContain("transaction_boundary");
    });

    it("propagation is NONE; origin STRUCTURAL; evaluation PRESCRIPTIVE; severity ERROR", () => {
      const rule = getGuardrailOrThrow("GR-L2-004");
      expect(rule.propagation).toBe("NONE");
      expect(rule.origin).toBe("STRUCTURAL");
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
    });
  });

  describe("GR-L2-006 cyclic context-integration between BoundedContexts", () => {
    it("scopes the canonical `context-integration` relationship type (kap. 2.2 + A7)", () => {
      const rule = getGuardrailOrThrow("GR-L2-006");
      expect(rule.scope.object_type).toBe("BoundedContext");
      expect(rule.scope.relationship_type).toBe("context-integration");
      expect(rule.condition).toContain("BoundedContext");
      expect(rule.condition).toContain("context-integration");
    });

    it("uses no_cycle_in semantics, not generic graph-walk synonyms", () => {
      const rule = getGuardrailOrThrow("GR-L2-006");
      expect(rule.condition).toContain("no_cycle_in");
      expect(rule.condition).not.toContain("has_cycle");
      expect(rule.condition).not.toContain("acyclic");
      expect(rule.condition).not.toContain("relationship='upstream-downstream'");
      expect(rule.condition).not.toContain("relationship='conformist-to'");
    });

    it("propagation is LATERAL (cycle hits both sides of the integration seam)", () => {
      const rule = getGuardrailOrThrow("GR-L2-006");
      expect(rule.propagation).toBe("LATERAL");
    });

    it("triggers include PERIODIC + UPDATE; severity ERROR; evaluation DESCRIPTIVE", () => {
      const rule = getGuardrailOrThrow("GR-L2-006");
      expect(rule.scope.triggers).toContain("PERIODIC");
      expect(rule.scope.triggers).toContain("UPDATE");
      expect(rule.severity).toBe("ERROR");
      expect(rule.evaluation).toBe("DESCRIPTIVE");
    });
  });

  describe("GR-L2-007 conformist pattern targeting a CORE BoundedContext", () => {
    it("references the CONFORMIST pattern and a CORE classification target", () => {
      const rule = getGuardrailOrThrow("GR-L2-007");
      expect(rule.scope.object_type).toBe("BoundedContext");
      expect(rule.condition.toLowerCase()).toMatch(/conformist/);
      expect(rule.condition).toContain("target.classification='CORE'");
    });

    it("does not match SUPPORTING/GENERIC classifications (rule is CORE-specific)", () => {
      const rule = getGuardrailOrThrow("GR-L2-007");
      expect(rule.condition).not.toContain("target.classification='SUPPORTING'");
      expect(rule.condition).not.toContain("target.classification='GENERIC'");
      expect(rule.condition).not.toContain("classification='Core'");
      expect(rule.condition).not.toContain("classification='core'");
    });

    it("remediation suggests Anti-Corruption Layer or Partnership", () => {
      const rule = getGuardrailOrThrow("GR-L2-007");
      expect(rule.remediation).toMatch(/ACL|Anti-Corruption|partnership/i);
    });

    it("origin is SEMANTIC; evaluation DESCRIPTIVE; severity WARNING; propagation NONE", () => {
      const rule = getGuardrailOrThrow("GR-L2-007");
      expect(rule.origin).toBe("SEMANTIC");
      expect(rule.evaluation).toBe("DESCRIPTIVE");
      expect(rule.severity).toBe("WARNING");
      expect(rule.propagation).toBe("NONE");
    });
  });

  describe("GR-L2-008 same LanguageTerm defined differently across contexts", () => {
    it("scopes LanguageTerm and uses duplicate_term_with_diverging_definitions semantics", () => {
      const rule = getGuardrailOrThrow("GR-L2-008");
      expect(rule.scope.object_type).toBe("LanguageTerm");
      expect(rule.condition).toContain("duplicate_term_with_diverging_definitions");
    });

    it("does not collapse to a single-context name-uniqueness check", () => {
      const rule = getGuardrailOrThrow("GR-L2-008");
      expect(rule.condition).not.toContain("unique_name");
      expect(rule.condition).not.toContain("object.duplicates");
      expect(rule.condition).not.toMatch(/object\.name\s*==/);
    });

    it("propagation is LATERAL (divergence affects both contexts symmetrically)", () => {
      const rule = getGuardrailOrThrow("GR-L2-008");
      expect(rule.propagation).toBe("LATERAL");
    });

    it("origin SEMANTIC; evaluation DESCRIPTIVE; severity INFO (translation-map signal, not a defect)", () => {
      const rule = getGuardrailOrThrow("GR-L2-008");
      expect(rule.origin).toBe("SEMANTIC");
      expect(rule.evaluation).toBe("DESCRIPTIVE");
      expect(rule.severity).toBe("INFO");
      expect(rule.scope.triggers).toContain("PERIODIC");
    });
  });
});

describe("GR-L3 architecture-layer guardrail drift guards (GR-L3-001..007)", () => {
  describe("GR-L3-001 ArchitectureComponent must declare technology", () => {
    it("scope targets ArchitectureComponent on CREATE/UPDATE (kap. 4 attribute)", () => {
      const rule = getGuardrailOrThrow("GR-L3-001");
      expect(rule.scope.object_type).toBe("ArchitectureComponent");
      expect(rule.scope.triggers).toContain("CREATE");
      expect(rule.scope.triggers).toContain("UPDATE");
    });

    it("condition reads object.technology with non-empty length check", () => {
      const rule = getGuardrailOrThrow("GR-L3-001");
      expect(rule.condition).toContain("object.technology");
      expect(rule.condition).toContain("!= null");
      expect(rule.condition).toContain("object.technology.length > 0");
    });

    it("classification is STRUCTURAL+PRESCRIPTIVE+ERROR with propagation NONE", () => {
      const rule = getGuardrailOrThrow("GR-L3-001");
      expect(rule.origin).toBe("STRUCTURAL");
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
      expect(rule.propagation).toBe("NONE");
    });

    it("does not drift to alternative tech-stack field names", () => {
      const rule = getGuardrailOrThrow("GR-L3-001");
      expect(rule.condition).not.toMatch(/object\.tech\b/);
      expect(rule.condition).not.toContain("object.tech_stack");
      expect(rule.condition).not.toContain("object.stack");
      expect(rule.condition).not.toContain("object.runtime");
      expect(rule.condition).not.toContain("object.platform");
      expect(rule.condition).not.toContain("object.technologyRef");
    });
  });

  describe("GR-L3-002 ADR must list ≥ 1 alternatives_considered", () => {
    it("scope targets ADR on CREATE/UPDATE", () => {
      const rule = getGuardrailOrThrow("GR-L3-002");
      expect(rule.scope.object_type).toBe("ADR");
      expect(rule.scope.triggers).toContain("CREATE");
      expect(rule.scope.triggers).toContain("UPDATE");
    });

    it("condition reads object.alternatives_considered with >= 1 cardinality", () => {
      const rule = getGuardrailOrThrow("GR-L3-002");
      expect(rule.condition).toContain("object.alternatives_considered.length");
      expect(rule.condition).toContain(">= 1");
    });

    it("classification is STRUCTURAL+PRESCRIPTIVE+ERROR with propagation NONE", () => {
      const rule = getGuardrailOrThrow("GR-L3-002");
      expect(rule.origin).toBe("STRUCTURAL");
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
      expect(rule.propagation).toBe("NONE");
    });

    it("does not drift to shortened or camelCase alternative names", () => {
      const rule = getGuardrailOrThrow("GR-L3-002");
      // Catalog conditions are snake_case; schema is camelCase (kap. 4 §
      // L3/ADR.alternativesConsidered) but the runtime view stays snake_case.
      expect(rule.condition).not.toContain("object.alternativesConsidered");
      expect(rule.condition).not.toMatch(/object\.alternatives\b/);
      expect(rule.condition).not.toContain("object.options");
      expect(rule.condition).not.toContain("object.considered_options");
      expect(rule.condition).not.toContain("object.choices");
    });
  });

  describe("GR-L3-003 SUPERSEDED ADR must declare a supersedes relationship", () => {
    it("scope targets ADR with relationship_type='supersedes'", () => {
      const rule = getGuardrailOrThrow("GR-L3-003");
      expect(rule.scope.object_type).toBe("ADR");
      expect(rule.scope.relationship_type).toBe("supersedes");
      expect(rule.scope.triggers).toContain("UPDATE");
    });

    it("condition pairs status='SUPERSEDED' with at least one supersedes edge", () => {
      const rule = getGuardrailOrThrow("GR-L3-003");
      expect(rule.condition).toContain("object.status == 'SUPERSEDED'");
      expect(rule.condition).toContain("type='supersedes'");
      expect(rule.condition).toContain(">= 1");
    });

    it("classification is STRUCTURAL+PRESCRIPTIVE+ERROR with propagation LATERAL", () => {
      const rule = getGuardrailOrThrow("GR-L3-003");
      expect(rule.origin).toBe("STRUCTURAL");
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
      expect(rule.propagation).toBe("LATERAL");
    });

    it("does not drift to invented succession edge names", () => {
      const rule = getGuardrailOrThrow("GR-L3-003");
      // The canonical edge is `supersedes` (kap. 2.2). Synonyms must not slip in.
      expect(rule.condition).not.toContain("type='replaces'");
      expect(rule.condition).not.toContain("type='replaced-by'");
      expect(rule.condition).not.toContain("type='succeeds'");
      expect(rule.condition).not.toContain("type='followed-by'");
      expect(rule.condition).not.toContain("type='superseded-by'");
    });
  });

  describe("GR-L3-004 ExternalSystem CRITICAL without fallback_strategy", () => {
    it("scope targets ExternalSystem on CREATE/UPDATE", () => {
      const rule = getGuardrailOrThrow("GR-L3-004");
      expect(rule.scope.object_type).toBe("ExternalSystem");
      expect(rule.scope.triggers).toContain("CREATE");
      expect(rule.scope.triggers).toContain("UPDATE");
    });

    it("condition pairs criticality=='CRITICAL' with non-null fallback_strategy", () => {
      const rule = getGuardrailOrThrow("GR-L3-004");
      expect(rule.condition).toContain("object.criticality == 'CRITICAL'");
      expect(rule.condition).toContain("object.fallback_strategy");
      expect(rule.condition).toContain("!= null");
    });

    it("classification is STRUCTURAL+PRESCRIPTIVE+ERROR with propagation NONE", () => {
      const rule = getGuardrailOrThrow("GR-L3-004");
      expect(rule.origin).toBe("STRUCTURAL");
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
      expect(rule.propagation).toBe("NONE");
    });

    it("does not drift to alternative fallback field names", () => {
      const rule = getGuardrailOrThrow("GR-L3-004");
      expect(rule.condition).not.toContain("object.fallbackStrategy");
      expect(rule.condition).not.toMatch(/object\.fallback\b/);
      expect(rule.condition).not.toContain("object.failover");
      expect(rule.condition).not.toContain("object.degraded_mode");
      expect(rule.condition).not.toContain("object.contingency");
    });
  });

  describe("GR-L3-005 ExternalSystem CRITICAL/HIGH without sla_reference", () => {
    it("scope targets ExternalSystem on CREATE/UPDATE", () => {
      const rule = getGuardrailOrThrow("GR-L3-005");
      expect(rule.scope.object_type).toBe("ExternalSystem");
      expect(rule.scope.triggers).toContain("CREATE");
      expect(rule.scope.triggers).toContain("UPDATE");
    });

    it("condition gates both CRITICAL and HIGH on non-null sla_reference", () => {
      const rule = getGuardrailOrThrow("GR-L3-005");
      expect(rule.condition).toContain("'CRITICAL'");
      expect(rule.condition).toContain("'HIGH'");
      expect(rule.condition).toContain("object.sla_reference");
      expect(rule.condition).toContain("!= null");
    });

    it("classification is STRUCTURAL+PRESCRIPTIVE+ERROR with propagation NONE", () => {
      const rule = getGuardrailOrThrow("GR-L3-005");
      expect(rule.origin).toBe("STRUCTURAL");
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
      expect(rule.propagation).toBe("NONE");
    });

    it("does not drift to camelCase or shortened SLA field names", () => {
      const rule = getGuardrailOrThrow("GR-L3-005");
      expect(rule.condition).not.toContain("object.slaReference");
      expect(rule.condition).not.toMatch(/object\.sla\b/);
      expect(rule.condition).not.toContain("object.sla_url");
      expect(rule.condition).not.toContain("object.contract_reference");
      expect(rule.condition).not.toContain("object.sla_doc");
    });
  });

  describe("GR-L3-006 ArchitectureComponent without traces-to BoundedContext", () => {
    it("scope targets ArchitectureComponent with relationship_type='traces-to'", () => {
      const rule = getGuardrailOrThrow("GR-L3-006");
      expect(rule.scope.object_type).toBe("ArchitectureComponent");
      expect(rule.scope.relationship_type).toBe("traces-to");
      expect(rule.scope.triggers).toContain("UPDATE");
      expect(rule.scope.triggers).toContain("PERIODIC");
    });

    it("condition walks traces-to with target_type='BoundedContext' (>=1)", () => {
      const rule = getGuardrailOrThrow("GR-L3-006");
      expect(rule.condition).toContain("type='traces-to'");
      expect(rule.condition).toContain("target_type='BoundedContext'");
      expect(rule.condition).toContain(">= 1");
    });

    it("classification is SEMANTIC+DESCRIPTIVE+WARNING with propagation UPWARD", () => {
      const rule = getGuardrailOrThrow("GR-L3-006");
      expect(rule.origin).toBe("SEMANTIC");
      expect(rule.evaluation).toBe("DESCRIPTIVE");
      expect(rule.severity).toBe("WARNING");
      expect(rule.propagation).toBe("UPWARD");
    });

    it("does not drift to invented context-binding edge names or target types", () => {
      const rule = getGuardrailOrThrow("GR-L3-006");
      // The canonical edge is `traces-to` (kap. 2.2). Domain-binding synonyms
      // are easy to reach for but not in the catalog.
      expect(rule.condition).not.toContain("type='in-context'");
      expect(rule.condition).not.toContain("type='owned-by'");
      expect(rule.condition).not.toContain("type='realizes'");
      expect(rule.condition).not.toContain("type='maps-to'");
      expect(rule.condition).not.toContain("target_type='Context'");
      expect(rule.condition).not.toContain("target_type='Domain'");
      expect(rule.condition).not.toContain("target_type='DomainEntity'");
    });
  });

  describe("GR-L3-007 Cyclic depends-on between ArchitectureComponents", () => {
    it("scope targets ArchitectureComponent with relationship_type='depends-on'", () => {
      const rule = getGuardrailOrThrow("GR-L3-007");
      expect(rule.scope.object_type).toBe("ArchitectureComponent");
      expect(rule.scope.relationship_type).toBe("depends-on");
      expect(rule.scope.triggers).toContain("PERIODIC");
      expect(rule.scope.triggers).toContain("UPDATE");
    });

    it("condition uses no_cycle_in over the depends-on edge", () => {
      const rule = getGuardrailOrThrow("GR-L3-007");
      expect(rule.condition).toContain("no_cycle_in(ArchitectureComponent");
      expect(rule.condition).toContain("relationship='depends-on'");
    });

    it("classification is STRUCTURAL+DESCRIPTIVE+ERROR with propagation LATERAL", () => {
      const rule = getGuardrailOrThrow("GR-L3-007");
      expect(rule.origin).toBe("STRUCTURAL");
      expect(rule.evaluation).toBe("DESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
      expect(rule.propagation).toBe("LATERAL");
    });

    it("does not drift to alternative dependency edge names", () => {
      const rule = getGuardrailOrThrow("GR-L3-007");
      // The canonical edge is `depends-on` (kap. 2.2). Synonyms break the
      // cycle scan because they walk the wrong graph.
      expect(rule.condition).not.toContain("relationship='uses'");
      expect(rule.condition).not.toContain("relationship='requires'");
      expect(rule.condition).not.toContain("relationship='calls'");
      expect(rule.condition).not.toContain("relationship='consumes'");
      expect(rule.condition).not.toContain("relationship='depends_on'");
    });
  });
});

describe("GR-L4 contract-layer guardrail drift guards (GR-L4-001..005, 007)", () => {
  describe("GR-L4-001 APIEndpoint must declare ≥ 1 error_response", () => {
    it("scope targets APIEndpoint on CREATE/UPDATE", () => {
      const rule = getGuardrailOrThrow("GR-L4-001");
      expect(rule.scope.object_type).toBe("APIEndpoint");
      expect(rule.scope.triggers).toContain("CREATE");
      expect(rule.scope.triggers).toContain("UPDATE");
    });

    it("condition reads object.error_responses.length with >= 1 cardinality", () => {
      const rule = getGuardrailOrThrow("GR-L4-001");
      expect(rule.condition).toContain("object.error_responses.length");
      expect(rule.condition).toContain(">= 1");
    });

    it("classification is STRUCTURAL+PRESCRIPTIVE+ERROR with propagation NONE", () => {
      const rule = getGuardrailOrThrow("GR-L4-001");
      expect(rule.origin).toBe("STRUCTURAL");
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
      expect(rule.propagation).toBe("NONE");
    });

    it("does not drift to camelCase or shortened error-collection names", () => {
      const rule = getGuardrailOrThrow("GR-L4-001");
      // Catalog conditions are snake_case; schema is camelCase (kap. 4 §
      // L4 / APIEndpoint.errorResponses) but the runtime view stays snake_case.
      expect(rule.condition).not.toContain("object.errorResponses");
      expect(rule.condition).not.toContain("object.errors");
      expect(rule.condition).not.toContain("object.failures");
      expect(rule.condition).not.toContain("object.error_codes");
      expect(rule.condition).not.toContain("object.error_payloads");
    });
  });

  describe("GR-L4-002 APIEndpoint must declare response_schema", () => {
    it("scope targets APIEndpoint on CREATE/UPDATE", () => {
      const rule = getGuardrailOrThrow("GR-L4-002");
      expect(rule.scope.object_type).toBe("APIEndpoint");
      expect(rule.scope.triggers).toContain("CREATE");
      expect(rule.scope.triggers).toContain("UPDATE");
    });

    it("condition reads object.response_schema with non-null check", () => {
      const rule = getGuardrailOrThrow("GR-L4-002");
      expect(rule.condition).toContain("object.response_schema");
      expect(rule.condition).toContain("!= null");
    });

    it("classification is STRUCTURAL+PRESCRIPTIVE+ERROR with propagation NONE", () => {
      const rule = getGuardrailOrThrow("GR-L4-002");
      expect(rule.origin).toBe("STRUCTURAL");
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
      expect(rule.propagation).toBe("NONE");
    });

    it("does not drift to camelCase or alternative response-shape field names", () => {
      const rule = getGuardrailOrThrow("GR-L4-002");
      expect(rule.condition).not.toContain("object.responseSchema");
      expect(rule.condition).not.toMatch(/object\.response\b(?!_schema)/);
      expect(rule.condition).not.toContain("object.payload_schema");
      expect(rule.condition).not.toContain("object.return_schema");
      expect(rule.condition).not.toContain("object.body_schema");
      expect(rule.condition).not.toMatch(/object\.schema\b/);
    });
  });

  describe("GR-L4-003 EventContract must declare ordering and delivery guarantees", () => {
    it("scope targets EventContract on CREATE/UPDATE", () => {
      const rule = getGuardrailOrThrow("GR-L4-003");
      expect(rule.scope.object_type).toBe("EventContract");
      expect(rule.scope.triggers).toContain("CREATE");
      expect(rule.scope.triggers).toContain("UPDATE");
    });

    it("condition reads ordering_guarantee AND delivery_guarantee non-null (both required)", () => {
      const rule = getGuardrailOrThrow("GR-L4-003");
      expect(rule.condition).toContain("object.ordering_guarantee");
      expect(rule.condition).toContain("object.delivery_guarantee");
      expect(rule.condition).toContain("!= null");
      // Must conjoin both fields — a single-field check would let the other slip through.
      expect(rule.condition).toContain("&&");
    });

    it("classification is STRUCTURAL+PRESCRIPTIVE+ERROR with propagation NONE", () => {
      const rule = getGuardrailOrThrow("GR-L4-003");
      expect(rule.origin).toBe("STRUCTURAL");
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
      expect(rule.propagation).toBe("NONE");
    });

    it("does not drift to camelCase or shortened guarantee field names", () => {
      const rule = getGuardrailOrThrow("GR-L4-003");
      expect(rule.condition).not.toContain("object.orderingGuarantee");
      expect(rule.condition).not.toContain("object.deliveryGuarantee");
      expect(rule.condition).not.toMatch(/object\.ordering\b(?!_guarantee)/);
      expect(rule.condition).not.toMatch(/object\.delivery\b(?!_guarantee)/);
      expect(rule.condition).not.toContain("object.order_guarantee");
      expect(rule.condition).not.toContain("object.qos");
    });
  });

  describe("GR-L4-004 APIContract must declare SemVer version", () => {
    it("scope targets APIContract on CREATE/UPDATE", () => {
      const rule = getGuardrailOrThrow("GR-L4-004");
      expect(rule.scope.object_type).toBe("APIContract");
      expect(rule.scope.triggers).toContain("CREATE");
      expect(rule.scope.triggers).toContain("UPDATE");
    });

    it("condition reads object.version non-null AND is_semver(object.version)", () => {
      const rule = getGuardrailOrThrow("GR-L4-004");
      expect(rule.condition).toContain("object.version");
      expect(rule.condition).toContain("!= null");
      expect(rule.condition).toContain("is_semver(object.version)");
      // Both halves required — a non-null check without semver gate would let "v1" or "latest" slip through.
      expect(rule.condition).toContain("&&");
    });

    it("classification is STRUCTURAL+PRESCRIPTIVE+ERROR with propagation NONE", () => {
      const rule = getGuardrailOrThrow("GR-L4-004");
      expect(rule.origin).toBe("STRUCTURAL");
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
      expect(rule.propagation).toBe("NONE");
    });

    it("does not drift to alternative version field names or non-semver validators", () => {
      const rule = getGuardrailOrThrow("GR-L4-004");
      expect(rule.condition).not.toContain("object.api_version");
      expect(rule.condition).not.toContain("object.contract_version");
      expect(rule.condition).not.toContain("object.versionString");
      expect(rule.condition).not.toContain("object.version_number");
      // Must use is_semver, not a custom regex literal — the catalog's
      // SemVer validator is the canonical hook (kap. 2.7 change classification).
      expect(rule.condition).not.toContain("matches '\\d+\\.\\d+\\.\\d+'");
      expect(rule.condition).not.toContain("is_version(");
    });
  });

  describe("GR-L4-005 Service without realizes link to ArchitectureComponent", () => {
    it("scope targets Service with relationship_type='realizes'", () => {
      const rule = getGuardrailOrThrow("GR-L4-005");
      expect(rule.scope.object_type).toBe("Service");
      expect(rule.scope.relationship_type).toBe("realizes");
      expect(rule.scope.triggers).toContain("UPDATE");
      expect(rule.scope.triggers).toContain("PERIODIC");
    });

    it("condition walks realizes with target_type='ArchitectureComponent' (>= 1)", () => {
      const rule = getGuardrailOrThrow("GR-L4-005");
      expect(rule.condition).toContain("type='realizes'");
      expect(rule.condition).toContain("target_type='ArchitectureComponent'");
      expect(rule.condition).toContain(">= 1");
    });

    it("classification is SEMANTIC+DESCRIPTIVE+WARNING with propagation UPWARD", () => {
      const rule = getGuardrailOrThrow("GR-L4-005");
      expect(rule.origin).toBe("SEMANTIC");
      expect(rule.evaluation).toBe("DESCRIPTIVE");
      expect(rule.severity).toBe("WARNING");
      expect(rule.propagation).toBe("UPWARD");
    });

    it("does not drift to invented L4→L3 binding edges or shortened target types", () => {
      const rule = getGuardrailOrThrow("GR-L4-005");
      // The canonical edge is `realizes` (kap. 2.2). Implementation/mapping
      // synonyms are easy to reach for but break the catalog.
      expect(rule.condition).not.toContain("type='implements'");
      expect(rule.condition).not.toContain("type='maps-to'");
      expect(rule.condition).not.toContain("type='realises'");
      expect(rule.condition).not.toContain("type='depends-on'");
      expect(rule.condition).not.toContain("type='part-of'");
      expect(rule.condition).not.toContain("target_type='Component'");
      expect(rule.condition).not.toContain("target_type='ArchComponent'");
      expect(rule.condition).not.toContain("target_type='ArchitectureSystem'");
    });
  });

  describe("GR-L4-007 Service with > N direct depends-on dependencies (god service)", () => {
    it("scope targets Service with relationship_type='depends-on'", () => {
      const rule = getGuardrailOrThrow("GR-L4-007");
      expect(rule.scope.object_type).toBe("Service");
      expect(rule.scope.relationship_type).toBe("depends-on");
      expect(rule.scope.triggers).toContain("PERIODIC");
      expect(rule.scope.triggers).toContain("UPDATE");
    });

    it("condition walks depends-on and gates on config.l4.max_service_dependencies", () => {
      const rule = getGuardrailOrThrow("GR-L4-007");
      expect(rule.condition).toContain("type='depends-on'");
      expect(rule.condition).toContain("config.l4.max_service_dependencies");
      // Cardinality is a configurable max (≤), not a hard literal.
      expect(rule.condition).toContain("<=");
    });

    it("classification is SEMANTIC+DESCRIPTIVE+WARNING with propagation LATERAL", () => {
      const rule = getGuardrailOrThrow("GR-L4-007");
      expect(rule.origin).toBe("SEMANTIC");
      expect(rule.evaluation).toBe("DESCRIPTIVE");
      expect(rule.severity).toBe("WARNING");
      expect(rule.propagation).toBe("LATERAL");
    });

    it("does not drift to alternative dependency edges or hard-coded thresholds", () => {
      const rule = getGuardrailOrThrow("GR-L4-007");
      // Synonyms walk the wrong graph; a hard-coded threshold defeats the
      // configurability promise of the rule.
      expect(rule.condition).not.toContain("type='uses'");
      expect(rule.condition).not.toContain("type='requires'");
      expect(rule.condition).not.toContain("type='calls'");
      expect(rule.condition).not.toContain("type='consumes'");
      expect(rule.condition).not.toContain("type='depends_on'");
      expect(rule.condition).not.toMatch(/<=\s*\d+/);
    });
  });
});

describe("GR-L5 implementation-layer guardrail drift guards (GR-L5-001..002, 004, 006..007)", () => {
  describe("GR-L5-001 TechnicalDebt must declare rationale", () => {
    it("scope targets TechnicalDebt on CREATE/UPDATE", () => {
      const rule = getGuardrailOrThrow("GR-L5-001");
      expect(rule.scope.object_type).toBe("TechnicalDebt");
      expect(rule.scope.triggers).toContain("CREATE");
      expect(rule.scope.triggers).toContain("UPDATE");
    });

    it("condition reads object.rationale non-null AND non-empty length", () => {
      const rule = getGuardrailOrThrow("GR-L5-001");
      expect(rule.condition).toContain("object.rationale");
      expect(rule.condition).toContain("!= null");
      expect(rule.condition).toContain("object.rationale.length > 0");
    });

    it("classification is STRUCTURAL+PRESCRIPTIVE+ERROR with propagation NONE", () => {
      const rule = getGuardrailOrThrow("GR-L5-001");
      expect(rule.origin).toBe("STRUCTURAL");
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
      expect(rule.propagation).toBe("NONE");
    });

    it("does not drift to common synonyms for rationale", () => {
      const rule = getGuardrailOrThrow("GR-L5-001");
      // `motivation` is the kap. 4 field on Requirement (see GR-L1-003); on
      // TechnicalDebt the canonical attribute is `rationale`. Synonyms must
      // not slip in either direction.
      expect(rule.condition).not.toContain("object.motivation");
      expect(rule.condition).not.toContain("object.justification");
      expect(rule.condition).not.toContain("object.reason");
      expect(rule.condition).not.toContain("object.why");
      expect(rule.condition).not.toContain("object.notes");
      expect(rule.condition).not.toContain("object.description");
    });
  });

  describe("GR-L5-002 CodeModule must declare repository_reference", () => {
    it("scope targets CodeModule on CREATE/UPDATE", () => {
      const rule = getGuardrailOrThrow("GR-L5-002");
      expect(rule.scope.object_type).toBe("CodeModule");
      expect(rule.scope.triggers).toContain("CREATE");
      expect(rule.scope.triggers).toContain("UPDATE");
    });

    it("condition reads object.repository_reference with non-null check", () => {
      const rule = getGuardrailOrThrow("GR-L5-002");
      expect(rule.condition).toContain("object.repository_reference");
      expect(rule.condition).toContain("!= null");
    });

    it("classification is STRUCTURAL+PRESCRIPTIVE+ERROR with propagation NONE", () => {
      const rule = getGuardrailOrThrow("GR-L5-002");
      expect(rule.origin).toBe("STRUCTURAL");
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
      expect(rule.propagation).toBe("NONE");
    });

    it("does not drift to camelCase or shortened repo-reference field names", () => {
      const rule = getGuardrailOrThrow("GR-L5-002");
      expect(rule.condition).not.toContain("object.repositoryReference");
      expect(rule.condition).not.toMatch(/object\.repo\b/);
      expect(rule.condition).not.toContain("object.repo_url");
      expect(rule.condition).not.toContain("object.repo_ref");
      expect(rule.condition).not.toContain("object.source_repo");
      expect(rule.condition).not.toContain("object.vcs_ref");
      expect(rule.condition).not.toContain("object.scm_url");
    });
  });

  describe("GR-L5-004 ExternalDependency CRITICAL without security_audit_date", () => {
    it("scope targets ExternalDependency on CREATE/UPDATE/PERIODIC", () => {
      const rule = getGuardrailOrThrow("GR-L5-004");
      expect(rule.scope.object_type).toBe("ExternalDependency");
      expect(rule.scope.triggers).toContain("CREATE");
      expect(rule.scope.triggers).toContain("UPDATE");
      expect(rule.scope.triggers).toContain("PERIODIC");
    });

    it("condition pairs criticality=='CRITICAL' implies security_audit_date != null", () => {
      const rule = getGuardrailOrThrow("GR-L5-004");
      expect(rule.condition).toContain("object.criticality == 'CRITICAL'");
      expect(rule.condition).toContain("object.security_audit_date");
      expect(rule.condition).toContain("!= null");
      // Implication form, not a bare conjunction — non-CRITICAL deps are not gated.
      expect(rule.condition).toContain("implies");
    });

    it("classification is SEMANTIC+DESCRIPTIVE+ERROR with propagation NONE", () => {
      const rule = getGuardrailOrThrow("GR-L5-004");
      expect(rule.origin).toBe("SEMANTIC");
      expect(rule.evaluation).toBe("DESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
      expect(rule.propagation).toBe("NONE");
    });

    it("does not drift to camelCase or alternative audit-date field names", () => {
      const rule = getGuardrailOrThrow("GR-L5-004");
      expect(rule.condition).not.toContain("object.securityAuditDate");
      expect(rule.condition).not.toMatch(/object\.audit_date\b/);
      expect(rule.condition).not.toContain("object.last_security_review");
      expect(rule.condition).not.toContain("object.security_review_date");
      expect(rule.condition).not.toContain("object.sec_audit_at");
      expect(rule.condition).not.toContain("object.last_audit");
      // Must not weaken to non-CRITICAL classifications without an explicit catalog change.
      expect(rule.condition).not.toContain("'HIGH'");
      expect(rule.condition).not.toContain("'MEDIUM'");
    });
  });

  describe("GR-L5-006 CodeModule without validated-by Test", () => {
    it("scope targets CodeModule with relationship_type='validated-by'", () => {
      const rule = getGuardrailOrThrow("GR-L5-006");
      expect(rule.scope.object_type).toBe("CodeModule");
      expect(rule.scope.relationship_type).toBe("validated-by");
      expect(rule.scope.triggers).toContain("UPDATE");
      expect(rule.scope.triggers).toContain("PERIODIC");
    });

    it("condition walks validated-by with target_type='Test' (>= 1)", () => {
      const rule = getGuardrailOrThrow("GR-L5-006");
      expect(rule.condition).toContain("type='validated-by'");
      expect(rule.condition).toContain("target_type='Test'");
      expect(rule.condition).toContain(">= 1");
    });

    it("classification is SEMANTIC+DESCRIPTIVE+WARNING with propagation LATERAL", () => {
      const rule = getGuardrailOrThrow("GR-L5-006");
      expect(rule.origin).toBe("SEMANTIC");
      expect(rule.evaluation).toBe("DESCRIPTIVE");
      expect(rule.severity).toBe("WARNING");
      expect(rule.propagation).toBe("LATERAL");
    });

    it("does not drift to invented test-coverage edge names or wrong direction", () => {
      const rule = getGuardrailOrThrow("GR-L5-006");
      // The canonical edge is `validated-by` (kap. 2.2). Synonyms break the
      // coverage scan because they walk the wrong relationship.
      expect(rule.condition).not.toContain("type='tested-by'");
      expect(rule.condition).not.toContain("type='covers'");
      expect(rule.condition).not.toContain("type='covered-by'");
      expect(rule.condition).not.toContain("type='verified-by'");
      // Reverse direction (validated-by walked from Test side) is the wrong
      // shape for a CodeModule-scoped rule.
      expect(rule.condition).not.toContain("type='validates'");
      expect(rule.condition).not.toContain("target_type='UnitTest'");
      expect(rule.condition).not.toContain("target_type='TestCase'");
    });
  });

  describe("GR-L5-007 ExternalDependency with GPL license in COMMERCIAL context", () => {
    it("scope targets ExternalDependency on CREATE/UPDATE/PERIODIC", () => {
      const rule = getGuardrailOrThrow("GR-L5-007");
      expect(rule.scope.object_type).toBe("ExternalDependency");
      expect(rule.scope.triggers).toContain("CREATE");
      expect(rule.scope.triggers).toContain("UPDATE");
      expect(rule.scope.triggers).toContain("PERIODIC");
    });

    it("condition reads object.license with 'GPL*' glob and config.distribution.context == 'COMMERCIAL'", () => {
      const rule = getGuardrailOrThrow("GR-L5-007");
      expect(rule.condition).toContain("object.license");
      expect(rule.condition).toContain("'GPL*'");
      expect(rule.condition).toContain("config.distribution.context == 'COMMERCIAL'");
      // Negated implication shape — rule fires only when GPL AND COMMERCIAL coincide.
      expect(rule.condition).toContain("&&");
    });

    it("classification is SEMANTIC+DESCRIPTIVE+WARNING with propagation NONE", () => {
      const rule = getGuardrailOrThrow("GR-L5-007");
      expect(rule.origin).toBe("SEMANTIC");
      expect(rule.evaluation).toBe("DESCRIPTIVE");
      expect(rule.severity).toBe("WARNING");
      expect(rule.propagation).toBe("NONE");
    });

    it("does not drift to alternative license field names or non-canonical context flags", () => {
      const rule = getGuardrailOrThrow("GR-L5-007");
      // Catalog conditions use `object.license` (kap. 4 § L5 / ExternalDependency).
      // UK spelling and SPDX synonyms must not slip in.
      expect(rule.condition).not.toContain("object.licence");
      expect(rule.condition).not.toContain("object.license_id");
      expect(rule.condition).not.toContain("object.license_type");
      expect(rule.condition).not.toContain("object.spdx");
      expect(rule.condition).not.toContain("object.spdx_id");
      // Distribution context lives under config.distribution.context — alternative paths break the rule.
      expect(rule.condition).not.toContain("config.context");
      expect(rule.condition).not.toContain("config.distribution_mode");
      expect(rule.condition).not.toContain("== 'PROPRIETARY'");
      expect(rule.condition).not.toContain("== 'CLOSED_SOURCE'");
    });

    it("ExternalDependencySchema exposes the `license` attribute the rule reads (LSDS-920)", () => {
      // Before LSDS-920 the GR-L5-007 condition referenced `object.license`
      // while ExternalDependencySchema had no such field — the rule was
      // structurally dead. Lock the schema-side anchor here so any future
      // rename or removal of `license` breaks this test loudly instead of
      // silently no-op'ing the rule once a real evaluator lands.
      const parsed = ExternalDependencySchema.parse({
        ...tknBase({ type: "ExternalDependency", layer: "L5", name: "license-anchor-fixture" }),
        description: "Schema license anchor for GR-L5-007.",
        packageManager: "NPM",
        packageName: "left-pad",
        versionConstraint: "^1.0.0",
        isDirect: true,
        hasKnownVulnerability: false,
        criticality: "LOW",
        license: "MIT",
      });
      expect(parsed.license).toBe("MIT");
    });
  });
});

