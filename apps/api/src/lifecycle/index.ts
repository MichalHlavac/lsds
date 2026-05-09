// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { Sql } from "../db/client.js";
import type { LsdsCache } from "../cache/index.js";
import type { EdgeRow, LifecycleStatus, NodeRow } from "../db/types.js";

export type LifecycleTransitionName = "deprecate" | "archive" | "purge";

const ALLOWED_TRANSITIONS: Record<LifecycleStatus, LifecycleTransitionName[]> = {
  ACTIVE: ["deprecate"],
  DEPRECATED: ["archive"],
  ARCHIVED: ["purge"],
  PURGE: [],
};

export class LifecycleTransitionError extends Error {
  constructor(
    public readonly currentStatus: LifecycleStatus,
    public readonly requestedTransition: string,
    public readonly allowed: LifecycleTransitionName[]
  ) {
    super(
      `Cannot '${requestedTransition}' from ${currentStatus}. Allowed: ${allowed.join(", ") || "none"}`
    );
  }
}

export interface RetentionPolicy {
  deprecatedToArchivedDays: number;
  archivedToPurgeDays: number;
}

const DEFAULT_RETENTION: RetentionPolicy = {
  deprecatedToArchivedDays: 365,
  archivedToPurgeDays: 730,
};

export class LifecycleService {
  constructor(
    private readonly sql: Sql,
    private readonly cache: LsdsCache,
    private readonly retention: RetentionPolicy = DEFAULT_RETENTION
  ) {}

  // Returns a LifecycleService whose writes execute on txSql, enabling callers
  // to include lifecycle mutations in an outer sql.begin() transaction.
  withTransaction(txSql: Sql): LifecycleService {
    return new LifecycleService(txSql, this.cache, this.retention);
  }

  // ── nodes ──────────────────────────────────────────────────────────────────

  async deprecate(tenantId: string, nodeId: string): Promise<NodeRow> {
    const neighborIds = await this.#fetchNeighborIds(tenantId, nodeId);
    const [row] = await this.sql<NodeRow[]>`
      UPDATE nodes
      SET lifecycle_status = 'DEPRECATED',
          deprecated_at = now(),
          updated_at = now()
      WHERE id = ${nodeId} AND tenant_id = ${tenantId}
        AND lifecycle_status = 'ACTIVE'
      RETURNING *
    `;
    if (!row) {
      const current = await this.#nodeStatus(tenantId, nodeId);
      throw new LifecycleTransitionError(current, "deprecate", ALLOWED_TRANSITIONS[current]);
    }
    this.cache.invalidateNode(tenantId, nodeId, neighborIds);
    return row;
  }

  async archive(tenantId: string, nodeId: string): Promise<NodeRow> {
    const [row] = await this.sql<NodeRow[]>`
      UPDATE nodes
      SET lifecycle_status = 'ARCHIVED',
          archived_at = now(),
          updated_at = now()
      WHERE id = ${nodeId} AND tenant_id = ${tenantId}
        AND lifecycle_status = 'DEPRECATED'
      RETURNING *
    `;
    if (!row) {
      const current = await this.#nodeStatus(tenantId, nodeId);
      throw new LifecycleTransitionError(current, "archive", ALLOWED_TRANSITIONS[current]);
    }

    // Cascade: archive all edges that touch this node (outgoing and incoming)
    // that aren't already ARCHIVED/PURGE. Incoming edges to an archived node are
    // dangling references — structural integrity requires they follow the node.
    const cascaded = await this.sql<Pick<EdgeRow, "id" | "sourceId" | "targetId">[]>`
      UPDATE edges
      SET lifecycle_status = 'ARCHIVED',
          archived_at = now(),
          updated_at = now()
      WHERE (source_id = ${nodeId} OR target_id = ${nodeId})
        AND tenant_id = ${tenantId}
        AND lifecycle_status NOT IN ('ARCHIVED', 'PURGE')
      RETURNING id, source_id, target_id
    `;
    const neighborIds = [...new Set(cascaded.flatMap(e => [e.sourceId, e.targetId]).filter(id => id !== nodeId))];
    this.cache.invalidateNode(tenantId, nodeId, neighborIds);
    for (const e of cascaded) {
      this.cache.invalidateEdge(tenantId, e.id, e.sourceId, e.targetId);
    }
    return row;
  }

