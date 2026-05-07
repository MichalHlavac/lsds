// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { GuardrailRule } from "../types.js";

export const XL_RULES: GuardrailRule[] = [
  {
    rule_id: "GR-XL-001",
    name: "Object without owner",
    layer: "XL",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "*",
      triggers: ["CREATE", "UPDATE"],
    },
    condition: "object.owner != null",
    rationale:
      "Unowned objects are nobody's responsibility; reviews, deprecations, and incidents all stall waiting for an accountable team or person.",
    remediation:
      "Set owner to a TeamRef or PersonRef. If no team owns it yet, surface the question — don't paper over it.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-XL-002",
    name: "Relationship targets a non-existent object",
    layer: "XL",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "Relationship",
      triggers: ["CREATE", "UPDATE"],
    },
    condition: "exists(target_object_id)",
    rationale:
      "Dangling relationships silently corrupt traversal; every consumer of the graph then has to defend against missing nodes.",
    remediation:
      "Either create the missing target object first or remove the relationship; never persist a relationship to a non-existent id.",
    propagation: "LATERAL",
  },
  {
    rule_id: "GR-XL-003",
    name: "Relationship violates layer rules",
    layer: "XL",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "Relationship",
      triggers: ["CREATE", "UPDATE"],
    },
    condition: "relationship.kind allowed between source.layer and target.layer",
    rationale:
      "Layer rules encode the architectural spine; a relationship that crosses them (e.g. L1 directly depends on L5) breaks the model the entire framework is built on.",
    remediation:
      "Re-target the relationship through the appropriate intermediate layer, or drop it and model the intent through a permitted relationship kind.",
    propagation: "LATERAL",
  },
  {
    rule_id: "GR-XL-004",
    name: "Archiving an object with ACTIVE dependents",
    layer: "XL",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "*",
      triggers: ["ARCHIVE", "UPDATE"],
    },
    condition:
      "incoming_relationships(target=this).filter(source.lifecycle='ACTIVE').length == 0",
    rationale:
      "Archiving an object referenced by ACTIVE dependents leaves the graph with live references to retired infrastructure or contracts; consumers will keep using the archived surface.",
    remediation:
      "First migrate or archive the dependents (or downgrade their relationship to a successor); only then archive this object.",
    propagation: "DOWNWARD",
  },
  {
    rule_id: "GR-XL-005",
    name: "Hard delete of an object with incoming relationships",
    layer: "XL",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "*",
      triggers: ["DELETE"],
    },
    condition: "incoming_relationships(target=this).length == 0",
    rationale:
      "Hard delete with incoming references guarantees dangling pointers; the lifecycle defines a soft path (ARCHIVED → PURGE) precisely to avoid this.",
    remediation:
      "Move the object through ARCHIVED with dependents migrated; only then can the lifecycle progress to PURGE.",
    propagation: "BOTH",
  },
  {
    rule_id: "GR-XL-006",
    name: "DEPRECATED object still has active depends-on dependents",
    layer: "XL",
    origin: "STRUCTURAL",
    evaluation: "DESCRIPTIVE",
    severity: "WARNING",
    scope: {
      object_type: "*",
      triggers: ["PERIODIC", "UPDATE"],
      relationship_type: "depends-on",
    },
    condition:
      "!(object.lifecycle == 'DEPRECATED' && incoming_relationships(type='depends-on').filter(source.lifecycle='ACTIVE').length > 0)",
    rationale:
      "Deprecated surface with active dependents is the most reliable predictor of a painful future migration; surfacing it early gives owners a chance to act.",
    remediation:
      "Open migration tasks against each ACTIVE dependent or roll the lifecycle back to ACTIVE if the deprecation was premature.",
    propagation: "BOTH",
  },
  {
    rule_id: "GR-XL-007",
    name: "Object without revision for > threshold",
    layer: "XL",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "INFO",
    scope: {
      object_type: "*",
      triggers: ["PERIODIC"],
    },
    condition:
      "(now - object.last_review_date) <= config.governance.review_threshold_days",
    rationale:
      "Even objects that aren't broken decay; periodic review keeps owner, status, and rationale honest. Severity is INFO at first and escalates per layer policy.",
    remediation:
      "Run a lightweight review of the object: confirm owner, lifecycle, and rationale; touch last_review_date when done.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-XL-008",
    name: "Object with > 20 direct relationships (god object)",
    layer: "XL",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "INFO",
    scope: {
      object_type: "*",
      triggers: ["PERIODIC", "UPDATE"],
    },
    condition: "object.direct_relationships.length <= 20",
    rationale:
      "Nodes with more than ~20 direct relationships almost always indicate a missing abstraction; they pull excessive context into traversal and become reviewer choke points.",
    remediation:
      "Decompose: split the object, group fan-out relationships behind an aggregating intermediary, or model the cluster as a separate sub-graph.",
    propagation: "LATERAL",
  },
  {
    rule_id: "GR-XL-010",
    name: "ARCHIVED object has non-archived contains children",
    layer: "XL",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "*",
      triggers: ["UPDATE", "ARCHIVE", "PERIODIC"],
      relationship_type: "contains",
    },
    condition:
      "object.lifecycle != 'ARCHIVED' || object.outgoing('contains').every(r => r.to.lifecycle == 'ARCHIVED' || r.to.lifecycle == 'PURGE')",
    rationale:
      "Archiving a parent while its contained children remain ACTIVE/DEPRECATED leaves orphan-like state: the children show up in OPERATIONAL views but their container does not, breaking traceability.",
    remediation:
      "Archive (or migrate) every contained child before archiving the parent, or restore the parent to DEPRECATED until children are dealt with.",
    propagation: "DOWNWARD",
  },
];
