// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { LayerSchema, LifecycleStatusSchema, SeveritySchema } from "@lsds/shared";
import {
  RelationshipTypeSchema,
  TeamRefSchema,
  ObjectLayerSchema,
  ChangeKindSchema,
  ChangeOverrideSchema,
  ChangeConfirmationSchema,
} from "@lsds/framework";

const LayerEnum = LayerSchema;
const LifecycleEnum = LifecycleStatusSchema;
const SeverityEnum = SeveritySchema;
// Severity values are uppercase-only (ERROR | WARN | INFO). Coerce input for DX.
const SeverityInput = z.preprocess(
  (v) => (typeof v === "string" ? v.toUpperCase() : v),
  SeverityEnum,
);

export const CreateNodeSchema = z.object({
  type: z.string().min(1),
  layer: LayerEnum,
  name: z.string().min(1),
  version: z.string().optional().default("0.1.0"),
  lifecycleStatus: LifecycleEnum.optional().default("ACTIVE"),
  attributes: z.record(z.unknown()).optional().default({}),
  owner: TeamRefSchema.optional(),
});
export type CreateNode = z.infer<typeof CreateNodeSchema>;

// `type` and `layer` are intentionally absent — they are immutable after creation.
export const UpdateNodeSchema = z.object({
  name: z.string().min(1).optional(),
  version: z.string().optional(),
  lifecycleStatus: LifecycleEnum.optional(),
  attributes: z.record(z.unknown()).optional(),
});

export const CreateEdgeSchema = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  type: RelationshipTypeSchema,
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
  sourceNodeId: z.string().uuid().optional(),
  targetNodeId: z.string().uuid().optional(),
  ruleKey: z.string().min(1),
  severity: SeverityInput,
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
  severity: SeverityInput,
  enabled: z.boolean().optional().default(true),
  config: z.record(z.unknown()).optional().default({}),
});

export const UpdateGuardrailSchema = z.object({
  description: z.string().optional(),
  severity: SeverityInput.optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
});

export const QueryNodesSchema = z.object({
  attributes: z.record(z.unknown()).optional(),
  type: z.string().min(1).optional(),
  layer: LayerEnum.optional(),
  lifecycleStatus: LifecycleEnum.optional(),
  text: z.string().optional(),
  limit: z.number().int().positive().max(500).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export const AgentSearchSchema = z.object({
  query: z.string().optional(),
  attributes: z.record(z.unknown()).optional(),
  type: z.string().min(1).optional(),
  layer: LayerEnum.optional(),
  lifecycleStatus: LifecycleEnum.optional(),
  limit: z.number().int().positive().max(100).optional().default(20),
});

export const SemanticSearchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(100).optional().default(10),
  type: z.string().min(1).optional(),
  layer: LayerEnum.optional(),
  minScore: z.number().min(0).max(1).optional(),
});

export const BatchIdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
});

export const BatchLifecycleSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  transition: z.enum(["deprecate", "archive", "purge"]),
});

// POST /agent/v1/architect/analyze — bulk drift scan input.
// All fields optional; defaults yield a full-graph scan over non-archived nodes.
export const AgentAnalyzeSchema = z.object({
  persist: z.boolean().optional().default(false),
  types: z.array(z.string().min(1)).optional(),
  layers: z.array(LayerEnum).optional(),
  lifecycleStatuses: z.array(LifecycleEnum).optional(),
  sampleLimit: z.number().int().min(0).max(500).optional().default(50),
});
export type AgentAnalyze = z.infer<typeof AgentAnalyzeSchema>;

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

export const KnowledgeContextSchema = z.object({
  nodeId: z.string().uuid(),
  profile: z.enum(["depth", "breadth", "semantic"]),
  maxNodes: z.number().int().positive().max(100).optional().default(20),
  minSimilarity: z.number().min(0).max(1).optional().default(0.7),
});
export type KnowledgeContext = z.infer<typeof KnowledgeContextSchema>;

