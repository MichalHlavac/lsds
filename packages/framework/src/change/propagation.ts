// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { ChangeDecision } from "./decide.js";
import { StaleFlag, StaleFlagSchema } from "./stale-flag.js";
import {
  ChangeSeverity,
  PropagationMode,
  StaleSeverity,
} from "./types.js";
import type { PropagationEdge } from "../guardrail/propagation.js";

// MINOR change events propagate over these relationship types only (kap. 2.7).
// MAJOR propagates over every relationship; PATCH does not propagate.
export const MINOR_PROPAGATING_RELATIONSHIPS = [
  "realizes",
  "implements",
  "traces-to",
] as const;
export type MinorPropagatingRelationship =
  (typeof MINOR_PROPAGATING_RELATIONSHIPS)[number];

export interface ChangePropagationPolicy {
  staleSeverity: StaleSeverity;
  mode: PropagationMode;
  selectedRelationships: ReadonlyArray<string>;
}

const POLICY_BY_SEVERITY: Record<ChangeSeverity, ChangePropagationPolicy> = {
  MAJOR: {
    staleSeverity: "ERROR",
    mode: "ALL_RELATIONSHIPS",
    selectedRelationships: [],
  },
  MINOR: {
    staleSeverity: "WARNING",
    mode: "SELECTED_RELATIONSHIPS",
    selectedRelationships: MINOR_PROPAGATING_RELATIONSHIPS,
  },
  PATCH: {
    staleSeverity: "INFO",
    mode: "DIRECT_PARENTS",
    selectedRelationships: [],
  },
};

export function propagationFor(severity: ChangeSeverity): ChangePropagationPolicy {
  return POLICY_BY_SEVERITY[severity];
}

// Whether a change of given severity propagates a stale flag to a neighbour
// reached via `relationshipType`. PATCH never propagates traversally — its INFO
// flag is raised on direct parents by a different mechanism, not by walking edges.
export function propagatesOver(
  severity: ChangeSeverity,
  relationshipType: string,
): boolean {
  const policy = POLICY_BY_SEVERITY[severity];
  switch (policy.mode) {
    case "ALL_RELATIONSHIPS":
      return true;
    case "SELECTED_RELATIONSHIPS":
      return policy.selectedRelationships.includes(relationshipType);
    case "DIRECT_PARENTS":
      return false;
  }
}

// ---------------------------------------------------------------------------
// propagateChange — change-event StaleFlag emitter (kap. 2.7)
// ---------------------------------------------------------------------------
//
// Symmetric counterpart to guardrail/propagation.ts::propagateViolation.
//
// Single-hop emission: given an APPLIED ChangeDecision and the edge list out
// of the changed object, returns a StaleFlag for each neighbour that should
// be flagged according to the propagation mode. Multi-hop traversal is the
// caller's responsibility (walk the graph and call propagateChange per layer
// of edges, tracking depth via `originDepth`).
//
// MAJOR  (ALL_RELATIONSHIPS)    — flag every neighbour, regardless of edge.
// MINOR  (SELECTED_RELATIONSHIPS) — flag only neighbours reached via
//                                  `realizes` / `implements` / `traces-to`.
// PATCH  (DIRECT_PARENTS)       — no traversal: flag only edges with
//                                  direction = UP, depth=1, and never recurse.

export interface ChangePropagationSource {
  /** ChangeEvent.id that originated the propagation (carried into every flag). */
  changeId: string;
  /** The object that was changed. */
  objectId: string;
  objectType: string;
  /** APPLIED ChangeDecision — supplies effective severity + propagation policy. */
  decision: ChangeDecision;
  /** ISO-8601 timestamp stamped on every emitted flag. */
  raisedAt: string;
}

export interface PropagateChangeOptions {
  /**
   * Builder for emitted StaleFlag ids. Defaults to a deterministic
   * `${changeId}::${edge.toObjectId}` so re-runs are idempotent. Persistence
   * layers typically override this with a UUID generator.
   */
  idGenerator?: (
    source: ChangePropagationSource,
    edge: PropagationEdge,
  ) => string;
  /**
   * Depth of `source` from the original change event. Defaults to 0 (the
   * source IS the original change). Multi-hop callers pass the current depth
   * so emitted flags carry `depth = originDepth + 1`.
   */
  originDepth?: number;
}

function shouldEmit(
  mode: PropagationMode,
  selected: ReadonlyArray<string>,
  edge: PropagationEdge,
): boolean {
  switch (mode) {
    case "ALL_RELATIONSHIPS":
      return true;
    case "SELECTED_RELATIONSHIPS":
      return selected.includes(edge.relationshipType);
    case "DIRECT_PARENTS":
      return edge.direction === "UP";
  }
}

export function propagateChange(
  source: ChangePropagationSource,
  edges: ReadonlyArray<PropagationEdge>,
  options: PropagateChangeOptions = {},
): StaleFlag[] {
  if (source.decision.status !== "APPLIED") {
    throw new Error(
      "propagateChange: decision.status must be APPLIED (PENDING_CONFIRMATION cannot propagate)",
    );
  }
  const { propagation } = source.decision;
  const idFor =
    options.idGenerator ??
    ((s, e) => `${s.changeId}::${e.toObjectId}`);
  const depth = (options.originDepth ?? 0) + 1;

  const seen = new Set<string>();
  const flags: StaleFlag[] = [];
  for (const edge of edges) {
    if (!shouldEmit(propagation.mode, propagation.selectedRelationships, edge)) {
      continue;
    }
    // Dedupe by neighbour identity — one flag per (objectId, objectType) per
    // propagateChange call, even if multiple edges reach the same target.
    const key = `${edge.toObjectType}:${edge.toObjectId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const flag: StaleFlag = {
      id: idFor(source, edge),
      sourceChangeId: source.changeId,
      objectId: edge.toObjectId,
      objectType: edge.toObjectType,
      severity: propagation.staleSeverity,
      raisedAt: source.raisedAt,
      message: `Stale due to ${source.decision.effectiveSeverity} change on ${source.objectType} ${source.objectId} (via ${edge.relationshipType})`,
      viaRelationshipType: edge.relationshipType,
      depth,
    };
    // Validate — emitted flags must satisfy the public schema.
    flags.push(StaleFlagSchema.parse(flag));
  }
  return flags;
}
