export * from "./types";
export { classifyChange, changeKindsBySeverity } from "./classifier";
export { LAYER_POLICY, policyForLayer, layersByPolicy } from "./policy";
export {
  MINOR_PROPAGATING_RELATIONSHIPS,
  propagationFor,
  propagatesOver,
} from "./propagation";
export type { MinorPropagatingRelationship, PropagationPolicy } from "./propagation";
export { decideChange } from "./decide";
export type { ChangeDecision, ChangeDecisionInput } from "./decide";
