// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

// Relationship Registry — all 19 typed edges from kap. 2.2 of the LSDS research.
//
// Per kap. 2.2 every relationship has: type, semantic direction, cardinality,
// traversal weight (EAGER/LAZY, kap. 2.10) and propagation policy (kap. 2.5).
// The registry is the framework SSOT for these rules. Layer ordinals are
// L1=1 (most abstract) … L6=6 (most concrete).
//
// The two propagation policies that ship hard-wired in kap. 2.5 are:
//   UPWARD   — propagates over `part-of` and `traces-to`
//   DOWNWARD — propagates over `contains` and `realizes`
// Other types are conservatively assigned NONE here; downstream semantic
// guardrails may extend that without changing the structural definition.

import type { LayerId } from "../layer/index.js";
import type { RelationshipDefinition, RelationshipType } from "./types.js";
import { RelationshipDefinitionSchema } from "./types.js";

const ALL_LAYERS: ReadonlyArray<LayerId> = ["L1", "L2", "L3", "L4", "L5", "L6"];
const L1_TO_L4: ReadonlyArray<LayerId> = ["L1", "L2", "L3", "L4"];
const L2_TO_L6: ReadonlyArray<LayerId> = ["L2", "L3", "L4", "L5", "L6"];

const RAW_DEFINITIONS: ReadonlyArray<RelationshipDefinition> = [
  // ── Realization ────────────────────────────────────────────────────────────
  {
    type: "realizes",
    category: "REALIZATION",
    direction: "downward",
    cardinality: "M:N",
    traversalWeight: "EAGER",
    propagationPolicy: "DOWNWARD",
    layerRules: {
      allowedSourceLayers: ALL_LAYERS,
      allowedTargetLayers: L1_TO_L4,
      layerOrdinalConstraint: "SOURCE_GTE_TARGET",
      targetIsExternal: false,
    },
    semantics: "Source realizuje abstrakci Target (concrete → abstract).",
    rationale:
      "Kap. 2.2: realization edges run from a concrete realizer to a more abstract definition. " +
      "Examples: Service(L4) realizes ArchitectureComponent(L3); CodeModule(L5) realizes DomainEntity(L2). " +
      "Violations on the abstract side cascade DOWNWARD to every realization.",
  },
  {
    type: "implements",
    category: "REALIZATION",
    direction: "downward",
    cardinality: "M:N",
    traversalWeight: "EAGER",
    propagationPolicy: "DOWNWARD",
    layerRules: {
      allowedSourceLayers: ["L4", "L5"],
      allowedTargetLayers: ["L4"],
      layerOrdinalConstraint: "SOURCE_GTE_TARGET",
      targetIsExternal: false,
    },
    semantics: "Source implementuje interface/kontrakt Target.",
    rationale:
      "Kap. 4 (L5 CodeModule.implements → APIContract / EventContract): a code module is the implementation " +
      "of a contract defined at L4. Contract-level violations must reach every implementor — DOWNWARD propagation.",
  },
  // ── Composition ────────────────────────────────────────────────────────────
  {
    type: "contains",
    category: "COMPOSITION",
    direction: "downward",
    cardinality: "1:N",
    traversalWeight: "EAGER",
    propagationPolicy: "DOWNWARD",
    layerRules: {
      allowedSourceLayers: ALL_LAYERS,
      allowedTargetLayers: ALL_LAYERS,
      layerOrdinalConstraint: "SOURCE_LTE_TARGET",
      targetIsExternal: false,
    },
    semantics: "Source je složen z Target (parent → part).",
    rationale:
      "Kap. 2.5 explicitly names `contains` as a DOWNWARD-propagating composition edge. Same-layer composition " +
      "(BoundedContext contains DomainEntity) is the common case; cross-layer descent (Component(L3) contains Service(L4)) " +
      "is also allowed.",
  },
  {
    type: "part-of",
    category: "COMPOSITION",
    direction: "upward",
    cardinality: "N:1",
    traversalWeight: "EAGER",
    propagationPolicy: "UPWARD",
    layerRules: {
      allowedSourceLayers: ALL_LAYERS,
      allowedTargetLayers: ALL_LAYERS,
      layerOrdinalConstraint: "SOURCE_GTE_TARGET",
      targetIsExternal: false,
    },
    semantics: "Source je součástí Target (part → whole).",
    rationale:
      "Inverse of `contains`. Kap. 2.5 names it as an UPWARD-propagating edge — a violation in the part bubbles to " +
      "the enclosing whole.",
  },
  // ── Dependency ─────────────────────────────────────────────────────────────
  {
    type: "depends-on",
    category: "DEPENDENCY",
    direction: "lateral",
    cardinality: "M:N",
    traversalWeight: "EAGER",
    propagationPolicy: "NONE",
    layerRules: {
      allowedSourceLayers: ALL_LAYERS,
      allowedTargetLayers: ALL_LAYERS,
      layerOrdinalConstraint: "SOURCE_LTE_TARGET",
      targetIsExternal: false,
    },
    semantics: "Source runtime závisí na Target.",
    rationale:
      "Kap. 2.2 lists depends-on as lateral/downward and EAGER. It is the runtime contract between siblings or " +
      "a higher-layer abstraction depending on a lower-layer detail. We keep propagationPolicy=NONE at the structural " +
      "level — staleness/impact propagation over deps is a semantic-guardrail concern (kap. 2.7 change events).",
  },
  {
    type: "uses",
    category: "DEPENDENCY",
    direction: "lateral",
    cardinality: "M:N",
    traversalWeight: "LAZY",
    propagationPolicy: "NONE",
    layerRules: {
      allowedSourceLayers: ALL_LAYERS,
      allowedTargetLayers: ALL_LAYERS,
      layerOrdinalConstraint: "ANY",
      targetIsExternal: false,
    },
    semantics: "Source využívá schopnost Target (loose coupling).",
    rationale:
      "Lazy lateral dependency. Used to express \"this BusinessProcess uses another BusinessProcess\" or similar. " +
      "Excluded from OPERATIONAL traversal because it is contextual rather than executable.",
  },
  {
    type: "calls",
    category: "DEPENDENCY",
    direction: "lateral",
    cardinality: "M:N",
    traversalWeight: "LAZY",
    propagationPolicy: "NONE",
    layerRules: {
      allowedSourceLayers: ["L4", "L5"],
      allowedTargetLayers: ["L4"],
      layerOrdinalConstraint: "SOURCE_GTE_TARGET",
      targetIsExternal: false,
    },
    semantics: "Source volá rozhraní Target (request/response).",
    rationale:
      "Concrete call relation between Application/Implementation tier and an APIEndpoint/Contract. LAZY because the " +
      "static call graph is a derivable, operationally noisy fact best surfaced in ANALYTICAL profile.",
  },
  // ── Integration ────────────────────────────────────────────────────────────
  {
    type: "context-integration",
    category: "INTEGRATION",
    direction: "lateral",
    cardinality: "M:N",
    traversalWeight: "EAGER",
    propagationPolicy: "BOTH",
    layerRules: {
      allowedSourceLayers: ["L2"],
      allowedTargetLayers: ["L2"],
      layerOrdinalConstraint: "EQUAL",
      targetIsExternal: false,
    },
    semantics: "Integrace mezi BoundedContexts (context map edge).",
    rationale:
      "Kap. 2.2 + A7: integration patterns are encoded as a strict L2↔L2 edge with enum-backed pattern at the " +
      "L4 contract level. EAGER + BOTH propagation: a violation on either side affects the integration partner.",
  },
  // ── Evolution ──────────────────────────────────────────────────────────────
  {
    type: "supersedes",
    category: "EVOLUTION",
    direction: "lateral",
    cardinality: "1:1",
    traversalWeight: "LAZY",
    propagationPolicy: "NONE",
    layerRules: {
      allowedSourceLayers: ALL_LAYERS,
      allowedTargetLayers: ALL_LAYERS,
      layerOrdinalConstraint: "EQUAL",
      targetIsExternal: false,
    },
    semantics: "Source nahrazuje Target (replacement).",
    rationale:
      "Kap. 4 calls this out for ADR (SUPERSEDED → new ADR) and Requirement (OBSOLETE supersedes new). " +
      "Same-layer 1:1 — at most one immediate predecessor. LAZY: only relevant for analytical/compliance views.",
  },
  // ── Traceability ───────────────────────────────────────────────────────────
  {
    type: "traces-to",
    category: "TRACEABILITY",
    direction: "vertical",
    cardinality: "M:N",
    traversalWeight: "EAGER",
    propagationPolicy: "UPWARD",
    layerRules: {
      allowedSourceLayers: ALL_LAYERS,
      allowedTargetLayers: ALL_LAYERS,
      layerOrdinalConstraint: "SOURCE_GTE_TARGET",
      targetIsExternal: false,
    },
    semantics: "Source je traceable k Target (concrete → motivating abstraction).",
    rationale:
      "Kap. 2.5 names `traces-to` as the canonical UPWARD propagation edge (BoundedContext → BusinessCapability, " +
      "SLO → QualityAttribute). EAGER because traceability must always be queryable in the OPERATIONAL profile.",
  },
  {
    type: "validated-by",
    category: "TRACEABILITY",
    direction: "downward",
    cardinality: "M:N",
    traversalWeight: "LAZY",
    propagationPolicy: "NONE",
    layerRules: {
      allowedSourceLayers: ALL_LAYERS,
      allowedTargetLayers: ["L5", "L6"],
      layerOrdinalConstraint: "SOURCE_LTE_TARGET",
      targetIsExternal: false,
    },
    semantics: "Source je validován Target (Test nebo SLO).",
    rationale:
      "Acceptance criteria, requirements, and quality attributes link DOWNWARD to a concrete Test (L5) or SLO (L6) " +
      "that proves them. LAZY — surfaced in ANALYTICAL/FULL traversal alongside coverage analysis.",
  },
  // ── Ownership ──────────────────────────────────────────────────────────────
  {
    type: "owned-by",
    category: "OWNERSHIP",
    direction: "cross-layer",
    cardinality: "N:1",
    traversalWeight: "EAGER",
    propagationPolicy: "NONE",
    layerRules: {
      allowedSourceLayers: ALL_LAYERS,
      allowedTargetLayers: [],
      layerOrdinalConstraint: "ANY",
      targetIsExternal: true,
    },
    semantics: "Source je vlastněn Target Team (TKN → Team).",
    rationale:
      "Kap. 2.6: ownership is mandatory and team-scoped. Target is an external Team reference (`TeamRef`), not a " +
      "TKN — `targetIsExternal=true`. EAGER so every traversal carries owner context for review/notification routing. " +
      "NONE propagation: ownership does not cascade structural violations.",
  },
  // ── Operations ─────────────────────────────────────────────────────────────
  {
    type: "deploys-to",
    category: "OPERATIONS",
    direction: "downward",
    cardinality: "M:N",
    traversalWeight: "LAZY",
    propagationPolicy: "NONE",
    layerRules: {
      allowedSourceLayers: ["L4", "L5"],
      allowedTargetLayers: ["L6"],
      layerOrdinalConstraint: "SOURCE_LT_TARGET",
      targetIsExternal: false,
    },
    semantics: "Source (DeploymentUnit / Service) nasazený na Target (Environment / InfrastructureComponent).",
    rationale:
      "Operations tier coupling: connects Application/Implementation artifacts to L6 runtime topology. LAZY because " +
      "deployment topology is high-volume and best loaded under ANALYTICAL/FULL profiles.",
  },
  // ── Decision ───────────────────────────────────────────────────────────────
  {
    type: "decided-by",
    category: "DECISION",
    direction: "any",
    cardinality: "M:N",
    traversalWeight: "LAZY",
    propagationPolicy: "NONE",
    layerRules: {
      allowedSourceLayers: ALL_LAYERS,
      allowedTargetLayers: ["L3"],
      layerOrdinalConstraint: "ANY",
      targetIsExternal: false,
    },
    semantics: "Source byl rozhodnut skrze Target ADR.",
    rationale:
      "Any TKN can point to the ADR that decided its existence/shape. Target is fixed at L3 (ADR lives there per kap. 4). " +
      "LAZY: ADR context enriches but doesn't drive operational queries.",
  },
  // ── Violation ──────────────────────────────────────────────────────────────
  {
    type: "violates",
    category: "VIOLATION",
    direction: "any",
    cardinality: "M:N",
    traversalWeight: "EAGER",
    propagationPolicy: "NONE",
    layerRules: {
      allowedSourceLayers: ALL_LAYERS,
      allowedTargetLayers: ALL_LAYERS,
      layerOrdinalConstraint: "ANY",
      targetIsExternal: false,
    },
    semantics: "Source porušuje constraint Target (rule, principle, ADR, contract).",
    rationale:
      "The edge that backs the Violation TKN (kap. 2.5). EAGER because open violations must surface in every profile. " +
      "Propagation is NONE on the edge itself — the *Violation* propagates separately per its referenced rule's policy.",
  },
  // ── Motivation ─────────────────────────────────────────────────────────────
  {
    type: "motivated-by",
    category: "MOTIVATION",
    direction: "vertical",
    cardinality: "M:N",
    traversalWeight: "LAZY",
    propagationPolicy: "NONE",
    layerRules: {
      allowedSourceLayers: L2_TO_L6,
      allowedTargetLayers: ["L1"],
      layerOrdinalConstraint: "SOURCE_GT_TARGET",
      targetIsExternal: false,
    },
    semantics: "Source byl motivován Target Requirement.",
    rationale:
      "Kap. 4 (Requirement.motivated-by ← L2+ objects): downstream artifacts point back to the L1 Requirement that " +
      "drove their creation. LAZY — motivation is part of ANALYTICAL/FULL context, not OPERATIONAL hot path.",
  },
  // ── Impact ─────────────────────────────────────────────────────────────────
  {
    type: "impacts",
    category: "IMPACT",
    direction: "downward",
    cardinality: "M:N",
    traversalWeight: "LAZY",
    propagationPolicy: "DOWNWARD",
    layerRules: {
      allowedSourceLayers: ["L1"],
      allowedTargetLayers: L2_TO_L6,
      layerOrdinalConstraint: "SOURCE_LT_TARGET",
      targetIsExternal: false,
    },
    semantics: "Requirement deklaruje dopad na Target (CREATE / MODIFY / EXTEND / DEPRECATE).",
    rationale:
      "Kap. 4 + A5: Requirement.impacts is the explicit declaration of \"to-be\" state. Source is always L1 Requirement; " +
      "targets span L2-L6 implementation surface. DOWNWARD propagation so an impacted target inherits the requirement's " +
      "in-flight state until the change ships.",
  },
  // ── Event flow ─────────────────────────────────────────────────────────────
  {
    type: "publishes",
    category: "EVENT_FLOW",
    direction: "lateral",
    cardinality: "M:N",
    traversalWeight: "EAGER",
    propagationPolicy: "NONE",
    layerRules: {
      allowedSourceLayers: ["L4"],
      allowedTargetLayers: ["L4"],
      layerOrdinalConstraint: "EQUAL",
      targetIsExternal: false,
    },
    semantics: "Source (Service) publikuje Target EventContract.",
    rationale:
      "Kap. 4 (L4 Service.publishes → EventContract). Same-layer L4↔L4 edge. EAGER because event topology is part of the " +
      "operational picture. Propagation NONE — event-flow violations are detected via paired publishes/consumes guardrails.",
  },
  {
    type: "consumes",
    category: "EVENT_FLOW",
    direction: "lateral",
    cardinality: "M:N",
    traversalWeight: "EAGER",
    propagationPolicy: "NONE",
    layerRules: {
      allowedSourceLayers: ["L2", "L4"],
      allowedTargetLayers: ["L2", "L4"],
      layerOrdinalConstraint: "EQUAL",
      targetIsExternal: false,
    },
    semantics: "Source konzumuje Target event (Service nebo BoundedContext).",
    rationale:
      "Kap. 4 surfaces consumes both at L4 (Service.consumes → EventContract) and at L2 (DomainEvent.consumes → BoundedContextRef). " +
      "Same-layer edge in either tier; cross-tier flow is mediated through `realizes` between L2 DomainEvent and L4 EventContract.",
  },
];

// Validate every definition through the schema at module load — catches drift early.
export const RELATIONSHIP_DEFINITIONS: ReadonlyArray<RelationshipDefinition> = Object.freeze(
  RAW_DEFINITIONS.map((def) => RelationshipDefinitionSchema.parse(def)),
);

const DEFINITIONS_BY_TYPE: ReadonlyMap<RelationshipType, RelationshipDefinition> = new Map(
  RELATIONSHIP_DEFINITIONS.map((def) => [def.type, def] as const),
);

export function getRelationshipDefinition(type: RelationshipType): RelationshipDefinition {
  const def = DEFINITIONS_BY_TYPE.get(type);
  if (!def) throw new Error(`unknown relationship type: ${type}`);
  return def;
}

export function listRelationshipDefinitions(): ReadonlyArray<RelationshipDefinition> {
  return RELATIONSHIP_DEFINITIONS;
}
