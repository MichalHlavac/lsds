import { classifyChange } from "./classifier";
import { policyForLayer } from "./policy";
import { propagationFor, PropagationPolicy } from "./propagation";
import { ChangePolicy } from "../layer/index.js";
import {
  ChangeConfirmation,
  ChangeConfirmationSchema,
  ChangeKind,
  ChangeOverride,
  ChangeOverrideSchema,
  ChangeSeverity,
  DecisionStatus,
  ObjectLayer,
} from "./types";

export interface ChangeDecisionInput {
  layer: ObjectLayer;
  kind: ChangeKind;
  override?: ChangeOverride;
  confirmation?: ChangeConfirmation;
}

export type ChangeDecision =
  | {
      status: "PENDING_CONFIRMATION";
      decisionStatus: Extract<DecisionStatus, "PENDING_CONFIRMATION">;
      policy: ChangePolicy;
      proposedSeverity: ChangeSeverity;
      effectiveSeverity: null;
      propagation: null;
      reason: string;
    }
  | {
      status: "APPLIED";
      decisionStatus: Exclude<DecisionStatus, "PENDING_CONFIRMATION">;
      policy: ChangePolicy;
      proposedSeverity: ChangeSeverity;
      effectiveSeverity: ChangeSeverity;
      propagation: PropagationPolicy;
      override?: ChangeOverride;
      confirmation?: ChangeConfirmation;
    };

// Combines structural classification, layer policy, and (optional) author
// override/confirmation into a final decision. Pure: accepts no I/O, throws
// only for invalid override/confirmation payloads or contradictory inputs.
export function decideChange(input: ChangeDecisionInput): ChangeDecision {
  const proposedSeverity = classifyChange(input.kind);
  const policy = policyForLayer(input.layer);

  if (input.override && input.confirmation) {
    throw new Error(
      "decideChange: provide either override OR confirmation, not both",
    );
  }

  switch (policy) {
    case "REQUIRE_CONFIRMATION": {
      if (input.override) {
        throw new Error(
          `Layer ${input.layer} uses REQUIRE_CONFIRMATION; supply confirmation, not override`,
        );
      }
      if (!input.confirmation) {
        return {
          status: "PENDING_CONFIRMATION",
          decisionStatus: "PENDING_CONFIRMATION",
          policy,
          proposedSeverity,
          effectiveSeverity: null,
          propagation: null,
          reason: `Layer ${input.layer} requires author confirmation before applying ${proposedSeverity}`,
        };
      }
      const confirmation = ChangeConfirmationSchema.parse(input.confirmation);
      const effective = confirmation.severity;
      return {
        status: "APPLIED",
        decisionStatus: "CONFIRMED",
        policy,
        proposedSeverity,
        effectiveSeverity: effective,
        propagation: propagationFor(effective),
        confirmation,
      };
    }

    case "AUTO_WITH_OVERRIDE": {
      if (input.confirmation) {
        throw new Error(
          `Layer ${input.layer} uses AUTO_WITH_OVERRIDE; supply override, not confirmation`,
        );
      }
      if (!input.override) {
        return {
          status: "APPLIED",
          decisionStatus: "AUTO_APPLIED",
          policy,
          proposedSeverity,
          effectiveSeverity: proposedSeverity,
          propagation: propagationFor(proposedSeverity),
        };
      }
      const override = ChangeOverrideSchema.parse(input.override);
      const effective = override.severity;
      return {
        status: "APPLIED",
        decisionStatus: "OVERRIDDEN",
        policy,
        proposedSeverity,
        effectiveSeverity: effective,
        propagation: propagationFor(effective),
        override,
      };
    }

    case "AUTO": {
      if (input.confirmation) {
        throw new Error(
          `Layer ${input.layer} uses AUTO; confirmation is not applicable`,
        );
      }
      if (input.override) {
        // L5-L6 still allow override but without friction (kap. 2.7) — rationale
        // optional in spec, but we keep schema-required rationale for audit trail.
        const override = ChangeOverrideSchema.parse(input.override);
        const effective = override.severity;
        return {
          status: "APPLIED",
          decisionStatus: "OVERRIDDEN",
          policy,
          proposedSeverity,
          effectiveSeverity: effective,
          propagation: propagationFor(effective),
          override,
        };
      }
      return {
        status: "APPLIED",
        decisionStatus: "AUTO_APPLIED",
        policy,
        proposedSeverity,
        effectiveSeverity: proposedSeverity,
        propagation: propagationFor(proposedSeverity),
      };
    }
  }
}
