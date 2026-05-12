// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";

// TechnicalDebt is L5 Implementation but is referenced graph-wide
// (any node can have inbound `traces-to` from a debt entry). The
// `rationale` field is required at the schema level — kap. 5 elevates
// it to a *structural* guardrail because debt that can't explain why
// the trade-off was made is indistinguishable from carelessness.
//
// Traversal weight: LAZY (kap. 4 § L5). Debt should not balloon every
// context package; it surfaces only when explicitly requested or when
// the debt itself is in violation.

export const DEBT_TYPES = ["DESIGN", "CODE", "TEST", "DOCUMENTATION", "INFRASTRUCTURE"] as const;
export const DebtTypeSchema = z.enum(DEBT_TYPES);
export type DebtType = z.infer<typeof DebtTypeSchema>;

export const ESTIMATED_EFFORTS = ["TRIVIAL", "SMALL", "MEDIUM", "LARGE", "EPIC"] as const;
export const EstimatedEffortSchema = z.enum(ESTIMATED_EFFORTS);
export type EstimatedEffort = z.infer<typeof EstimatedEffortSchema>;

export const INTEREST_RATES = ["LOW", "MEDIUM", "HIGH"] as const;
export const InterestRateSchema = z.enum(INTEREST_RATES);
export type InterestRate = z.infer<typeof InterestRateSchema>;

export const DEBT_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "ACCEPTED"] as const;
export const DebtStatusSchema = z.enum(DEBT_STATUSES);
export type DebtStatus = z.infer<typeof DebtStatusSchema>;

export const TechnicalDebtSchema = TknBaseSchema.extend({
  type: z.literal("TechnicalDebt"),
  layer: z.literal("L5"),
  description: z.string().min(1),
  debtType: DebtTypeSchema,
  impact: z.string().min(1, "TechnicalDebt.impact must describe the concrete consequence of the debt"),
  estimatedEffort: EstimatedEffortSchema,
  interestRate: InterestRateSchema,
  rationale: z
    .string()
    .min(20, "TechnicalDebt.rationale must explain why the trade-off was accepted (≥20 chars)"),
  status: DebtStatusSchema,
  targetResolution: z.string().date().optional(),
});
export type TechnicalDebt = z.infer<typeof TechnicalDebtSchema>;
