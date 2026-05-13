// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { GuardrailRule } from "../types.js";

export const L3_L4_RULES: GuardrailRule[] = [
  {
    rule_id: "GR-L3-001",
    name: "ArchitectureComponent must declare technology",
    layer: "L3",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "ArchitectureComponent",
      triggers: ["CREATE", "UPDATE"],
    },
    condition: "object.technology != null && object.technology.length > 0",
    rationale:
      "Components without a declared technology cannot be reasoned about for cost, ops, security review, or fitness against quality attributes.",
    remediation:
      "Set the technology field (e.g. 'PostgreSQL 16', 'Node.js 20', 'Kafka 3.x', 'AWS Lambda').",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L3-002",
    name: "ADR must list ≥ 1 alternatives_considered",
    layer: "L3",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "ADR",
      triggers: ["CREATE", "UPDATE"],
    },
    condition: "object.alternatives_considered.length >= 1",
    rationale:
      "An ADR with no alternatives is a press release, not a decision; future readers can't see what was rejected and why, so the decision can't be re-evaluated.",
    remediation:
      "Document at least one alternative considered — even 'do nothing' is a real alternative — with the reason it was rejected.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L3-003",
    name: "SUPERSEDED ADR must declare a supersedes relationship",
    layer: "L3",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "ADR",
      triggers: ["UPDATE"],
      relationship_type: "supersedes",
    },
    condition:
      "object.status == 'SUPERSEDED' implies object.relationships.filter(type='supersedes').length >= 1",
    rationale:
      "A superseded ADR with no link to its successor breaks the decision audit trail and leaves readers unsure what is currently in force.",
    remediation:
      "Either set the supersedes relationship to the ADR that replaces this one, or move this ADR back to ACCEPTED.",
    propagation: "LATERAL",
  },
  {
    rule_id: "GR-L3-004",
    name: "ExternalSystem CRITICAL without fallback_strategy",
    layer: "L3",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "ExternalSystem",
      triggers: ["CREATE", "UPDATE"],
    },
    condition:
      "object.criticality == 'CRITICAL' implies object.fallback_strategy != null",
    rationale:
      "An external system on the critical path with no documented fallback is a single point of failure no one has thought through; outages turn into improvisation.",
    remediation:
      "Document the fallback_strategy: degraded mode, cache, secondary provider, or queued retry — even an explicit 'no fallback, alert and stop' counts.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L3-005",
    name: "ExternalSystem CRITICAL/HIGH without sla_reference",
    layer: "L3",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "ExternalSystem",
      triggers: ["CREATE", "UPDATE"],
    },
    condition:
      "object.criticality in ['CRITICAL', 'HIGH'] implies object.sla_reference != null",
    rationale:
      "Without an SLA reference, ops can't size alerts, error budgets, or escalation paths against the dependency's actual guarantees.",
    remediation:
      "Add sla_reference linking to the vendor SLA, internal contract, or dashboard that captures the dependency's availability and latency commitments.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L3-006",
    name: "ArchitectureComponent without traces-to BoundedContext",
    layer: "L3",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "WARNING",
    scope: {
      object_type: "ArchitectureComponent",
      triggers: ["UPDATE", "PERIODIC"],
      relationship_type: "traces-to",
    },
    condition:
      "object.relationships.filter(type='traces-to', target_type='BoundedContext').length >= 1",
    rationale:
      "Architecture components that do not trace to a domain BoundedContext usually accrete in the integration layer and lose alignment with the model.",
    remediation:
      "Add a traces-to from this component to the BoundedContext it serves; if the component is purely cross-cutting, classify it as such explicitly.",
    propagation: "UPWARD",
  },
  {
    rule_id: "GR-L3-007",
    name: "Cyclic depends-on between ArchitectureComponents",
    layer: "L3",
    origin: "STRUCTURAL",
    evaluation: "DESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "ArchitectureComponent",
      triggers: ["PERIODIC", "UPDATE"],
      relationship_type: "depends-on",
    },
    condition: "no_cycle_in(ArchitectureComponent, relationship='depends-on')",
    rationale:
      "Cyclic component dependencies break deployment ordering, complicate rollback, and almost always hide a missing abstraction.",
    remediation:
      "Break the cycle: extract a shared kernel, invert one dependency via interface ownership, or merge the components if they form a single unit.",
    propagation: "LATERAL",
  },
  {
    rule_id: "GR-L3-008",
    name: "ArchitectureSystem without QualityAttribute",
    layer: "L3",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "WARNING",
    scope: {
      object_type: "ArchitectureSystem",
      triggers: ["CREATE", "UPDATE", "PERIODIC"],
    },
    condition: "object.quality_attributes.length >= 1",
    rationale:
      "A system that doesn't declare any quality attributes can't be evaluated for fitness; ops, perf, and security review have nothing to test against.",
    remediation:
      "Attach at least one QualityAttribute (availability, latency, security, scalability) the system is designed to satisfy.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L3-009",
    name: "ExternalSystem review older than 6 months",
    layer: "L3",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "WARNING",
    scope: {
      object_type: "ExternalSystem",
      triggers: ["PERIODIC"],
    },
    condition: "(now - object.last_review_date) <= 180 days",
    rationale:
      "External vendors change pricing, SLA, and security posture; an unrefreshed review is operating on stale assumptions.",
    remediation:
      "Run a vendor review: re-validate criticality, fallback, SLA, and security audit, then update last_review_date.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L4-001",
    name: "APIEndpoint must declare ≥ 1 error_response",
    layer: "L4",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "APIEndpoint",
      triggers: ["CREATE", "UPDATE"],
    },
    condition: "object.error_responses.length >= 1",
    rationale:
      "Endpoints that document only the happy path leave clients to guess error contracts; explicit error responses are part of the API surface, not an afterthought.",
    remediation:
      "Document at least one error response (status code + payload schema) — typically 4xx for client validation and 5xx for upstream failure.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L4-002",
    name: "APIEndpoint must declare response_schema",
    layer: "L4",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "APIEndpoint",
      triggers: ["CREATE", "UPDATE"],
    },
    condition: "object.response_schema != null",
    rationale:
      "Without a response schema there is no contract; SDK generation, mocks, and consumer tests all collapse and the endpoint becomes effectively private.",
    remediation:
      "Attach a response_schema (DataContract, OpenAPI/JSON Schema reference, or inline schema) covering the success payload.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L4-003",
    name: "EventContract must declare ordering and delivery guarantees",
    layer: "L4",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "EventContract",
      triggers: ["CREATE", "UPDATE"],
    },
    condition:
      "object.ordering_guarantee != null && object.delivery_guarantee != null",
    rationale:
      "Subscribers must know whether to expect at-least-once vs exactly-once and per-key vs global ordering; missing this turns subtle race bugs into production incidents.",
    remediation:
      "Set ordering_guarantee (NONE/PER_KEY/GLOBAL) and delivery_guarantee (AT_MOST_ONCE/AT_LEAST_ONCE/EXACTLY_ONCE) explicitly.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L4-004",
    name: "APIContract must declare version",
    layer: "L4",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "APIContract",
      triggers: ["CREATE", "UPDATE"],
    },
    condition: "object.version != null && is_semver(object.version)",
    rationale:
      "An unversioned API contract makes change classification (MAJOR/MINOR/PATCH) impossible and invalidates any compatibility promise.",
    remediation:
      "Set version to a SemVer string (e.g. '1.0.0'); bump it according to layer policy on every published change.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L4-005",
    name: "Service without realizes link to ArchitectureComponent",
    layer: "L4",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "WARNING",
    scope: {
      object_type: "Service",
      triggers: ["UPDATE", "PERIODIC"],
      relationship_type: "realizes",
    },
    condition:
      "object.relationships.filter(type='realizes', target_type='ArchitectureComponent').length >= 1",
    rationale:
      "Services that don't realise any L3 component drift into shadow architecture; the architectural picture and the running system diverge silently.",
    remediation:
      "Add a realizes relationship from this Service to the ArchitectureComponent that describes its role; if no component fits, define one first.",
    propagation: "UPWARD",
  },
  {
    rule_id: "GR-L4-006",
    name: "DEPRECATED APIEndpoint without sunset timeline",
    layer: "L4",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "WARNING",
    scope: {
      object_type: "APIEndpoint",
      triggers: ["UPDATE", "PERIODIC"],
    },
    condition:
      "object.status == 'DEPRECATED' implies object.sunset_at != null",
    rationale:
      "Deprecation without a sunset date is permanent deprecation; consumers have no signal to migrate and the deprecated surface stays forever. APIEndpoint tracks deprecation via its per-object status field (kap. 4 § L4 / APIEndpoint), distinct from the universal lifecycle.",
    remediation:
      "Set sunset_at to the date the endpoint will be removed; communicate it through the deprecation channel for this API.",
    propagation: "NONE",
  },
  {
    rule_id: "GR-L4-007",
    name: "Service with > N direct dependencies (god service)",
    layer: "L4",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "WARNING",
    scope: {
      object_type: "Service",
      triggers: ["PERIODIC", "UPDATE"],
      relationship_type: "depends-on",
    },
    condition:
      "object.relationships.filter(type='depends-on').length <= config.l4.max_service_dependencies",
    rationale:
      "A service with too many direct dependencies becomes the integration hub; deploys ripple, blast radius grows, and the service is no longer cohesive.",
    remediation:
      "Decompose responsibilities, introduce an aggregator/BFF, or move shared interactions behind events to bring direct dependencies under the threshold.",
    propagation: "LATERAL",
  },
];
