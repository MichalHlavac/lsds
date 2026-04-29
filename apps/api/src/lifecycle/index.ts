import type { Sql } from "../db/client.js";
import type { LsdsCache } from "../cache/index.js";
import type { NodeRow } from "../db/types.js";

export interface RetentionPolicy {
  deprecatedToArchivedDays: number;
  archivedToPurgeDays: number;
}

const DEFAULT_RETENTION: RetentionPolicy = {
  deprecatedToArchivedDays: 365,
  archivedToPurgeDays: 365,
};

export class LifecycleService {
  constructor(
    private readonly sql: Sql,
    private readonly cache: LsdsCache,
    private readonly retention: RetentionPolicy = DEFAULT_RETENTION
  ) {}

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
}
