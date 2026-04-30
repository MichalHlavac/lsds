// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { ChangePolicy } from "../layer/index.js";
import { ObjectLayer } from "./types.js";

// Layer policy (ADR-004 + kap. 2.7):
//   L1-L2 — REQUIRE_CONFIRMATION (system proposes, author confirms)
//   L3-L4 — AUTO_WITH_OVERRIDE   (author may override with rationale)
//   L5-L6 — AUTO                 (system decides)
export const LAYER_POLICY: Record<ObjectLayer, ChangePolicy> = {
  L1: "REQUIRE_CONFIRMATION",
  L2: "REQUIRE_CONFIRMATION",
  L3: "AUTO_WITH_OVERRIDE",
  L4: "AUTO_WITH_OVERRIDE",
  L5: "AUTO",
  L6: "AUTO",
};

export function policyForLayer(layer: ObjectLayer): ChangePolicy {
  return LAYER_POLICY[layer];
}

export function layersByPolicy(policy: ChangePolicy): ObjectLayer[] {
  return (Object.keys(LAYER_POLICY) as ObjectLayer[]).filter(
    (l) => LAYER_POLICY[l] === policy,
  );
}
