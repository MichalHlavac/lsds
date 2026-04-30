// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { PropagationSchema, SeveritySchema, type Propagation, type Severity } from "./types.js";
import { ViolationSchema, type Violation } from "./violation.js";

export const PROPAGATION_DIRECTIONS = ["UP", "DOWN", "LATERAL"] as const;
export const PropagationDirectionSchema = z.enum(PROPAGATION_DIRECTIONS);
export type PropagationDirection = z.infer<typeof PropagationDirectionSchema>;

export const PropagationEdgeSchema = z
  .object({
    toObjectId: z.string().min(1),
    toObjectType: z.string().min(1),
    direction: PropagationDirectionSchema,
    relationshipType: z.string().min(1),
  })
  .strict();
export type PropagationEdge = z.infer<typeof PropagationEdgeSchema>;

const POLICY_DIRECTIONS: Record<Propagation, ReadonlyArray<PropagationDirection>> = {
  NONE: [],
  UPWARD: ["UP"],
  DOWNWARD: ["DOWN"],
  BOTH: ["UP", "DOWN"],
  LATERAL: ["LATERAL"],
};

const SEVERITY_DEMOTION: Record<Severity, Severity | null> = {
  ERROR: "WARNING",
  WARNING: "INFO",
  INFO: null,
};

export function demoteSeverity(severity: Severity): Severity | null {
  return SEVERITY_DEMOTION[severity];
}

export const InheritedViolationSchema = ViolationSchema.and(
  z
    .object({
      inheritedFrom: z.string().min(1),
      inheritDepth: z.number().int().positive(),
    })
    .strict(),
);
export type InheritedViolation = z.infer<typeof InheritedViolationSchema>;

export interface PropagateOptions {
  /**
   * Builder for the inherited violation id. Defaults to `${parentId}::${edge.toObjectId}`.
   * Persistence layers typically override this with a UUID generator.
   */
  idGenerator?: (parent: Violation | InheritedViolation, edge: PropagationEdge) => string;
}

function isInherited(v: Violation | InheritedViolation): v is InheritedViolation {
  return (v as InheritedViolation).inheritedFrom !== undefined;
}

export function propagateViolation(
  source: Violation | InheritedViolation,
  policy: Propagation,
  edges: ReadonlyArray<PropagationEdge>,
  options: PropagateOptions = {},
): InheritedViolation[] {
  PropagationSchema.parse(policy);
  if (policy === "NONE") return [];

  const inheritedSeverity = SeveritySchema.parse(source.severity);
  const demoted = demoteSeverity(inheritedSeverity);
  if (demoted === null) return [];

  const allowedDirections = POLICY_DIRECTIONS[policy];
  const originId = isInherited(source) ? source.inheritedFrom : source.id;
  const depth = isInherited(source) ? source.inheritDepth + 1 : 1;
  const idFor = options.idGenerator ?? ((parent, edge) => `${parent.id}::${edge.toObjectId}`);

  const result: InheritedViolation[] = [];
  for (const edge of edges) {
    if (!allowedDirections.includes(edge.direction)) continue;
    result.push({
      id: idFor(source, edge),
      rule_id: source.rule_id,
      object_id: edge.toObjectId,
      object_type: edge.toObjectType,
      severity: demoted,
      status: "OPEN",
      detectedAt: source.detectedAt,
      message: `Inherited from ${originId} via ${edge.relationshipType}: ${source.message}`,
      inheritedFrom: originId,
      inheritDepth: depth,
    });
  }
  return result;
}

/**
 * Suppressing a violation hides the original (ERROR/WARNING) status from the
 * primary view but emits an INFO marker so the suppression itself remains
 * visible in periodic reviews and analytics. Generated marker carries the
 * suppression rationale and expiry to satisfy kap. 2.5 audit requirements.
 */
export function generateSuppressionMarker(violation: Violation): Violation {
  if (violation.status !== "SUPPRESSED" || !violation.suppression) {
    throw new Error(
      "generateSuppressionMarker: violation must be SUPPRESSED with suppression metadata",
    );
  }
  const { suppression } = violation;
  return {
    id: `${violation.id}::marker`,
    rule_id: violation.rule_id,
    object_id: violation.object_id,
    object_type: violation.object_type,
    severity: "INFO",
    status: "OPEN",
    detectedAt: suppression.suppressedAt,
    message: `Suppression marker for ${violation.id} until ${suppression.expiresAt} (by ${suppression.suppressedBy}): ${suppression.rationale}`,
  };
}
