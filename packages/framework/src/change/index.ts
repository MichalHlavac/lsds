// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

export * from "./types.js";
export { classifyChange, changeKindsBySeverity } from "./classifier.js";
export { LAYER_POLICY, policyForLayer, layersByPolicy } from "./policy.js";
export {
  MINOR_PROPAGATING_RELATIONSHIPS,
  propagationFor,
  propagatesOver,
} from "./propagation.js";
export type { MinorPropagatingRelationship, ChangePropagationPolicy } from "./propagation.js";
export { decideChange } from "./decide.js";
export type { ChangeDecision, ChangeDecisionInput } from "./decide.js";
