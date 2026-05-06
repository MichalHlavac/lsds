// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { GuardrailRule } from "../types.js";

export const L5_L6_RULES: GuardrailRule[] = [
  {
    rule_id: "GR-L5-001",
    name: "TechnicalDebt must declare rationale",
    layer: "L5",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "TechnicalDebt",
      triggers: ["CREATE", "UPDATE"],
    },
    condition: "object.rationale != null && object.rationale.length > 0",
    rationale:
      "Debt without rationale is just a TODO; the catalog needs to know what trade-off was accepted to evaluate whether paying it down is still the right move.",
    remediation:
      "Document why the shortcut was taken, what was deferred, and what would justify keeping the debt vs paying it down now.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L5-002",
    name: "CodeModule must declare repository_reference",
    layer: "L5",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "CodeModule",
      triggers: ["CREATE", "UPDATE"],
    },
    condition: "object.repository_reference != null",
    rationale:
      "A code module the catalog can't point to in source control is unverifiable — the catalog and the code drift apart instantly.",
    remediation:
      "Set repository_reference to a stable RepoRef (org/repo + path or package coordinate).",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L5-003",
    name: "DOMAIN CodeModule depends on INFRASTRUCTURE module",
    layer: "L5",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "CodeModule",
      triggers: ["UPDATE", "PERIODIC"],
      relationship_type: "depends-on",
    },
    condition:
      "!(object.module_type == 'DOMAIN' && exists depends_on with target.module_type == 'INFRASTRUCTURE')",
    rationale:
      "Domain modules that import infrastructure invert the dependency rule of clean/hexagonal architecture and contaminate the model with frameworks and IO.",
    remediation:
      "Invert the dependency: define a port in the domain module and move the infrastructure adapter behind it.",
    propagation: "LATERAL",
  },
  {
    rule_id: "GR-L5-004",
    name: "ExternalDependency CRITICAL without security_audit_date",
    layer: "L5",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "ExternalDependency",
      triggers: ["CREATE", "UPDATE", "PERIODIC"],
    },
    condition:
      "object.criticality == 'CRITICAL' implies object.security_audit_date != null",
    rationale:
      "A critical third-party dependency with no recorded security review is the textbook supply-chain risk; CVE response and license compliance both depend on this signal.",
    remediation:
      "Run a security audit (license + CVE + provenance) and record security_audit_date. Re-audit at the cadence required by the security policy.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L5-005",
    name: "TechnicalDebt with HIGH interest OPEN > 90 days",
    layer: "L5",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "WARNING",
    scope: {
      object_type: "TechnicalDebt",
      triggers: ["PERIODIC"],
    },
    condition:
      "!(object.interest_rate == 'HIGH' && object.status == 'OPEN' && (now - object.created_at) > 90 days)",
    rationale:
      "High-interest debt compounds; left open beyond a quarter it almost always costs more than the original fix. Age is measured from TknBase.created_at (the catalog's universal creation timestamp).",
    remediation:
      "Either schedule the debt for repayment in the next sprint, downgrade the interest classification with rationale, or accept it via an explicit suppression.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L5-006",
    name: "CodeModule without validated-by Test",
    layer: "L5",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "WARNING",
    scope: {
      object_type: "CodeModule",
      triggers: ["UPDATE", "PERIODIC"],
      relationship_type: "validated-by",
    },
    condition:
      "object.relationships.filter(type='validated-by', target_type='Test').length >= 1",
    rationale:
      "A module with no linked tests has no executable specification; refactors and regressions both go undetected until production.",
    remediation:
      "Link the module to at least one Test (unit, integration, or contract) that covers its primary responsibility.",
    propagation: "LATERAL",
  },
  {
    rule_id: "GR-L5-007",
    name: "ExternalDependency with GPL license in COMMERCIAL context",
    layer: "L5",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "WARNING",
    scope: {
      object_type: "ExternalDependency",
      triggers: ["CREATE", "UPDATE", "PERIODIC"],
    },
    condition:
      "!(object.license matches 'GPL*' && config.distribution.context == 'COMMERCIAL')",
    rationale:
      "GPL-licensed dependencies in commercially distributed code raise copyleft obligations that are easy to violate and expensive to remediate after release.",
    remediation:
      "Replace with a permissively-licensed alternative, isolate the dependency behind a service boundary, or get explicit legal sign-off recorded as a suppression.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L6-001",
    name: "InfrastructureComponent must declare iac_reference",
    layer: "L6",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "InfrastructureComponent",
      triggers: ["CREATE", "UPDATE"],
    },
    condition: "object.iac_reference != null",
    rationale:
      "Infra not declared in IaC is invisible click-ops; reviews, blast-radius analysis, and rebuild after disaster all depend on the IaC link.",
    remediation:
      "Set iac_reference to the Terraform/Pulumi/Crossplane/Helm path (or equivalent) that creates and reconciles this component.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L6-002",
    name: "Alert must reference a Runbook",
    layer: "L6",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "Alert",
      triggers: ["CREATE", "UPDATE"],
    },
    condition: "object.runbook_reference != null",
    rationale:
      "An alert with no runbook is a 3am page nobody knows how to act on; alert pages without runbooks reliably produce wrong actions or no action.",
    remediation:
      "Link the alert to a Runbook with at least the diagnostic steps, mitigation, and escalation path. If no runbook exists, write one before enabling the alert.",
    propagation: "LATERAL",
  },
  {
    rule_id: "GR-L6-003",
    name: "P1 Runbook last_tested > 90 days",
    layer: "L6",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "Runbook",
      triggers: ["PERIODIC"],
    },
    condition:
      "!(object.severity == 'P1' && (now - object.last_tested) > 90 days)",
    rationale:
      "P1 runbooks rot quickly; one untested for over a quarter is statistically wrong, and you only find out during the incident.",
    remediation:
      "Run a tabletop or game-day exercise of the runbook, fix the steps that fail, and update last_tested.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L6-004",
    name: "Production Service without SLO",
    layer: "L6",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "Service",
      triggers: ["UPDATE", "PERIODIC"],
      relationship_type: "validates",
    },
    condition:
      "!(any(object.outgoing_relationships(type='deploys-to', target_type='DeploymentUnit').target.environment == 'PRODUCTION') && incoming_relationships(type='validates', source_type='SLO').length == 0)",
    rationale:
      "A production service with no SLO has no defensible expectation of availability or latency; ops can't size capacity, alerting, or on-call against nothing. Service has no direct environment attribute — production status is inferred via the canonical deploys-to → DeploymentUnit.environment edge (kap. 2.2). The SLO link is the canonical incoming `validates` edge from SLO (kap. 2.2), not a non-existent `has-slo` edge.",
    remediation:
      "Define at least one SLO (availability or latency) and link it to this service via SLO `validates` Service before keeping it in production.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L6-005",
    name: "SLO without traces-to QualityAttribute",
    layer: "L6",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "WARNING",
    scope: {
      object_type: "SLO",
      triggers: ["UPDATE", "PERIODIC"],
      relationship_type: "traces-to",
    },
    condition:
      "object.relationships.filter(type='traces-to', target_type='QualityAttribute').length >= 1",
    rationale:
      "An SLO not tied to a declared quality attribute is an arbitrary number; without the link, its target can't be reasoned about against architectural intent.",
    remediation:
      "Add a traces-to relationship from this SLO to the QualityAttribute it operationalises.",
    propagation: "UPWARD",
  },
  {
    rule_id: "GR-L6-006",
    name: "PRODUCTION/DR Environment must declare iac_reference",
    layer: "L6",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "Environment",
      triggers: ["CREATE", "UPDATE"],
    },
    condition:
      "object.environment_type in ['PRODUCTION', 'DR'] implies object.iac_reference != null",
    rationale:
      "PRODUCTION and DR environments are the recovery surface of the system; without an IaC reference there is no reproducible way to rebuild them, audit drift, or review changes — the environment becomes click-ops with hidden coupling.",
    remediation:
      "Set iac_reference to the Terraform/Pulumi/Crossplane/Helm path that defines and reconciles this environment. If the environment is genuinely not in IaC yet, file the migration first and keep the type at STAGING/PREVIEW until it is.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L6-007",
    name: "PRODUCTION/DR Environment must declare promotion_gate",
    layer: "L6",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "Environment",
      triggers: ["CREATE", "UPDATE"],
    },
    condition:
      "object.environment_type in ['PRODUCTION', 'DR'] implies object.promotion_gate != null",
    rationale:
      "Without an explicit promotion gate, deploys to PRODUCTION/DR happen on whatever ad-hoc rule the last engineer remembered; this is how unreviewed code reaches production. The gate names the checks (tests, approvals, signed artifacts) that must pass before promotion.",
    remediation:
      "Document promotion_gate explicitly: list the smoke tests, approvals, signed-artifact checks, or change-window rules a deploy must satisfy before it reaches this environment.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L6-008",
    name: "OnCallPolicy must cover ≥ 1 target and declare p1 SLA",
    layer: "L6",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "OnCallPolicy",
      triggers: ["CREATE", "UPDATE"],
      relationship_type: "covers",
    },
    condition:
      "object.relationships.filter(type='covers').length >= 1 && object.response_time_sla.p1 != null && escalation_levels_contiguous_from_one(object.escalation_levels)",
    rationale:
      "An on-call policy with no covered Service/DeploymentUnit is a paper rota that protects nothing; missing p1 SLA means there is no defensible response time for the most severe incidents; non-contiguous escalation_levels (skipped or duplicated levels) silently break the escalation chain so the secondary is never paged.",
    remediation:
      "Attach at least one covers edge from this OnCallPolicy to the Service or DeploymentUnit it protects, set response_time_sla.p1 to a duration the team will actually meet, and number escalation_levels 1..N contiguously.",
    propagation: "LATERAL",
  },
  {
    rule_id: "GR-L6-009",
    name: "Production Service without OnCallPolicy",
    layer: "L6",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "WARNING",
    scope: {
      object_type: "Service",
      triggers: ["UPDATE", "PERIODIC"],
      relationship_type: "covers",
    },
    condition:
      "!(any(object.outgoing_relationships(type='deploys-to', target_type='DeploymentUnit').target.environment == 'PRODUCTION') && incoming_relationships(type='covers', source_type='OnCallPolicy').length == 0)",
    rationale:
      "A production Service with no OnCallPolicy has no defined responder when it pages — incidents land in nobody's queue and resolution time degrades silently. Service has no direct environment attribute — production status is inferred via the canonical deploys-to → DeploymentUnit.environment edge (kap. 2.2), mirroring GR-L6-004; the policy link is the canonical incoming `covers` edge from OnCallPolicy. Surfaced as WARNING (not ERROR) so retired or sunsetting services can be flagged without blocking writes.",
    remediation:
      "Define or extend an OnCallPolicy and add a `covers` edge from it to this Service. If the service is intentionally unattended (lab, ephemeral), demote it out of PRODUCTION via deploys-to instead of suppressing the warning.",
    propagation: "NONE",
  },
];