  async markForPurge(tenantId: string, nodeId: string, purgeAfterDays?: number): Promise<NodeRow> {
    const neighborIds = await this.#fetchNeighborIds(tenantId, nodeId);
    const days = purgeAfterDays ?? this.retention.archivedToPurgeDays;
    const [row] = await this.sql<NodeRow[]>`
      UPDATE nodes
      SET lifecycle_status = 'PURGE',
          purge_after = now() + (${days} || ' days')::interval,
          updated_at = now()
      WHERE id = ${nodeId} AND tenant_id = ${tenantId}
        AND lifecycle_status = 'ARCHIVED'
      RETURNING *
    `;
    if (!row) {
      const current = await this.#nodeStatus(tenantId, nodeId);
      throw new LifecycleTransitionError(current, "purge", ALLOWED_TRANSITIONS[current]);
    }
    this.cache.invalidateNode(tenantId, nodeId, neighborIds);
    return row;
  }

  async purge(tenantId: string, nodeId: string): Promise<void> {
    const neighborIds = await this.#fetchNeighborIds(tenantId, nodeId);
    const [row] = await this.sql<{ id: string }[]>`
      DELETE FROM nodes
      WHERE id = ${nodeId} AND tenant_id = ${tenantId}
        AND lifecycle_status = 'PURGE'
        AND (purge_after IS NULL OR purge_after <= now())
      RETURNING id
    `;
    if (!row) throw new Error("node not eligible for purge");
    this.cache.invalidateNode(tenantId, nodeId, neighborIds);
  }

  async transitionNode(
    tenantId: string,
    nodeId: string,
    transition: LifecycleTransitionName
  ): Promise<NodeRow> {
    switch (transition) {
      case "deprecate": return this.deprecate(tenantId, nodeId);
      case "archive":   return this.archive(tenantId, nodeId);
      case "purge":     return this.markForPurge(tenantId, nodeId);
    }
  }

  // ── edges ──────────────────────────────────────────────────────────────────

  async deprecateEdge(tenantId: string, edgeId: string): Promise<EdgeRow> {
    const [row] = await this.sql<EdgeRow[]>`
      UPDATE edges
      SET lifecycle_status = 'DEPRECATED',
          deprecated_at = now(),
          updated_at = now()
      WHERE id = ${edgeId} AND tenant_id = ${tenantId}
        AND lifecycle_status = 'ACTIVE'
      RETURNING *
    `;
    if (!row) {
      const current = await this.#edgeStatus(tenantId, edgeId);
      throw new LifecycleTransitionError(current, "deprecate", ALLOWED_TRANSITIONS[current]);
    }
    this.cache.invalidateEdge(tenantId, edgeId, row.sourceId, row.targetId);
    return row;
  }

  async archiveEdge(tenantId: string, edgeId: string): Promise<EdgeRow> {
    const [row] = await this.sql<EdgeRow[]>`
      UPDATE edges
      SET lifecycle_status = 'ARCHIVED',
          archived_at = now(),
          updated_at = now()
      WHERE id = ${edgeId} AND tenant_id = ${tenantId}
        AND lifecycle_status = 'DEPRECATED'
      RETURNING *
    `;
    if (!row) {
      const current = await this.#edgeStatus(tenantId, edgeId);
      throw new LifecycleTransitionError(current, "archive", ALLOWED_TRANSITIONS[current]);
    }
    this.cache.invalidateEdge(tenantId, edgeId, row.sourceId, row.targetId);
    return row;
  }

  async markEdgeForPurge(tenantId: string, edgeId: string, purgeAfterDays?: number): Promise<EdgeRow> {
    const days = purgeAfterDays ?? this.retention.archivedToPurgeDays;
    const [row] = await this.sql<EdgeRow[]>`
      UPDATE edges
      SET lifecycle_status = 'PURGE',
          purge_after = now() + (${days} || ' days')::interval,
          updated_at = now()
      WHERE id = ${edgeId} AND tenant_id = ${tenantId}
        AND lifecycle_status = 'ARCHIVED'
      RETURNING *
    `;
    if (!row) {
      const current = await this.#edgeStatus(tenantId, edgeId);
      throw new LifecycleTransitionError(current, "purge", ALLOWED_TRANSITIONS[current]);
    }
    this.cache.invalidateEdge(tenantId, edgeId, row.sourceId, row.targetId);
    return row;
  }

