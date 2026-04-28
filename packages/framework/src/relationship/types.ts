import { z } from "zod";
import { LayerIdSchema, type LayerId, getLayerOrdinal } from "../layer/index.js";

// 19 relationship types from kap. 2.2.
export const RELATIONSHIP_TYPES = [
  "realizes",
  "implements",
  "contains",
  "part-of",
  "depends-on",
  "uses",
  "calls",
  "context-integration",
  "supersedes",
  "traces-to",
  "validated-by",
  "owned-by",
  "deploys-to",
  "decided-by",
  "violates",
  "motivated-by",
  "impacts",
  "publishes",
  "consumes",
] as const;
export const RelationshipTypeSchema = z.enum(RELATIONSHIP_TYPES);
export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;

// High-level grouping from kap. 2.2 ("Kategorie" column).
export const RELATIONSHIP_CATEGORIES = [
  "REALIZATION",
  "COMPOSITION",
  "DEPENDENCY",
  "INTEGRATION",
  "EVOLUTION",
  "TRACEABILITY",
  "OWNERSHIP",
  "OPERATIONS",
  "DECISION",
  "VIOLATION",
  "MOTIVATION",
  "IMPACT",
  "EVENT_FLOW",
] as const;
export const RelationshipCategorySchema = z.enum(RELATIONSHIP_CATEGORIES);
export type RelationshipCategory = z.infer<typeof RelationshipCategorySchema>;

// Semantic direction tag from kap. 2.2 (informative).
export const RELATIONSHIP_DIRECTIONS = [
  "upward",
  "downward",
  "lateral",
  "vertical",
  "cross-layer",
  "any",
] as const;
export const RelationshipDirectionSchema = z.enum(RELATIONSHIP_DIRECTIONS);
export type RelationshipDirection = z.infer<typeof RelationshipDirectionSchema>;

// Cardinality kinds from kap. 2.2.
export const RELATIONSHIP_CARDINALITIES = ["1:1", "1:N", "N:1", "M:N"] as const;
export const RelationshipCardinalitySchema = z.enum(RELATIONSHIP_CARDINALITIES);
export type RelationshipCardinality = z.infer<typeof RelationshipCardinalitySchema>;

// Traversal weight from kap. 2.10.
export const TRAVERSAL_WEIGHTS = ["EAGER", "LAZY"] as const;
export const TraversalWeightSchema = z.enum(TRAVERSAL_WEIGHTS);
export type TraversalWeight = z.infer<typeof TraversalWeightSchema>;

// Propagation policy from kap. 2.5.
export const PROPAGATION_POLICIES = ["NONE", "UPWARD", "DOWNWARD", "BOTH"] as const;
export const PropagationPolicySchema = z.enum(PROPAGATION_POLICIES);
export type PropagationPolicy = z.infer<typeof PropagationPolicySchema>;

// How source.layer.ordinal must relate to target.layer.ordinal.
// Layer ordinals: L1=1 (most abstract) … L6=6 (most concrete).
export const LAYER_ORDINAL_CONSTRAINTS = [
  "EQUAL", // same layer
  "SOURCE_GTE_TARGET", // concrete → abstract (or same layer)
  "SOURCE_LTE_TARGET", // abstract → concrete (or same layer)
  "SOURCE_GT_TARGET", // strictly concrete → abstract
  "SOURCE_LT_TARGET", // strictly abstract → concrete
  "ANY",
] as const;
export const LayerOrdinalConstraintSchema = z.enum(LAYER_ORDINAL_CONSTRAINTS);
export type LayerOrdinalConstraint = z.infer<typeof LayerOrdinalConstraintSchema>;

export const LayerRulesSchema = z
  .object({
    allowedSourceLayers: z.array(LayerIdSchema).readonly(),
    allowedTargetLayers: z.array(LayerIdSchema).readonly(),
    layerOrdinalConstraint: LayerOrdinalConstraintSchema,
    targetIsExternal: z.boolean().default(false),
  })
  .strict();
export type LayerRules = z.infer<typeof LayerRulesSchema>;

export const RelationshipDefinitionSchema = z
  .object({
    type: RelationshipTypeSchema,
    category: RelationshipCategorySchema,
    direction: RelationshipDirectionSchema,
    cardinality: RelationshipCardinalitySchema,
    traversalWeight: TraversalWeightSchema,
    propagationPolicy: PropagationPolicySchema,
    layerRules: LayerRulesSchema,
    semantics: z.string().min(10),
    rationale: z.string().min(10),
  })
  .strict();
export type RelationshipDefinition = z.infer<typeof RelationshipDefinitionSchema>;

// Concrete edge instance — used by application/persistence layer.
export const RelationshipEdgeSchema = z
  .object({
    type: RelationshipTypeSchema,
    sourceLayer: LayerIdSchema,
    targetLayer: LayerIdSchema,
    sourceTknId: z.string().min(1),
    targetTknId: z.string().min(1),
  })
  .strict();
export type RelationshipEdge = z.infer<typeof RelationshipEdgeSchema>;

export interface EdgeValidationIssue {
  code:
    | "UNKNOWN_TYPE"
    | "SOURCE_LAYER_NOT_ALLOWED"
    | "TARGET_LAYER_NOT_ALLOWED"
    | "ORDINAL_CONSTRAINT_VIOLATED"
    | "TARGET_EXTERNAL_REQUIRED";
  message: string;
}

export function checkOrdinalConstraint(
  source: LayerId,
  target: LayerId,
  constraint: LayerOrdinalConstraint,
): boolean {
  const s = getLayerOrdinal(source);
  const t = getLayerOrdinal(target);
  switch (constraint) {
    case "EQUAL":
      return s === t;
    case "SOURCE_GTE_TARGET":
      return s >= t;
    case "SOURCE_LTE_TARGET":
      return s <= t;
    case "SOURCE_GT_TARGET":
      return s > t;
    case "SOURCE_LT_TARGET":
      return s < t;
    case "ANY":
      return true;
  }
}
