// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

export * from "./types";
export { classifyChange, changeKindsBySeverity } from "./classifier";
export { LAYER_POLICY, policyForLayer, layersByPolicy } from "./policy";
export {
  MINOR_PROPAGATING_RELATIONSHIPS,
  propagationFor,
  propagatesOver,
} from "./propagation";
export type { MinorPropagatingRelationship, ChangePropagationPolicy } from "./propagation";
export { decideChange } from "./decide";
export type { ChangeDecision, ChangeDecisionInput } from "./decide";
