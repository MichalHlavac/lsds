// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { Layer, LifecycleStatus, Severity } from "@lsds/shared";
export type { Layer, LifecycleStatus, Severity };
export type UserRole = "admin" | "editor" | "viewer";

export interface NodeRow {
  id: string;
  tenantId: string;
  type: string;
  layer: Layer;
  name: string;
  version: string;
  lifecycleStatus: LifecycleStatus;
  attributes: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deprecatedAt: Date | null;
  archivedAt: Date | null;
  purgeAfter: Date | null;
}

export interface EdgeRow {
  id: string;
  tenantId: string;
  sourceId: string;
  targetId: string;
  type: string;
  layer: Layer;
  traversalWeight: number;
  lifecycleStatus: LifecycleStatus;
  attributes: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deprecatedAt: Date | null;
  archivedAt: Date | null;
  purgeAfter: Date | null;
}

export interface ViolationRow {
  id: string;
  tenantId: string;
  nodeId: string | null;
  edgeId: string | null;
  sourceNodeId: string | null;
  targetNodeId: string | null;
  ruleKey: string;
  severity: Severity;
  message: string;
  attributes: Record<string, unknown>;
  resolved: boolean;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SnapshotRow {
  id: string;
  tenantId: string;
  label: string;
  nodeCount: number;
  edgeCount: number;
  snapshotData: Record<string, unknown>;
  createdAt: Date;
}

export interface UserRow {
  id: string;
  tenantId: string;
  externalId: string;
  displayName: string;
  email: string | null;
  role: UserRole;
  attributes: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamRow {
  id: string;
  tenantId: string;
  name: string;
  attributes: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type HistoryOp = "CREATE" | "UPDATE" | "LIFECYCLE_TRANSITION";

export interface NodeHistoryRow {
  id: string;
  nodeId: string;
  tenantId: string;
  changedAt: Date;
  changedBy: string | null;
  op: HistoryOp;
  previous: Record<string, unknown> | null;
  current: Record<string, unknown>;
}

export interface EdgeHistoryRow {
  id: string;
  edgeId: string;
  tenantId: string;
  changedAt: Date;
  changedBy: string | null;
  op: HistoryOp;
  previous: Record<string, unknown> | null;
  current: Record<string, unknown>;
}

export interface GuardrailRow {
  id: string;
  tenantId: string;
  ruleKey: string;
  description: string;
  severity: Severity;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MigrationDraftRow {
  id: string;
  tenantId: string;
  sessionId: string;
  sourceRef: string;
  proposedType: string;
  proposedLayer: Layer;
  proposedName: string;
  proposedAttrs: Record<string, unknown>;
  confidence: Record<string, "HIGH" | "MEDIUM" | "LOW">;
  owner: string;
  reviewFlags: string[];
  status: "pending" | "approved" | "rejected";
  reviewedAt: Date | null;
  committedNodeId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
