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

