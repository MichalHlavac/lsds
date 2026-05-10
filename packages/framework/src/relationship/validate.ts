// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { LayerId } from "../layer/index.js";
import type {
  EdgeValidationIssue,
  RelationshipCardinality,
  RelationshipEdge,
  RelationshipType,
} from "./types.js";
import { checkOrdinalConstraint } from "./types.js";
import { getRelationshipDefinition } from "./registry.js";
import { RELATIONSHIP_TYPES } from "./types.js";

const KNOWN_TYPES = new Set<string>(RELATIONSHIP_TYPES);

export interface EdgeCheck {
  type: RelationshipType | string;
  sourceLayer: LayerId;
  targetLayer: LayerId | null; // null when target is external (e.g. owned-by Team)
}

export function validateRelationshipEdge(edge: EdgeCheck): EdgeValidationIssue[] {
  const issues: EdgeValidationIssue[] = [];
  if (!KNOWN_TYPES.has(edge.type)) {
    issues.push({
      code: "UNKNOWN_TYPE",
      message: `relationship type '${edge.type}' is not registered`,
    });
    return issues;
  }
  const def = getRelationshipDefinition(edge.type as RelationshipType);
  const { layerRules } = def;

  if (!layerRules.allowedSourceLayers.includes(edge.sourceLayer)) {
    issues.push({
      code: "SOURCE_LAYER_NOT_ALLOWED",
      message:
        `source layer ${edge.sourceLayer} not allowed for ${def.type}; ` +
        `allowed: [${layerRules.allowedSourceLayers.join(", ")}]`,
    });
  }

  if (layerRules.targetIsExternal) {
    if (edge.targetLayer !== null) {
      issues.push({
        code: "TARGET_EXTERNAL_REQUIRED",
        message: `${def.type} expects an external target (no layer); got layer ${edge.targetLayer}`,
      });
    }
    return issues;
  }

  if (edge.targetLayer === null) {
    issues.push({
      code: "TARGET_LAYER_NOT_ALLOWED",
      message: `${def.type} expects a TKN target with a layer, got null`,
    });
    return issues;
  }

  if (!layerRules.allowedTargetLayers.includes(edge.targetLayer)) {
    issues.push({
      code: "TARGET_LAYER_NOT_ALLOWED",
      message:
        `target layer ${edge.targetLayer} not allowed for ${def.type}; ` +
        `allowed: [${layerRules.allowedTargetLayers.join(", ")}]`,
    });
  }

  if (
    issues.length === 0 &&
    !checkOrdinalConstraint(edge.sourceLayer, edge.targetLayer, layerRules.layerOrdinalConstraint)
  ) {
    issues.push({
      code: "ORDINAL_CONSTRAINT_VIOLATED",
      message:
        `${def.type}: ${edge.sourceLayer} → ${edge.targetLayer} violates ordinal constraint ` +
        `${layerRules.layerOrdinalConstraint}`,
    });
  }

  return issues;
}

export function isEdgeValid(edge: RelationshipEdge | EdgeCheck): boolean {
  return validateRelationshipEdge(edge as EdgeCheck).length === 0;
}

// Graph-level cardinality enforcement per kap. 2.2:
//   1:1 → at most one outgoing per (source, type) AND one incoming per (target, type)
//   N:1 → at most one outgoing per (source, type)
//   1:N → at most one incoming per (target, type)
//   M:N → unbounded (skipped)
//
// The single-edge validator can never see this kind of violation because each
// edge is locally valid; it only emerges when the full edge set is considered.
// Unknown relationship types are skipped here — `validateRelationshipEdge`
// already surfaces them as UNKNOWN_TYPE on the per-edge path. Duplicate edges
// (same source, target, type) are counted as separate occurrences and therefore
// trip the same cardinality rules as distinct overflow edges.
export function validateGraphCardinality(edges: ReadonlyArray<RelationshipEdge>): EdgeValidationIssue[] {
  const issues: EdgeValidationIssue[] = [];

  // Bucket: type → source TKN id → target TKN ids ;  type → target TKN id → source TKN ids.
  const outgoing = new Map<RelationshipType, Map<string, string[]>>();
  const incoming = new Map<RelationshipType, Map<string, string[]>>();

  for (const edge of edges) {
    if (!KNOWN_TYPES.has(edge.type)) continue;
    const type = edge.type as RelationshipType;

    let bySource = outgoing.get(type);
    if (!bySource) {
      bySource = new Map();
      outgoing.set(type, bySource);
    }
    const outTargets = bySource.get(edge.sourceTknId) ?? [];
    outTargets.push(edge.targetTknId);
    bySource.set(edge.sourceTknId, outTargets);

    let byTarget = incoming.get(type);
    if (!byTarget) {
      byTarget = new Map();
      incoming.set(type, byTarget);
    }
    const inSources = byTarget.get(edge.targetTknId) ?? [];
    inSources.push(edge.sourceTknId);
    byTarget.set(edge.targetTknId, inSources);
  }

  for (const [type, bySource] of outgoing) {
    const cardinality = getRelationshipDefinition(type).cardinality;
    if (!enforcesOutgoingLimit(cardinality)) continue;
    for (const [sourceId, targets] of bySource) {
      if (targets.length > 1) {
        issues.push({
          code: "CARDINALITY_VIOLATED",
          message:
            `${type} (${cardinality}): source '${sourceId}' has ${targets.length} outgoing edges ` +
            `(allowed: 1); targets: [${targets.join(", ")}]`,
        });
      }
    }
  }

  for (const [type, byTarget] of incoming) {
    const cardinality = getRelationshipDefinition(type).cardinality;
    if (!enforcesIncomingLimit(cardinality)) continue;
    for (const [targetId, sources] of byTarget) {
      if (sources.length > 1) {
        issues.push({
          code: "CARDINALITY_VIOLATED",
          message:
            `${type} (${cardinality}): target '${targetId}' has ${sources.length} incoming edges ` +
            `(allowed: 1); sources: [${sources.join(", ")}]`,
        });
      }
    }
  }

  return issues;
}

function enforcesOutgoingLimit(c: RelationshipCardinality): boolean {
  return c === "1:1" || c === "N:1";
}

function enforcesIncomingLimit(c: RelationshipCardinality): boolean {
  return c === "1:1" || c === "1:N";
}
