// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import { getGuardrailOrThrow } from "../../src/guardrail";

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
    expect(rule.condition).toContain("object.status == 'APPROVED'");
    expect(rule.condition).toContain("object.impacts");
    expect(rule.condition).toContain("== 0");
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

  it("GR-L3-008 is DESCRIPTIVE+WARNING (PRESCRIPTIVE+WARNING is not a valid combination)", () => {
    const rule = getGuardrailOrThrow("GR-L3-008");
    expect(rule.evaluation).toBe("DESCRIPTIVE");
    expect(rule.severity).toBe("WARNING");
    expect(rule.scope.triggers).toContain("PERIODIC");
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

  it("GR-L6-002 condition checks Alert.runbook_reference and uses `runbook_reference` relationship_type", () => {
    // Positive: rule reads the canonical field name and the scope declares the
    // correct relationship_type so the traversal engine filters correctly.
    const rule = getGuardrailOrThrow("GR-L6-002");
    expect(rule.scope.object_type).toBe("Alert");
    expect(rule.condition).toContain("object.runbook_reference");
    expect(rule.scope.relationship_type).toBe("runbook_reference");
    expect(rule.origin).toBe("STRUCTURAL");
    expect(rule.evaluation).toBe("PRESCRIPTIVE");
    expect(rule.severity).toBe("ERROR");
    // Negative: drift guard — must not use invented edge names or alternate field names.
    expect(rule.condition).not.toContain("type='has-runbook'");
    expect(rule.condition).not.toContain("type='runbook-for'");
    expect(rule.condition).not.toContain("object.runbook_url");
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

    it("propagation is DOWNWARD", () => {
      const rule = getGuardrailOrThrow("GR-XL-005");
      expect(rule.propagation).toBe("DOWNWARD");
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

    it("propagation is DOWNWARD", () => {
      const rule = getGuardrailOrThrow("GR-XL-006");
      expect(rule.propagation).toBe("DOWNWARD");
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

  describe("GR-XL-009 DEPRECATED object still has active depends-on relationships", () => {
    it("condition checks lifecycle DEPRECATED and incoming depends-on edge with ACTIVE source (not DECOMMISSIONED)", () => {
      const rule = getGuardrailOrThrow("GR-XL-009");
      expect(rule.condition).toContain("DEPRECATED");
      expect(rule.condition).toContain("depends-on");
      expect(rule.condition).toContain("ACTIVE");
      expect(rule.condition).not.toContain("DECOMMISSIONED");
    });

    it("scope.relationship_type is depends-on", () => {
      const rule = getGuardrailOrThrow("GR-XL-009");
      expect(rule.scope.relationship_type).toBe("depends-on");
    });

    it("propagation is UPWARD (not DOWNWARD — distinguish from GR-XL-006)", () => {
      const rule = getGuardrailOrThrow("GR-XL-009");
      expect(rule.propagation).toBe("UPWARD");
      expect(rule.propagation).not.toBe("DOWNWARD");
    });

    it("evaluation is DESCRIPTIVE and severity is WARNING", () => {
      const rule = getGuardrailOrThrow("GR-XL-009");
      expect(rule.evaluation).toBe("DESCRIPTIVE");
      expect(rule.severity).toBe("WARNING");
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

  describe("GR-XL-011 hard delete blocked by incoming relationships", () => {
    it("condition reads object.incoming_relationships.length (not incoming_refs or inbound_edges)", () => {
      const rule = getGuardrailOrThrow("GR-XL-011");
      expect(rule.condition).toContain("incoming_relationships");
      expect(rule.condition).not.toContain("incoming_refs");
      expect(rule.condition).not.toContain("inbound_edges");
    });

    it("remediation references the lifecycle soft-delete path (DEPRECATED → ARCHIVED → PURGE)", () => {
      const rule = getGuardrailOrThrow("GR-XL-011");
      expect(rule.remediation).toMatch(/DEPRECATED|ARCHIVED|lifecycle/i);
    });

    it("propagation is UPWARD (not DOWNWARD — distinguish from GR-XL-005)", () => {
      const rule = getGuardrailOrThrow("GR-XL-011");
      expect(rule.propagation).toBe("UPWARD");
      expect(rule.propagation).not.toBe("DOWNWARD");
    });

    it("triggers include DELETE, evaluation is PRESCRIPTIVE, severity is ERROR", () => {
      const rule = getGuardrailOrThrow("GR-XL-011");
      expect(rule.scope.triggers).toContain("DELETE");
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
    });
  });
});

