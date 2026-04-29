import { z } from "zod";

// Object layer (L1-L6). Excludes XL (cross-layer guardrails are not versioned objects).
export const OBJECT_LAYERS = ["L1", "L2", "L3", "L4", "L5", "L6"] as const;
export const ObjectLayerSchema = z.enum(OBJECT_LAYERS);
export type ObjectLayer = z.infer<typeof ObjectLayerSchema>;

export const CHANGE_SEVERITIES = ["MAJOR", "MINOR", "PATCH"] as const;
export const ChangeSeveritySchema = z.enum(CHANGE_SEVERITIES);
export type ChangeSeverity = z.infer<typeof ChangeSeveritySchema>;

// Structural change kinds (kap. 2.7).
//   MAJOR: RENAME, TYPE_CHANGE, RELATIONSHIP_REMOVED
//   MINOR: RELATIONSHIP_ADDED, ENUM_VALUE_CHANGED
//   PATCH: DESCRIPTION_CHANGED, TAGS_CHANGED, METADATA_CHANGED
export const CHANGE_KINDS = [
  "RENAME",
  "TYPE_CHANGE",
  "RELATIONSHIP_REMOVED",
  "RELATIONSHIP_ADDED",
  "ENUM_VALUE_CHANGED",
  "DESCRIPTION_CHANGED",
  "TAGS_CHANGED",
  "METADATA_CHANGED",
] as const;
export const ChangeKindSchema = z.enum(CHANGE_KINDS);
export type ChangeKind = z.infer<typeof ChangeKindSchema>;

// Stale flag severity raised on related objects when a change propagates.
export const STALE_SEVERITIES = ["ERROR", "WARNING", "INFO"] as const;
export const StaleSeveritySchema = z.enum(STALE_SEVERITIES);
export type StaleSeverity = z.infer<typeof StaleSeveritySchema>;

// Propagation modes (kap. 2.7).
//   ALL_RELATIONSHIPS    — MAJOR
//   SELECTED_RELATIONSHIPS — MINOR (realizes / implements / traces-to)
//   DIRECT_PARENTS       — PATCH (no traversal, only immediate parents)
export const PROPAGATION_MODES = [
  "ALL_RELATIONSHIPS",
  "SELECTED_RELATIONSHIPS",
  "DIRECT_PARENTS",
] as const;
export const PropagationModeSchema = z.enum(PROPAGATION_MODES);
export type PropagationMode = z.infer<typeof PropagationModeSchema>;

// Decision lifecycle for a change event under the layer policy.
export const DECISION_STATUSES = [
  "PENDING_CONFIRMATION", // L1-L2: awaiting author confirmation
  "CONFIRMED",            // L1-L2: author confirmed proposed severity
  "AUTO_APPLIED",         // L3-L6: applied without override
  "OVERRIDDEN",           // L3-L4: author overrode classification with rationale
] as const;
export const DecisionStatusSchema = z.enum(DECISION_STATUSES);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

export const OVERRIDE_RATIONALE_MIN_CHARS = 20;

// Override applied by author on AUTO_WITH_OVERRIDE (L3-L4).
export const ChangeOverrideSchema = z
  .object({
    severity: ChangeSeveritySchema,
    rationale: z
      .string()
      .min(
        OVERRIDE_RATIONALE_MIN_CHARS,
        `override rationale must be ≥ ${OVERRIDE_RATIONALE_MIN_CHARS} chars`,
      ),
    overriddenBy: z.string().min(1),
    overriddenAt: z.string().datetime(),
  })
  .strict();
export type ChangeOverride = z.infer<typeof ChangeOverrideSchema>;

// Confirmation applied by author on REQUIRE_CONFIRMATION (L1-L2).
export const ChangeConfirmationSchema = z
  .object({
    severity: ChangeSeveritySchema,
    confirmedBy: z.string().min(1),
    confirmedAt: z.string().datetime(),
  })
  .strict();
export type ChangeConfirmation = z.infer<typeof ChangeConfirmationSchema>;

export const ChangeEventSchema = z
  .object({
    id: z.string().min(1),
    objectId: z.string().min(1),
    objectType: z.string().min(1),
    layer: ObjectLayerSchema,
    kind: ChangeKindSchema,
    proposedSeverity: ChangeSeveritySchema,
    occurredAt: z.string().datetime(),
    relationshipType: z.string().min(1).optional(),
  })
  .strict();
export type ChangeEvent = z.infer<typeof ChangeEventSchema>;
