// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { UuidSchema } from "../../shared/refs.js";
import { QualityAttributeRefSchema } from "./quality-attribute.js";

export const ArchitectureSystemRefSchema = z.object({
  kind: z.literal("architecture-system"),
  id: UuidSchema,
});
export type ArchitectureSystemRef = z.infer<typeof ArchitectureSystemRefSchema>;

export const ArchitectureSystemSchema = TknBaseSchema.extend({
  type: z.literal("ArchitectureSystem"),
  layer: z.literal("L3"),
  description: z.string().min(1),
  primaryUsers: z
    .array(z.string().min(1))
    .min(1, "ArchitectureSystem.primaryUsers must list at least one user role"),
  qualityAttributes: z
    .array(QualityAttributeRefSchema)
    .min(1, "ArchitectureSystem.qualityAttributes must reference at least one QualityAttribute"),
}).superRefine((value, ctx) => {
  const seen = new Set<string>();
  for (const [i, ref] of value.qualityAttributes.entries()) {
    if (seen.has(ref.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `qualityAttributes must be unique by id; duplicate: ${ref.id}`,
        path: ["qualityAttributes", i, "id"],
      });
    }
    seen.add(ref.id);
  }
});
export type ArchitectureSystem = z.infer<typeof ArchitectureSystemSchema>;

