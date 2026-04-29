// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";

export const ArchitecturePrincipleSchema = TknBaseSchema.extend({
  type: z.literal("ArchitecturePrinciple"),
  layer: z.literal("L3"),
  statement: z
    .string()
    .min(30, "ArchitecturePrinciple.statement must clearly express the principle (≥ 30 chars)"),
  rationale: z
    .string()
    .min(30, "ArchitecturePrinciple.rationale must explain why this principle holds (≥ 30 chars)"),
  implications: z
    .array(z.string().min(1))
    .min(1, "ArchitecturePrinciple.implications must list at least one consequence"),
  exceptions: z.string().optional(),
});
export type ArchitecturePrinciple = z.infer<typeof ArchitecturePrincipleSchema>;

export const ARCHITECTURE_PRINCIPLE_TRAVERSAL_WEIGHT = "LAZY" as const;
