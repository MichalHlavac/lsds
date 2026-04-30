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

  // ── nodes ──────────────────────────────────────────────────────────────────

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
    if (!row) {
      const current = await this.#nodeStatus(tenantId, nodeId);
      throw new LifecycleTransitionError(current, "deprecate", ALLOWED_TRANSITIONS[current]);
    }
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
        AND lifecycle_status = 'DEPRECATED'
      RETURNING *
    `;
    if (!row) {
      const current = await this.#nodeStatus(tenantId, nodeId);
      throw new LifecycleTransitionError(current, "archive", ALLOWED_TRANSITIONS[current]);
    }

    // Cascade: archive all outgoing edges that aren't already ARCHIVED/PURGE
    const cascaded = await this.sql<Pick<EdgeRow, "id" | "sourceId" | "targetId">[]>`
      UPDATE edges
      SET lifecycle_status = 'ARCHIVED',
          archived_at = now(),
          updated_at = now()
      WHERE source_id = ${nodeId}
        AND tenant_id = ${tenantId}
        AND lifecycle_status NOT IN ('ARCHIVED', 'PURGE')
      RETURNING id, source_id, target_id
    `;
    this.cache.invalidateNode(tenantId, nodeId);
    for (const e of cascaded) {
      this.cache.invalidateEdge(tenantId, e.id, e.sourceId, e.targetId);
    }
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
    if (!row) {
      const current = await this.#nodeStatus(tenantId, nodeId);
      throw new LifecycleTransitionError(current, "purge", ALLOWED_TRANSITIONS[current]);
    }
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

    for (const r of [...deprecated, ...archived]) {
      this.cache.invalidateNode(tenantId, r.id);
    }

    return { deprecated: deprecated.length, archived: archived.length };
  }

  // ── private helpers ────────────────────────────────────────────────────────

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
