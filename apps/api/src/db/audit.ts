// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { AnySql } from "./client.js";
import type { AuditDiff, AuditOperation, EdgeRow, NodeRow } from "./types.js";
import { jsonb } from "../routes/util.js";

export type { AuditDiff, AuditOperation };

export async function insertAuditLog(
  sql: AnySql,
  tenantId: string,
  apiKeyId: string | null,
  operation: AuditOperation,
  entityType: string,
  entityId: string,
  diff: AuditDiff | null,
): Promise<string> {
  const [row] = await sql<[{ id: string }]>`
    INSERT INTO audit_log (tenant_id, api_key_id, operation, entity_type, entity_id, diff)
    VALUES (
      ${tenantId},
      ${apiKeyId},
      ${operation},
      ${entityType},
      ${entityId},
      ${diff ? jsonb(sql, diff) : null}
    )
    RETURNING id
  `;
  return row!.id;
}

// ── diff builders ─────────────────────────────────────────────────────────────

export function nodeCreateDiff(row: NodeRow): AuditDiff {
  return {
    before: null,
    after: {
      type: row.type,
      layer: row.layer,
      name: row.name,
      version: row.version,
      lifecycleStatus: row.lifecycleStatus,
      attributes: row.attributes,
    },
  };
}

export function nodeUpdateDiff(prev: NodeRow, curr: NodeRow): AuditDiff {
  const keys = ["name", "version", "lifecycleStatus", "attributes", "ownerId", "ownerName"] as const;
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const k of keys) {
    if (JSON.stringify(prev[k]) !== JSON.stringify(curr[k])) {
      before[k] = prev[k];
      after[k] = curr[k];
    }
  }
  return { before, after };
}

export function nodeDeleteDiff(row: NodeRow): AuditDiff {
  return {
    before: { type: row.type, name: row.name, lifecycleStatus: row.lifecycleStatus },
    after: null,
  };
}

export function nodeLifecycleDiff(prev: NodeRow, curr: NodeRow | null): AuditDiff {
  if (!curr) {
    return { before: { lifecycleStatus: prev.lifecycleStatus }, after: null };
  }
  const before: Record<string, unknown> = { lifecycleStatus: prev.lifecycleStatus };
  const after: Record<string, unknown> = { lifecycleStatus: curr.lifecycleStatus };
  if (String(curr.deprecatedAt) !== String(prev.deprecatedAt)) after.deprecatedAt = curr.deprecatedAt;
  if (String(curr.archivedAt) !== String(prev.archivedAt)) after.archivedAt = curr.archivedAt;
  if (String(curr.purgeAfter) !== String(prev.purgeAfter)) after.purgeAfter = curr.purgeAfter;
  return { before, after };
}

export function edgeCreateDiff(row: EdgeRow): AuditDiff {
  return {
    before: null,
    after: {
      type: row.type,
      layer: row.layer,
      sourceId: row.sourceId,
      targetId: row.targetId,
      traversalWeight: row.traversalWeight,
      attributes: row.attributes,
    },
  };
}

export function edgeUpdateDiff(prev: EdgeRow, curr: EdgeRow): AuditDiff {
  const keys = ["type", "traversalWeight", "attributes"] as const;
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const k of keys) {
    if (JSON.stringify(prev[k]) !== JSON.stringify(curr[k])) {
      before[k] = prev[k];
      after[k] = curr[k];
    }
  }
  return { before, after };
}

export function edgeDeleteDiff(row: EdgeRow): AuditDiff {
  return {
    before: { type: row.type, sourceId: row.sourceId, targetId: row.targetId },
    after: null,
  };
}
