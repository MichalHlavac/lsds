// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { TeamRefSchema, TechnologyRefSchema } from "../../shared/refs.js";

export const ARCHITECTURE_COMPONENT_TYPES = [
  "SERVICE",
  "DATABASE",
  "MESSAGE_BROKER",
  "FRONTEND",
  "GATEWAY",
  "WORKER",
  "SCHEDULED_JOB",
  "EXTERNAL",
] as const;
export const ArchitectureComponentTypeSchema = z.enum(ARCHITECTURE_COMPONENT_TYPES);
export type ArchitectureComponentType = z.infer<typeof ArchitectureComponentTypeSchema>;

export const DATA_CLASSIFICATIONS = [
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "RESTRICTED",
] as const;
export const DataClassificationSchema = z.enum(DATA_CLASSIFICATIONS);
export type DataClassification = z.infer<typeof DataClassificationSchema>;

export const SCALABILITY_MODES = ["STATELESS", "STATEFUL", "SINGLETON"] as const;
export const ScalabilityModeSchema = z.enum(SCALABILITY_MODES);
export type ScalabilityMode = z.infer<typeof ScalabilityModeSchema>;

export const ArchitectureComponentSchema = TknBaseSchema.extend({
  type: z.literal("ArchitectureComponent"),
  layer: z.literal("L3"),
  description: z.string().min(1),
  componentType: ArchitectureComponentTypeSchema,
  technology: TechnologyRefSchema,
  owner: TeamRefSchema,
  dataClassification: DataClassificationSchema,
  scalabilityMode: ScalabilityModeSchema.optional(),
});
export type ArchitectureComponent = z.infer<typeof ArchitectureComponentSchema>;

export const ARCHITECTURE_COMPONENT_TRAVERSAL_WEIGHT = "EAGER" as const;
