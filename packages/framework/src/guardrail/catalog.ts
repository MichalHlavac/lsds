// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { GuardrailRule } from "./types.js";
import { L1_L2_RULES } from "./catalog/l1-l2.js";
import { L3_L4_RULES } from "./catalog/l3-l4.js";
import { L5_L6_RULES } from "./catalog/l5-l6.js";
import { XL_RULES } from "./catalog/xl.js";

export const GUARDRAIL_CATALOG: ReadonlyArray<GuardrailRule> = Object.freeze([
  ...L1_L2_RULES,
  ...L3_L4_RULES,
  ...L5_L6_RULES,
  ...XL_RULES,
]);
