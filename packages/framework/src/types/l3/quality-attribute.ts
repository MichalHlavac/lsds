// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { UuidSchema } from "../../shared/refs.js";

export const QUALITY_ATTRIBUTE_CATEGORIES = [
  "PERFORMANCE",
  "SECURITY",
  "SCALABILITY",
  "RELIABILITY",
  "MAINTAINABILITY",
  "USABILITY",
  "COMPLIANCE",
] as const;
export const QualityAttributeCategorySchema = z.enum(QUALITY_ATTRIBUTE_CATEGORIES);
export type QualityAttributeCategory = z.infer<typeof QualityAttributeCategorySchema>;

export const QUALITY_ATTRIBUTE_PRIORITIES = ["MUST", "SHOULD", "COULD"] as const;
export const QualityAttributePrioritySchema = z.enum(QUALITY_ATTRIBUTE_PRIORITIES);
export type QualityAttributePriority = z.infer<typeof QualityAttributePrioritySchema>;

export const QualityAttributeRefSchema = z.object({
  kind: z.literal("quality-attribute"),
  id: UuidSchema,
});
export type QualityAttributeRef = z.infer<typeof QualityAttributeRefSchema>;

export const QualityAttributeSchema = TknBaseSchema.extend({
  type: z.literal("QualityAttribute"),
  layer: z.literal("L3"),
  category: QualityAttributeCategorySchema,
  requirement: z
    .string()
    .min(20, "QualityAttribute.requirement must be measurable (≥ 20 chars)"),
  measurement: z
    .string()
    .min(20, "QualityAttribute.measurement must describe how it is measured (≥ 20 chars)"),
  priority: QualityAttributePrioritySchema,
});
export type QualityAttribute = z.infer<typeof QualityAttributeSchema>;

