import {
  ChangeSeverity,
  PropagationMode,
  StaleSeverity,
} from "./types";

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
