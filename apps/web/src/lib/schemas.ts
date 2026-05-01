// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { LayerSchema, LifecycleStatusSchema } from "@lsds/shared";

export const LayerEnum = LayerSchema;

export const CreateNodeSchema = z.object({
  type: z.string().min(1, "Type is required"),
  layer: LayerSchema,
  name: z.string().min(1, "Name is required"),
  version: z.string().optional().default("0.1.0"),
  lifecycleStatus: LifecycleStatusSchema.optional().default("ACTIVE"),
  attributes: z.record(z.unknown()).optional().default({}),
});
export type CreateNodeInput = z.infer<typeof CreateNodeSchema>;

export const UpdateNodeSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  version: z.string().optional(),
  attributes: z.record(z.unknown()).optional(),
});
export type UpdateNodeInput = z.infer<typeof UpdateNodeSchema>;

export const CreateEdgeSchema = z.object({
  sourceId: z.string().uuid("Must be a valid UUID"),
  targetId: z.string().uuid("Must be a valid UUID"),
  type: z.string().min(1, "Type is required"),
  layer: LayerEnum,
  traversalWeight: z.number().positive("Must be positive").optional().default(1.0),
  attributes: z.record(z.unknown()).optional().default({}),
});
export type CreateEdgeInput = z.infer<typeof CreateEdgeSchema>;

export const UpdateEdgeSchema = z.object({
  type: z.string().min(1, "Type is required").optional(),
  traversalWeight: z.number().positive("Must be positive").optional(),
  attributes: z.record(z.unknown()).optional(),
});
export type UpdateEdgeInput = z.infer<typeof UpdateEdgeSchema>;
