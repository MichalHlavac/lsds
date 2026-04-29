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
