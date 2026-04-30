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

// Lock-in for the cross-layer (XL) catalog row of kap. 5 (LSDS-166).
// Mirrors the L1 (LSDS-165) and L6 (LSDS-144) alignment scans: every
// XL-NNN rule asserts condition fields, remediation references, propagation
// policy, and severity so silent drift in the universal/lifecycle rules
// fails loudly with the exact rule id.
describe("catalog field-name alignment with kap. 5 — GR-XL", () => {
  describe("GR-XL-001 — Object without owner (universal owner attribute)", () => {
    const rule = getGuardrailOrThrow("GR-XL-001");

    it("condition reads the canonical TknBase.owner attribute", () => {
      // Positive: kap. 4 universal TknBase exposes `owner` (TeamRef|PersonRef).
      expect(rule.condition).toContain("object.owner");
      expect(rule.condition).toContain("!= null");
      // Negative: the owner attribute is the universal one, not a per-type
      // alias such as ownerId, owner_id, or owner_team.
      expect(rule.condition).not.toContain("object.ownerId");
      expect(rule.condition).not.toContain("object.owner_id");
      expect(rule.condition).not.toContain("object.owner_team");
      expect(rule.condition).not.toContain("object.team_owner");
      expect(rule.condition).not.toContain("object.responsible");
    });

    it("remediation names owner + TeamRef/PersonRef so authors know what to set", () => {
      expect(rule.remediation).toContain("owner");
      expect(rule.remediation).toMatch(/TeamRef|PersonRef/);
    });

    it("severity ERROR + propagation NONE (rule is local — owner does not cascade)", () => {
      // Owner-missing is a structural local invariant — there is no parent
      // that should inherit a missing-owner violation, so propagation stays
      // NONE. PRESCRIPTIVE+ERROR is the only valid blocking combination.
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
      expect(rule.propagation).toBe("NONE");
      expect(rule.origin).toBe("STRUCTURAL");
    });

    it("scope is universal (object_type='*') with CREATE+UPDATE triggers", () => {
      expect(rule.scope.object_type).toBe("*");
      expect(rule.scope.triggers).toContain("CREATE");
      expect(rule.scope.triggers).toContain("UPDATE");
    });
  });

  describe("GR-XL-002 — Relationship targets a non-existent object", () => {
    const rule = getGuardrailOrThrow("GR-XL-002");

    it("condition checks the canonical target_object_id reference", () => {
      // Positive: kap. 2.2 names the field `target_object_id` (and
      // `source_object_id`); other variants are drift.
      expect(rule.condition).toContain("target_object_id");
      // Negative: drift guards for the most likely renames.
      expect(rule.condition).not.toContain("targetId");
      expect(rule.condition).not.toContain("target_id");
      expect(rule.condition).not.toContain("toId");
      expect(rule.condition).not.toContain("to_id");
    });

    it("remediation tells the author to create the target or drop the edge", () => {
      expect(rule.remediation.toLowerCase()).toContain("relationship");
      expect(rule.remediation.toLowerCase()).toMatch(/target|missing/);
    });

    it("severity ERROR + propagation LATERAL (dangling edge spreads via the graph)", () => {
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
      expect(rule.propagation).toBe("LATERAL");
      expect(rule.origin).toBe("STRUCTURAL");
    });

    it("scope targets the Relationship pseudo-object on CREATE+UPDATE", () => {
      expect(rule.scope.object_type).toBe("Relationship");
      expect(rule.scope.triggers).toContain("CREATE");
      expect(rule.scope.triggers).toContain("UPDATE");
    });
  });

  describe("GR-XL-003 — Relationship violates layer rules", () => {
    const rule = getGuardrailOrThrow("GR-XL-003");

    it("condition references source.layer and target.layer (kap. 3 layer ordinal)", () => {
      // Positive: layer rules are checked off the source/target layer
      // ordinals defined in kap. 3.
      expect(rule.condition).toContain("source.layer");
      expect(rule.condition).toContain("target.layer");
      expect(rule.condition).toContain("relationship.kind");
      // Negative: must not invent attribute names for the layer dimension.
      expect(rule.condition).not.toContain("source_layer");
      expect(rule.condition).not.toContain("target_layer");
      expect(rule.condition).not.toContain("layer_id");
    });

    it("remediation talks about layers and re-targeting via permitted relationship kinds", () => {
      expect(rule.remediation.toLowerCase()).toMatch(/layer|relationship|kind/);
    });

    it("severity ERROR + propagation LATERAL (illegal edge stays at the seam)", () => {
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
      expect(rule.propagation).toBe("LATERAL");
      expect(rule.origin).toBe("STRUCTURAL");
    });

    it("scope targets the Relationship pseudo-object on CREATE+UPDATE", () => {
      expect(rule.scope.object_type).toBe("Relationship");
      expect(rule.scope.triggers).toContain("CREATE");
      expect(rule.scope.triggers).toContain("UPDATE");
    });
  });

  describe("GR-XL-004 — Archiving an object with ACTIVE dependents", () => {
    const rule = getGuardrailOrThrow("GR-XL-004");

    it("condition reads incoming relationships and source.lifecycle='ACTIVE'", () => {
      // Positive: cascade is detected by inspecting incoming edges and the
      // source object's lifecycle (kap. 2.9 lifecycle vocabulary).
      expect(rule.condition).toContain("incoming_relationships");
      expect(rule.condition).toContain("source.lifecycle");
      expect(rule.condition).toContain("'ACTIVE'");
      // Negative: lifecycle is the universal field — not state/status/phase.
      expect(rule.condition).not.toContain("source.state");
      expect(rule.condition).not.toContain("source.status");
      expect(rule.condition).not.toContain("source.phase");
    });

    it("remediation names migrating/archiving dependents before the parent", () => {
      expect(rule.remediation.toLowerCase()).toMatch(/dependent|migrate|archive/);
    });

    it("severity ERROR + propagation DOWNWARD (cascades to dependents)", () => {
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
      expect(rule.propagation).toBe("DOWNWARD");
      expect(rule.origin).toBe("STRUCTURAL");
    });

    it("scope is universal with ARCHIVE + UPDATE triggers", () => {
      expect(rule.scope.object_type).toBe("*");
      expect(rule.scope.triggers).toContain("ARCHIVE");
      expect(rule.scope.triggers).toContain("UPDATE");
    });
  });

  describe("GR-XL-005 — Hard delete of an object with incoming relationships", () => {
    const rule = getGuardrailOrThrow("GR-XL-005");

    it("condition checks incoming_relationships count is 0 on the deleted target", () => {
      expect(rule.condition).toContain("incoming_relationships");
      expect(rule.condition).toContain("length == 0");
      // Negative: must not invert the meaning by checking outgoing edges.
      expect(rule.condition).not.toContain("outgoing_relationships");
    });

    it("remediation routes the author to ARCHIVED → PURGE (no hard delete shortcut)", () => {
      expect(rule.remediation).toContain("ARCHIVED");
      expect(rule.remediation).toContain("PURGE");
    });

    it("severity ERROR + propagation DOWNWARD (deletion would orphan dependents)", () => {
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
      expect(rule.propagation).toBe("DOWNWARD");
      expect(rule.origin).toBe("STRUCTURAL");
    });

    it("scope is universal and fires on DELETE only", () => {
      expect(rule.scope.object_type).toBe("*");
      expect(rule.scope.triggers).toContain("DELETE");
    });
  });

  describe("GR-XL-006 — DEPRECATED object still has active depends-on dependents", () => {
    const rule = getGuardrailOrThrow("GR-XL-006");

    it("condition reads object.lifecycle='DEPRECATED' and incoming depends-on with ACTIVE source", () => {
      expect(rule.condition).toContain("object.lifecycle");
      expect(rule.condition).toContain("'DEPRECATED'");
      expect(rule.condition).toContain("type='depends-on'");
      expect(rule.condition).toContain("source.lifecycle");
      expect(rule.condition).toContain("'ACTIVE'");
      // Negative: must not use object.status/state for the lifecycle field
      // and must not invent depends-on aliases.
      expect(rule.condition).not.toContain("object.status == 'DEPRECATED'");
      expect(rule.condition).not.toContain("object.state == 'DEPRECATED'");
      expect(rule.condition).not.toContain("type='uses'");
      expect(rule.condition).not.toContain("type='consumes'");
    });

    it("remediation surfaces migration of ACTIVE dependents or rolling lifecycle back", () => {
      expect(rule.remediation.toLowerCase()).toMatch(/migrat|rollback|active/);
    });

    it("severity WARNING + propagation DOWNWARD (descriptive, not blocking)", () => {
      // STRUCTURAL but DESCRIPTIVE: the framework wants to surface stalled
      // deprecations, not block writes that landed before the deprecation.
      expect(rule.evaluation).toBe("DESCRIPTIVE");
      expect(rule.severity).toBe("WARNING");
      expect(rule.propagation).toBe("DOWNWARD");
      expect(rule.origin).toBe("STRUCTURAL");
    });

    it("scope is universal with PERIODIC + UPDATE triggers and depends-on relationship_type", () => {
      expect(rule.scope.object_type).toBe("*");
      expect(rule.scope.relationship_type).toBe("depends-on");
      expect(rule.scope.triggers).toContain("PERIODIC");
      expect(rule.scope.triggers).toContain("UPDATE");
    });
  });

  describe("GR-XL-008 — Object with > 20 direct relationships (god object)", () => {
    const rule = getGuardrailOrThrow("GR-XL-008");

    it("condition reads object.direct_relationships.length and the literal 20 threshold", () => {
      expect(rule.condition).toContain("object.direct_relationships");
      expect(rule.condition).toContain("length");
      expect(rule.condition).toContain("20");
      // Negative: must not use renamed counters or alternative thresholds.
      expect(rule.condition).not.toContain("object.relationship_count");
      expect(rule.condition).not.toContain("object.edges");
      expect(rule.condition).not.toContain("object.relationships.length");
    });

    it("remediation suggests decomposition / aggregating intermediary", () => {
      expect(rule.remediation.toLowerCase()).toMatch(/decompose|split|aggreg/);
    });

    it("severity INFO + propagation LATERAL (advisory, surfaced on the cluster)", () => {
      expect(rule.evaluation).toBe("DESCRIPTIVE");
      expect(rule.severity).toBe("INFO");
      expect(rule.propagation).toBe("LATERAL");
      expect(rule.origin).toBe("SEMANTIC");
    });

    it("scope is universal with PERIODIC + UPDATE triggers", () => {
      expect(rule.scope.object_type).toBe("*");
      expect(rule.scope.triggers).toContain("PERIODIC");
      expect(rule.scope.triggers).toContain("UPDATE");
    });
  });

  describe("GR-XL-009 — DEPRECATED object still has active depends-on relationships", () => {
    const rule = getGuardrailOrThrow("GR-XL-009");

    it("condition reads object.lifecycle and walks incoming depends-on for ACTIVE callers", () => {
      // ADR A09 (archive lifecycle) frames this as the migration-debt rule
      // distinct from XL-006: it counts incoming depends-on edges where the
      // source's lifecycle is still ACTIVE.
      expect(rule.condition).toContain("object.lifecycle");
      expect(rule.condition).toContain("'DEPRECATED'");
      expect(rule.condition).toContain("'depends-on'");
      expect(rule.condition).toContain("'ACTIVE'");
      // Negative: must not flatten lifecycle to status/state.
      expect(rule.condition).not.toContain("object.status == 'DEPRECATED'");
      expect(rule.condition).not.toContain("object.state == 'DEPRECATED'");
    });

    it("remediation names migrating ACTIVE consumers or rolling lifecycle back", () => {
      expect(rule.remediation.toLowerCase()).toMatch(/migrat|active|consumer/);
      expect(rule.remediation).toContain("ACTIVE");
    });

    it("severity WARNING + propagation UPWARD (callers escalate to the deprecated owner)", () => {
      // ADR A09 places XL-009 alongside XL-006 as the structural pair that
      // surfaces stalled migrations; severity is WARNING (not ERROR) so the
      // deprecation itself is not blocked.
      expect(rule.evaluation).toBe("DESCRIPTIVE");
      expect(rule.severity).toBe("WARNING");
      expect(rule.propagation).toBe("UPWARD");
      expect(rule.origin).toBe("STRUCTURAL");
    });

    it("scope is universal with UPDATE + PERIODIC triggers and depends-on relationship_type", () => {
      expect(rule.scope.object_type).toBe("*");
      expect(rule.scope.relationship_type).toBe("depends-on");
      expect(rule.scope.triggers).toContain("UPDATE");
      expect(rule.scope.triggers).toContain("PERIODIC");
    });
  });

  describe("GR-XL-010 — ARCHIVED object has non-archived contains children", () => {
    const rule = getGuardrailOrThrow("GR-XL-010");

    it("condition reads object.lifecycle='ARCHIVED' and walks outgoing contains children", () => {
      expect(rule.condition).toContain("object.lifecycle");
      expect(rule.condition).toContain("'ARCHIVED'");
      expect(rule.condition).toContain("'contains'");
      // PURGE is an accepted terminal sibling of ARCHIVED for cascade.
      expect(rule.condition).toContain("'PURGE'");
      // Negative: must not invent edge aliases or use status/state for lifecycle.
      expect(rule.condition).not.toContain("type='has-child'");
      expect(rule.condition).not.toContain("type='owns'");
      expect(rule.condition).not.toContain("object.status == 'ARCHIVED'");
    });

    it("remediation tells author to archive children before parent (cascade rule)", () => {
      expect(rule.remediation.toLowerCase()).toMatch(/archive|child|migrate/);
    });

    it("severity ERROR + propagation DOWNWARD (children inherit the cascade)", () => {
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
      expect(rule.propagation).toBe("DOWNWARD");
      expect(rule.origin).toBe("STRUCTURAL");
    });

    it("scope is universal with UPDATE + ARCHIVE + PERIODIC triggers and contains relationship_type", () => {
      expect(rule.scope.object_type).toBe("*");
      expect(rule.scope.relationship_type).toBe("contains");
      expect(rule.scope.triggers).toContain("UPDATE");
      expect(rule.scope.triggers).toContain("ARCHIVE");
      expect(rule.scope.triggers).toContain("PERIODIC");
    });
  });

  describe("GR-XL-011 — Hard delete blocked while incoming relationships exist", () => {
    const rule = getGuardrailOrThrow("GR-XL-011");

    it("condition checks object.incoming_relationships.length is 0", () => {
      expect(rule.condition).toContain("object.incoming_relationships");
      expect(rule.condition).toContain("length");
      expect(rule.condition).toContain("0");
      // Negative: must not invert direction or use renamed counters.
      expect(rule.condition).not.toContain("object.outgoing_relationships");
      expect(rule.condition).not.toContain("object.inbound");
    });

    it("remediation routes through DEPRECATED → ARCHIVED → PURGE (the lifecycle path)", () => {
      expect(rule.remediation).toContain("DEPRECATED");
      expect(rule.remediation).toContain("ARCHIVED");
      expect(rule.remediation).toContain("PURGE");
    });

    it("severity ERROR + propagation UPWARD (the still-pointing parents need to know)", () => {
      // ADR A09 pairs XL-005 + XL-011 as the structural guarantee that PURGE
      // is the only sanctioned physical removal path. XL-011 escalates
      // upward: the agent attempting the delete (and any blocking parents)
      // are the ones who must act.
      expect(rule.evaluation).toBe("PRESCRIPTIVE");
      expect(rule.severity).toBe("ERROR");
      expect(rule.propagation).toBe("UPWARD");
      expect(rule.origin).toBe("STRUCTURAL");
    });

    it("scope is universal and fires on DELETE only", () => {
      expect(rule.scope.object_type).toBe("*");
      expect(rule.scope.triggers).toContain("DELETE");
    });
  });

  it("every GR-XL-NNN rule has at least one alignment assertion (no XL rule unguarded)", async () => {
    // Fail loudly if a future XL rule lands in the catalog without an
    // accompanying drift guard in this file. Keeps LSDS-166 enforced.
    const { GUARDRAIL_CATALOG } = await import("../../src/guardrail/catalog");
    const xlRules = GUARDRAIL_CATALOG.filter((r) => r.layer === "XL").map(
      (r) => r.rule_id,
    );
    const guardedIds = new Set([
      "GR-XL-001",
      "GR-XL-002",
      "GR-XL-003",
      "GR-XL-004",
      "GR-XL-005",
      "GR-XL-006",
      "GR-XL-007",
      "GR-XL-008",
      "GR-XL-009",
      "GR-XL-010",
      "GR-XL-011",
    ]);
    const unguarded = xlRules.filter((id) => !guardedIds.has(id));
    expect(unguarded).toEqual([]);
  });
});