  async transitionEdge(
    tenantId: string,
    edgeId: string,
    transition: LifecycleTransitionName
  ): Promise<EdgeRow> {
    switch (transition) {
      case "deprecate": return this.deprecateEdge(tenantId, edgeId);
      case "archive":   return this.archiveEdge(tenantId, edgeId);
      case "purge":     return this.markEdgeForPurge(tenantId, edgeId);
    }
  }

  // ── retention policy ───────────────────────────────────────────────────────

  async applyRetentionPolicy(tenantId: string): Promise<{ deprecated: number; archived: number }> {
    const deprecated = await this.sql<{ id: string }[]>`
      UPDATE nodes
      SET lifecycle_status = 'ARCHIVED',
          archived_at = now(),
          updated_at = now()
      WHERE tenant_id = ${tenantId}
        AND lifecycle_status = 'DEPRECATED'
        AND deprecated_at <= now() - (${this.retention.deprecatedToArchivedDays} || ' days')::interval
      RETURNING id
    `;
    const archived = await this.sql<{ id: string }[]>`
      UPDATE nodes
      SET lifecycle_status = 'PURGE',
          purge_after = now() + interval '30 days',
          updated_at = now()
      WHERE tenant_id = ${tenantId}
        AND lifecycle_status = 'ARCHIVED'
        AND archived_at <= now() - (${this.retention.archivedToPurgeDays} || ' days')::interval
      RETURNING id
    `;

    const affected = [...deprecated, ...archived];
    if (affected.length > 0) {
      const nodeIds = affected.map(r => r.id);
      const edges = await this.sql<{ sourceId: string; targetId: string }[]>`
        SELECT DISTINCT source_id, target_id FROM edges
        WHERE tenant_id = ${tenantId} AND (source_id = ANY(${nodeIds}) OR target_id = ANY(${nodeIds}))
      `;
      const neighborMap = new Map<string, Set<string>>(nodeIds.map(id => [id, new Set()]));
      for (const e of edges) {
        neighborMap.get(e.sourceId)?.add(e.targetId);
        neighborMap.get(e.targetId)?.add(e.sourceId);
      }
      for (const r of affected) {
        this.cache.invalidateNode(tenantId, r.id, [...(neighborMap.get(r.id) ?? [])]);
      }
    }

    return { deprecated: deprecated.length, archived: archived.length };
  }

  // ── private helpers ────────────────────────────────────────────────────────

  async #fetchNeighborIds(tenantId: string, nodeId: string): Promise<string[]> {
    const rows = await this.sql<{ sourceId: string; targetId: string }[]>`
      SELECT DISTINCT source_id, target_id FROM edges
      WHERE tenant_id = ${tenantId} AND (source_id = ${nodeId} OR target_id = ${nodeId})
    `;
    return [...new Set(rows.flatMap(r => [r.sourceId, r.targetId]).filter(id => id !== nodeId))];
  }

  async #nodeStatus(tenantId: string, nodeId: string): Promise<LifecycleStatus> {
    const [row] = await this.sql<{ lifecycleStatus: LifecycleStatus }[]>`
      SELECT lifecycle_status FROM nodes WHERE id = ${nodeId} AND tenant_id = ${tenantId}
    `;
    if (!row) throw new Error("node not found");
    return row.lifecycleStatus;
  }

  async #edgeStatus(tenantId: string, edgeId: string): Promise<LifecycleStatus> {
    const [row] = await this.sql<{ lifecycleStatus: LifecycleStatus }[]>`
      SELECT lifecycle_status FROM edges WHERE id = ${edgeId} AND tenant_id = ${tenantId}
    `;
    if (!row) throw new Error("edge not found");
    return row.lifecycleStatus;
  }
}
