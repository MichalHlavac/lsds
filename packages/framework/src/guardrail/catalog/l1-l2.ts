// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { GuardrailRule } from "../types.js";

export const L1_L2_RULES: GuardrailRule[] = [
  {
    rule_id: "GR-L1-001",
    name: "BusinessCapability must trace to BusinessGoal",
    layer: "L1",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "BusinessCapability",
      triggers: ["CREATE", "UPDATE"],
      relationship_type: "traces-to",
    },
    condition:
      "object.relationships.filter(type='traces-to', target_type='BusinessGoal').length >= 1",
    rationale:
      "Each business capability must exist to advance at least one strategic goal. Capabilities orphaned from goals create work without strategic justification and produce silent scope drift.",
    remediation:
      "Add a traces-to relationship from this BusinessCapability to the BusinessGoal it advances. If no goal applies, capture the goal first (or archive the capability).",
    propagation: "UPWARD",
  },
  {
    rule_id: "GR-L1-002",
    name: "BusinessGoal must declare success_metrics",
    layer: "L1",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "BusinessGoal",
      triggers: ["CREATE", "UPDATE"],
    },
    condition: "object.success_metrics.length >= 1",
    rationale:
      "A goal without measurable outcomes cannot be evaluated and quietly turns into a slogan. Success metrics anchor downstream traceability and review cadence.",
    remediation:
      "Add at least one measurable success metric (KPI, OKR target, or threshold) with a unit and target value before saving the goal.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L1-003",
    name: "Requirement must declare motivation",
    layer: "L1",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "Requirement",
      triggers: ["CREATE", "UPDATE"],
    },
    condition: "object.motivation != null && object.motivation.length > 0",
    rationale:
      "Requirements without a motivation become cargo-cult rules whose original intent is lost the moment the author leaves; review and impact analysis depend on knowing why a requirement exists.",
    remediation:
      "Document the motivation field with the user, business, or compliance need that produced this requirement.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L1-004",
    name: "Requirement must have ≥ 1 acceptance_criteria",
    layer: "L1",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "Requirement",
      triggers: ["CREATE", "UPDATE"],
    },
    condition: "object.acceptance_criteria.length >= 1",
    rationale:
      "Acceptance criteria are the contract between business and implementation; without at least one, a requirement cannot be tested or accepted as IMPLEMENTED.",
    remediation:
      "Add at least one acceptance criterion (id matching AC-<n>) describing an observable, testable outcome.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L1-005",
    name: "Requirement must be part-of a BusinessCapability",
    layer: "L1",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "Requirement",
      triggers: ["CREATE", "UPDATE"],
      relationship_type: "part-of",
    },
    condition:
      "object.relationships.filter(type='part-of', target_type='BusinessCapability').length >= 1",
    rationale:
      "Requirements that float free of any capability skip strategic alignment and end up implemented as isolated features without clear ownership.",
    remediation:
      "Attach a part-of relationship pointing to the BusinessCapability that owns this requirement.",
    propagation: "UPWARD",
  },
  {
    rule_id: "GR-L1-006",
    name: "BusinessGoal without any BusinessCapability",
    layer: "L1",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "WARNING",
    scope: {
      object_type: "BusinessGoal",
      triggers: ["PERIODIC", "UPDATE"],
    },
    condition:
      "incoming_relationships(type='traces-to', source_type='BusinessCapability').length == 0",
    rationale:
      "Goals with zero supporting capabilities will never be delivered; this signals either an abandoned goal or a missing capability.",
    remediation:
      "Either archive the goal or define and link the BusinessCapability that will deliver it.",
    propagation: "DOWNWARD",
  },
  {
    rule_id: "GR-L1-007",
    name: "ACTIVE BusinessGoal not reviewed for > 6 months",
    layer: "L1",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "WARNING",
    scope: {
      object_type: "BusinessGoal",
      triggers: ["PERIODIC"],
    },
    condition:
      "object.lifecycle != 'ACTIVE' || (now - object.last_review_date) <= 180 days",
    rationale:
      "Strategic goals decay; a goal not reviewed in over 6 months is likely stale, mis-aligned, or already met.",
    remediation:
      "Run a goal review: confirm the goal still applies, update success_metrics, or archive it.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L1-008",
    name: "Requirement IMPLEMENTED without modifying its impact targets",
    layer: "L1",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "WARNING",
    scope: {
      object_type: "Requirement",
      triggers: ["UPDATE", "PERIODIC"],
    },
    condition:
      "object.status == 'IMPLEMENTED' && object.impacts.every(i => target_unchanged_since(i.target, requirement.approved_at))",
    rationale:
      "An IMPLEMENTED requirement whose declared impact targets were never touched suggests the implementation drifted from its declared scope or the impact list is wrong. Staleness is measured from approval, not creation, because impact targets are only frozen once the requirement reaches APPROVED.",
    remediation:
      "Reconcile: either correct the impact list, link the actual changed objects, or roll status back to IN_PROGRESS.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L1-009",
    name: "APPROVED Requirement without declared impacts",
    layer: "L1",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "INFO",
    scope: {
      object_type: "Requirement",
      triggers: ["UPDATE", "PERIODIC"],
    },
    condition: "object.status != 'APPROVED' || object.impacts.length > 0",
    rationale:
      "An APPROVED requirement with no declared impact list cannot drive change propagation analysis and gives the implementer no map of what to touch.",
    remediation:
      "Add the expected impacts (CREATE/MODIFY/DEPRECATE on which objects) before moving from APPROVED to IN_PROGRESS.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L2-001",
    name: "BoundedContext must have ≥ N ubiquitous_language terms",
    layer: "L2",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "BoundedContext",
      triggers: ["CREATE", "UPDATE"],
    },
    condition: "object.ubiquitous_language.length >= config.l2.min_terms_per_context",
    rationale:
      "A bounded context without a shared vocabulary is not a context; the language is what makes the boundary real. The threshold N is a semantic configuration knob (default 3, configurable via config.l2.min_terms_per_context).",
    remediation:
      "Capture at least the configured minimum LanguageTerms. Even one canonical term beats none — start with the term that names the context itself.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L2-002",
    name: "BoundedContext must trace to BusinessCapability",
    layer: "L2",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "BoundedContext",
      triggers: ["CREATE", "UPDATE"],
      relationship_type: "traces-to",
    },
    condition:
      "object.relationships.filter(type='traces-to', target_type='BusinessCapability').length >= 1",
    rationale:
      "Domain contexts that do not realise a capability create model surface without business justification, weakening the capability-to-context spine.",
    remediation:
      "Add a traces-to relationship from this BoundedContext to the BusinessCapability it realises.",
    propagation: "UPWARD",
  },
  {
    rule_id: "GR-L2-003",
    name: "DomainEntity must declare ≥ 1 invariant",
    layer: "L2",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "DomainEntity",
      triggers: ["CREATE", "UPDATE"],
    },
    condition: "object.invariants.length >= 1",
    rationale:
      "A domain entity is defined by the invariants it protects; an entity with no invariants is just a record and belongs as a ValueObject or DataContract.",
    remediation:
      "Document at least one invariant the entity guarantees (state, identity, or relational rule). If none exists, downgrade to ValueObject.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L2-004",
    name: "Aggregate must declare transaction_boundary",
    layer: "L2",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "Aggregate",
      triggers: ["CREATE", "UPDATE"],
    },
    condition: "object.transaction_boundary != null",
    rationale:
      "The whole point of an aggregate is the transactional boundary it draws around its members. Without it, consistency rules are unenforceable.",
    remediation:
      "State the transaction_boundary explicitly (which entities are included and the consistency rule applied across them).",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L2-005",
    name: "DomainEvent name must be past tense",
    layer: "L2",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "WARNING",
    scope: {
      object_type: "DomainEvent",
      triggers: ["CREATE", "UPDATE", "PERIODIC"],
    },
    condition: "is_past_tense(object.name)",
    rationale:
      "Past-tense event names ('OrderPlaced', not 'PlaceOrder') keep events distinct from commands and prevent action/event confusion in handlers and event-sourced replay. Detected descriptively (not blocking) so legacy or imported events surface in scans without breaking authoring; PRESCRIPTIVE+WARNING is not a valid combination — prescriptive rules block and must be ERROR.",
    remediation:
      "Rename the event to past tense (e.g. 'OrderPlaced', 'InvoiceIssued', 'PaymentRefunded').",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L2-006",
    name: "Cyclic upstream/downstream relationship between BoundedContexts",
    layer: "L2",
    origin: "STRUCTURAL",
    evaluation: "DESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "BoundedContext",
      triggers: ["PERIODIC", "UPDATE"],
      relationship_type: "context-integration",
    },
    condition: "no_cycle_in(BoundedContext, relationship='context-integration')",
    rationale:
      "Context integration cycles destroy the upstream/downstream contract — both sides try to dictate the model and translation breaks down on the integration seam.",
    remediation:
      "Break the cycle: introduce an Anti-Corruption Layer, invert one direction, or split a context to remove the bidirectional dependency.",
    propagation: "LATERAL",
  },
  {
    rule_id: "GR-L2-007",
    name: "Conformist pattern targeting a CORE BoundedContext",
    layer: "L2",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "WARNING",
    scope: {
      object_type: "BoundedContext",
      triggers: ["UPDATE", "PERIODIC"],
    },
    condition:
      "exists relationship(type='conformist-to', source=this, target.classification='CORE')",
    rationale:
      "Conforming to another team's model on the CORE domain surrenders the strategic differentiator; CORE deserves the cost of an Anti-Corruption Layer.",
    remediation:
      "Replace the conformist relationship with an ACL or partnership pattern, or reclassify the target context if it isn't truly CORE.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L2-008",
    name: "Same LanguageTerm defined differently in two contexts",
    layer: "L2",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "INFO",
    scope: {
      object_type: "LanguageTerm",
      triggers: ["PERIODIC", "UPDATE"],
    },
    condition: "duplicate_term_with_diverging_definitions(this)",
    rationale:
      "The same word meaning two different things across contexts is a fact of DDD, but it's also a known integration hazard worth surfacing for translation maps.",
    remediation:
      "Document the divergence in the context map, or rename one term so the boundary is explicit.",
    propagation: "LATERAL",
  },
];