export const ImpactPredictSchema = z.object({
  changeType: z.enum(["create", "update", "delete"]),
  nodeId: z.string().uuid().optional(),
  proposedNode: z
    .object({
      type: z.string().min(1),
      layer: LayerEnum,
      name: z.string().min(1),
      version: z.string().optional(),
      lifecycleStatus: LifecycleEnum.optional(),
      attributes: z.record(z.unknown()).optional().default({}),
      owner: TeamRefSchema.optional(),
    })
    .optional(),
  edgeChanges: z
    .array(
      z.object({
        fromId: z.string().uuid(),
        toId: z.string().uuid(),
        edgeType: z.string().min(1),
        action: z.enum(["add", "remove"]),
      })
    )
    .optional(),
  maxDepth: z.number().int().min(1).max(10).optional().default(3),
});
export type ImpactPredict = z.infer<typeof ImpactPredictSchema>;

// POST /agent/v1/architect/analyze-change — ADR A4 layer-dependent policy gate.
// Wraps decideChange(): given layer + kind (+ optional override/confirmation),
// returns the decision outcome (policy, severity, propagation, decision status).
export const AnalyzeChangeSchema = z.object({
  layer: ObjectLayerSchema,
  kind: ChangeKindSchema,
  override: ChangeOverrideSchema.optional(),
  confirmation: ChangeConfirmationSchema.optional(),
});
export type AnalyzeChange = z.infer<typeof AnalyzeChangeSchema>;

export const LifecycleTransitionSchema = z.object({
  transition: z.enum(["deprecate", "archive", "purge", "reactivate"]),
});

export const CreateSnapshotSchema = z.object({
  label: z.string().optional().default(""),
  nodeCount: z.number().int().min(0).optional().default(0),
  edgeCount: z.number().int().min(0).optional().default(0),
  snapshotData: z.record(z.unknown()).optional().default({}),
});

export const BulkImportNodeSchema = CreateNodeSchema;
export type BulkImportNode = z.infer<typeof BulkImportNodeSchema>;

export const BulkImportEdgeSchema = CreateEdgeSchema;
export type BulkImportEdge = z.infer<typeof BulkImportEdgeSchema>;

export const BulkImportSchema = z.object({
  nodes: z.array(BulkImportNodeSchema),
  edges: z.array(BulkImportEdgeSchema).optional().default([]),
});
export type BulkImport = z.infer<typeof BulkImportSchema>;

export const SearchByAttributesSchema = z.object({
  nodeType: z.string().min(1).optional(),
  attributes: z.record(z.unknown()),
  limit: z.number().int().positive().max(500).optional().default(50),
});
export type SearchByAttributes = z.infer<typeof SearchByAttributesSchema>;

export const SimilarNodesSchema = z.object({
  nodeId: z.string().uuid(),
  topK: z.number().int().positive().max(100).optional().default(10),
  threshold: z.number().min(0).max(1).optional(),
  model: z.string().optional(),
});

// POST /agent/v1/architect/classify-change — change classification input (ADR A4).
// Accepts a unified diff, file-path list, node types, or node IDs (at least one required).
export const ClassifyChangeSchema = z
  .object({
    diff: z.string().optional(),
    filePaths: z.array(z.string().min(1)).optional(),
    nodeTypes: z.array(z.string().min(1)).optional(),
    nodeIds: z.array(z.string().uuid()).optional(),
  })
  .refine(
    (d) =>
      (d.diff !== undefined && d.diff.length > 0) ||
      (d.filePaths !== undefined && d.filePaths.length > 0) ||
      (d.nodeTypes !== undefined && d.nodeTypes.length > 0) ||
      (d.nodeIds !== undefined && d.nodeIds.length > 0),
    { message: "at least one of diff, filePaths, nodeTypes, or nodeIds is required" }
  );
export type ClassifyChange = z.infer<typeof ClassifyChangeSchema>;

export const NODE_SORT_FIELDS = ["name", "createdAt", "updatedAt", "type", "layer", "lifecycleStatus"] as const;
export type NodeSortField = (typeof NODE_SORT_FIELDS)[number];

export const EDGE_SORT_FIELDS = ["createdAt", "updatedAt", "type", "layer", "traversalWeight"] as const;
export type EdgeSortField = (typeof EDGE_SORT_FIELDS)[number];

export const SORT_ORDER_VALUES = ["asc", "desc"] as const;
export type SortOrder = (typeof SORT_ORDER_VALUES)[number];
