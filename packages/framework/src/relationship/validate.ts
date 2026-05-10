// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { LayerId } from "../layer/index.js";
import type { EdgeValidationIssue, RelationshipEdge, RelationshipType } from "./types.js";
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

// Graph-level cardinality enforcement (kap. 2.2).
// `validateRelationshipEdge` checks one edge in isolation; cardinality is a
// graph property and needs the full edge set. Per kap. 2.2 column "Cardinality":
//   1:1 → at most one outgoing per (source, type) AND at most one incoming per (target, type)
//   N:1 → at most one outgoing per (source, type)
//   1:N → at most one incoming per (target, type)
//   M:N → no constraint
// Edges are deduplicated by (type, sourceTknId, targetTknId) so an accidental
// double-listing of the same edge does not register as a cardinality breach.
// Unknown relationship types are skipped silently — single-edge validation
// already surfaces UNKNOWN_TYPE for those.
export function validateGraphCardinality(edges: ReadonlyArray<RelationshipEdge>): EdgeValidationIssue[] {
  const issues: EdgeValidationIssue[] = [];
  if (edges.length === 0) return issues;

  // Bucket distinct edges per type.
  const distinctByType = new Map<RelationshipType, RelationshipEdge[]>();
  for (const edge of edges) {
    if (!KNOWN_TYPES.has(edge.type)) continue;
    const bucket = distinctByType.get(edge.type) ?? [];
    const isDup = bucket.some(
      (e) => e.sourceTknId === edge.sourceTknId && e.targetTknId === edge.targetTknId,
    );
    if (!isDup) bucket.push(edge);
    distinctByType.set(edge.type, bucket);
  }

  for (const [type, typeEdges] of distinctByType) {
    const def = getRelationshipDefinition(type);
    const { cardinality } = def;
    if (cardinality === "M:N") continue;

    const enforceOutgoing = cardinality === "1:1" || cardinality === "N:1";
    const enforceIncoming = cardinality === "1:1" || cardinality === "1:N";

    if (enforceOutgoing) {
      const bySource = new Map<string, RelationshipEdge[]>();
      for (const edge of typeEdges) {
        const list = bySource.get(edge.sourceTknId) ?? [];
        list.push(edge);
        bySource.set(edge.sourceTknId, list);
      }
      for (const [sourceTknId, list] of bySource) {
        if (list.length > 1) {
          const targets = list.map((e) => e.targetTknId).join(", ");
          issues.push({
            code: "CARDINALITY_VIOLATED",
            message:
              `${type} (${cardinality}): source ${sourceTknId} has ${list.length} outgoing ` +
              `edges (allowed: 1); targets: [${targets}]`,
          });
        }
      }
    }

    if (enforceIncoming) {
      const byTarget = new Map<string, RelationshipEdge[]>();
      for (const edge of typeEdges) {
        const list = byTarget.get(edge.targetTknId) ?? [];
        list.push(edge);
        byTarget.set(edge.targetTknId, list);
      }
      for (const [targetTknId, list] of byTarget) {
        if (list.length > 1) {
          const sources = list.map((e) => e.sourceTknId).join(", ");
          issues.push({
            code: "CARDINALITY_VIOLATED",
            message:
              `${type} (${cardinality}): target ${targetTknId} has ${list.length} incoming ` +
              `edges (allowed: 1); sources: [${sources}]`,
          });
        }
      }
    }
  }

  return issues;
}
