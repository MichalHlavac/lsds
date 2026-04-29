import type { GuardrailRule } from "./types";

const L1_RULES: GuardrailRule[] = [
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
      "object.lifecycle == 'ACTIVE' && (now - object.last_review_date) > 180 days",
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
    condition: "object.status == 'APPROVED' && object.impacts.length == 0",
    rationale:
      "An APPROVED requirement with no declared impact list cannot drive change propagation analysis and gives the implementer no map of what to touch.",
    remediation:
      "Add the expected impacts (CREATE/MODIFY/DEPRECATE on which objects) before moving from APPROVED to IN_PROGRESS.",
    propagation: "NONE",
  },
];

const L2_RULES: GuardrailRule[] = [
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

const L3_RULES: GuardrailRule[] = [
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
    condition:
      "object.relationships.filter(type='satisfies', target_type='QualityAttribute').length >= 1",
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
    condition: "(now - object.last_review_date) > 180 days",
    rationale:
      "External vendors change pricing, SLA, and security posture; an unrefreshed review is operating on stale assumptions.",
    remediation:
      "Run a vendor review: re-validate criticality, fallback, SLA, and security audit, then update last_review_date.",
    propagation: "NONE",
  },
];

const L4_RULES: GuardrailRule[] = [
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

const L5_RULES: GuardrailRule[] = [
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
    name: "Module must declare repository_reference",
    layer: "L5",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "Module",
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
    name: "DOMAIN Module depends on INFRASTRUCTURE module",
    layer: "L5",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "Module",
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
    name: "Module without validated-by Test",
    layer: "L5",
    origin: "SEMANTIC",
    evaluation: "DESCRIPTIVE",
    severity: "WARNING",
    scope: {
      object_type: "Module",
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
];

const L6_RULES: GuardrailRule[] = [
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
      relationship_type: "runbook_reference",
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
      "!(object.priority == 'P1' && (now - object.last_tested_at) > 90 days)",
    rationale:
      "P1 runbooks rot quickly; one untested for over a quarter is statistically wrong, and you only find out during the incident.",
    remediation:
      "Run a tabletop or game-day exercise of the runbook, fix the steps that fail, and update last_tested_at.",
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
];

const XL_RULES: GuardrailRule[] = [
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
    propagation: "DOWNWARD",
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
    propagation: "DOWNWARD",
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
    rule_id: "GR-XL-009",
    name: "DEPRECATED object still has active depends-on relationships",
    layer: "XL",
    origin: "STRUCTURAL",
    evaluation: "DESCRIPTIVE",
    severity: "WARNING",
    scope: {
      object_type: "*",
      triggers: ["UPDATE", "PERIODIC"],
      relationship_type: "depends-on",
    },
    condition:
      "object.lifecycle != 'DEPRECATED' || object.incoming('depends-on').every(r => r.from.lifecycle != 'ACTIVE')",
    rationale:
      "Once an object is marked DEPRECATED its callers should be migrated; lingering ACTIVE callers signal that deprecation has stalled and the planned removal will break consumers.",
    remediation:
      "Either migrate the remaining ACTIVE consumers off this object, or revert the lifecycle to ACTIVE if deprecation was premature.",
    propagation: "UPWARD",
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
  {
    rule_id: "GR-XL-011",
    name: "Hard delete blocked while incoming relationships exist",
    layer: "XL",
    origin: "STRUCTURAL",
    evaluation: "PRESCRIPTIVE",
    severity: "ERROR",
    scope: {
      object_type: "*",
      triggers: ["DELETE"],
    },
    condition: "object.incoming_relationships.length == 0",
    rationale:
      "Skipping the lifecycle (ACTIVE → DEPRECATED → ARCHIVED → PURGE) while incoming references exist silently breaks the graph; consumers and audit trails point at a nonexistent object.",
    remediation:
      "Move the object through DEPRECATED → ARCHIVED first so consumers can migrate; only the PURGE retention job is allowed to physically delete.",
    propagation: "UPWARD",
  },
];

export const GUARDRAIL_CATALOG: ReadonlyArray<GuardrailRule> = Object.freeze([
  ...L1_RULES,
  ...L2_RULES,
  ...L3_RULES,
  ...L4_RULES,
  ...L5_RULES,
  ...L6_RULES,
  ...XL_RULES,
]);
