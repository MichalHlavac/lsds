// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";

const LayerEnum = z.enum(["L1", "L2", "L3", "L4", "L5", "L6"]);
const LifecycleEnum = z.enum(["ACTIVE", "DEPRECATED", "ARCHIVED", "PURGE"]);
const SeverityEnum = z.enum(["ERROR", "WARN", "INFO"]);

export const CreateNodeSchema = z.object({
  type: z.string().min(1),
  layer: LayerEnum,
  name: z.string().min(1),
  version: z.string().optional().default("0.1.0"),
  lifecycleStatus: LifecycleEnum.optional().default("ACTIVE"),
  attributes: z.record(z.unknown()).optional().default({}),
});
export type CreateNode = z.infer<typeof CreateNodeSchema>;

export const UpdateNodeSchema = z.object({
  name: z.string().min(1).optional(),
  version: z.string().optional(),
  lifecycleStatus: LifecycleEnum.optional(),
  attributes: z.record(z.unknown()).optional(),
});

export const CreateEdgeSchema = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  type: z.string().min(1),
  layer: LayerEnum,
  traversalWeight: z.number().positive().optional().default(1.0),
  attributes: z.record(z.unknown()).optional().default({}),
});
export type CreateEdge = z.infer<typeof CreateEdgeSchema>;

export const UpdateEdgeSchema = z.object({
  type: z.string().min(1).optional(),
  traversalWeight: z.number().positive().optional(),
  attributes: z.record(z.unknown()).optional(),
});

export const CreateViolationSchema = z.object({
  nodeId: z.string().uuid().optional(),
  edgeId: z.string().uuid().optional(),
  ruleKey: z.string().min(1),
  severity: SeverityEnum,
  message: z.string().min(1),
  attributes: z.record(z.unknown()).optional().default({}),
});

export const TraverseSchema = z.object({
  depth: z.number().int().min(1).max(20).optional().default(3),
  direction: z.enum(["outbound", "inbound", "both"]).optional().default("both"),
  edgeTypes: z.array(z.string()).optional(),
});

export const CreateGuardrailSchema = z.object({
  ruleKey: z.string().min(1),
  description: z.string().optional().default(""),
  severity: SeverityEnum,
  enabled: z.boolean().optional().default(true),
  config: z.record(z.unknown()).optional().default({}),
});

export const UpdateGuardrailSchema = z.object({
  description: z.string().optional(),
  severity: SeverityEnum.optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
});

export const CreateUserSchema = z.object({
  externalId: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().email().optional(),
  role: z.enum(["admin", "editor", "viewer"]).optional().default("viewer"),
  attributes: z.record(z.unknown()).optional().default({}),
});

export const CreateTeamSchema = z.object({
  name: z.string().min(1),
  attributes: z.record(z.unknown()).optional().default({}),
});
