// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { canTransitionLifecycle } from "@lsds/framework";
import type { Sql } from "../db/client.js";
import type { LsdsCache } from "../cache/index.js";
import type { NodeRow, EdgeRow, LifecycleStatus } from "../db/types.js";

export interface RetentionPolicy {
  deprecatedToArchivedDays: number;
  archivedToPurgeDays: number;
}

const DEFAULT_RETENTION: RetentionPolicy = {
  deprecatedToArchivedDays: 365,
  archivedToPurgeDays: 365,
};

export class LifecycleTransitionError extends Error {
  constructor(
    message: string,
    public readonly from: string,
    public readonly to: string
  ) {
    super(message);
    this.name = "LifecycleTransitionError";
  }
}

export class LifecycleService {
  constructor(
    private readonly sql: Sql,
    private readonly cache: LsdsCache,
    private readonly retention: RetentionPolicy = DEFAULT_RETENTION
  ) {}

  // ── Node lifecycle ─────────────────────────────────────────────────────────

  async deprecate(tenantId: string, nodeId: string): Promise<NodeRow> {
    const [row] = await this.sql<NodeRow[]>`
      UPDATE nodes
      SET lifecycle_status = 'DEPRECATED',
          deprecated_at = now(),
          updated_at = now()
      WHERE id = ${nodeId} AND tenant_id = ${tenantId}
        AND lifecycle_status = 'ACTIVE'
      RETURNING *
    `;
    if (!row) throw new Error("node not found or not ACTIVE");
    this.cache.invalidateNode(tenantId, nodeId);
    return row;
  }

  async archive(tenantId: string, nodeId: string): Promise<NodeRow> {
    const [row] = await this.sql<NodeRow[]>`
      UPDATE nodes
      SET lifecycle_status = 'ARCHIVED',
          archived_at = now(),
          updated_at = now()
      WHERE id = ${nodeId} AND tenant_id = ${tenantId}
        AND lifecycle_status IN ('ACTIVE', 'DEPRECATED')
      RETURNING *
    `;
    if (!row) throw new Error("node not found or already archived/purged");
    this.cache.invalidateNode(tenantId, nodeId);
    return row;
  }

  async markForPurge(tenantId: string, nodeId: string, purgeAfterDays?: number): Promise<NodeRow> {
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
    if (!row) throw new Error("node not found or not ARCHIVED");
    this.cache.invalidateNode(tenantId, nodeId);
    return row;
  }

  async purge(tenantId: string, nodeId: string): Promise<void> {
    const [row] = await this.sql<{ id: string }[]>`
      DELETE FROM nodes
      WHERE id = ${nodeId} AND tenant_id = ${tenantId}
        AND lifecycle_status = 'PURGE'
        AND (purge_after IS NULL OR purge_after <= now())
      RETURNING id
    `;
    if (!row) throw new Error("node not eligible for purge");
    this.cache.invalidateNode(tenantId, nodeId);
  }

  async transitionNode(tenantId: string, nodeId: string, to: LifecycleStatus): Promise<NodeRow> {
    const [current] = await this.sql<{ lifecycle_status: string }[]>`
      SELECT lifecycle_status FROM nodes WHERE id = ${nodeId} AND tenant_id = ${tenantId}
    `;
    if (!current) throw new Error("node not found");

    const from = current.lifecycle_status as LifecycleStatus;
    if (!canTransitionLifecycle(from, to)) {
      throw new LifecycleTransitionError(
        `invalid lifecycle transition: ${from} → ${to}`,
        from,
        to
      );
    }

    if (to === "DEPRECATED") return this.deprecate(tenantId, nodeId);
    if (to === "ARCHIVED") return this.archive(tenantId, nodeId);
    if (to === "PURGE") return this.markForPurge(tenantId, nodeId);
    throw new LifecycleTransitionError(`transition to ${to} not supported via this endpoint`, from, to);
  }

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

    for (const r of [...deprecated, ...archived]) {
      this.cache.invalidateNode(tenantId, r.id);
    }

    return { deprecated: deprecated.length, archived: archived.length };
  }

  // ── Edge lifecycle ─────────────────────────────────────────────────────────

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
    if (!row) throw new Error("edge not found or not ACTIVE");
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
        AND lifecycle_status IN ('ACTIVE', 'DEPRECATED')
      RETURNING *
    `;
    if (!row) throw new Error("edge not found or already archived/purged");
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
    if (!row) throw new Error("edge not found or not ARCHIVED");
    this.cache.invalidateEdge(tenantId, edgeId, row.sourceId, row.targetId);
    return row;
  }

  async transitionEdge(tenantId: string, edgeId: string, to: LifecycleStatus): Promise<EdgeRow> {
    const [current] = await this.sql<{ lifecycle_status: string }[]>`
      SELECT lifecycle_status FROM edges WHERE id = ${edgeId} AND tenant_id = ${tenantId}
    `;
    if (!current) throw new Error("edge not found");

    const from = current.lifecycle_status as LifecycleStatus;
    if (!canTransitionLifecycle(from, to)) {
      throw new LifecycleTransitionError(
        `invalid lifecycle transition: ${from} → ${to}`,
        from,
        to
      );
    }

    if (to === "DEPRECATED") return this.deprecateEdge(tenantId, edgeId);
    if (to === "ARCHIVED") return this.archiveEdge(tenantId, edgeId);
    if (to === "PURGE") return this.markEdgeForPurge(tenantId, edgeId);
    throw new LifecycleTransitionError(`transition to ${to} not supported via this endpoint`, from, to);
  }
}
