// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import {
  DefaultTraversalEngine,
  type TraversalEngine,
  type TraversalOptions,
  type ContextPackage,
} from "@lsds/framework";
import { PostgresGraphRepository } from "./graph-repository.js";
import type { Sql } from "./client.js";

export type TraversalDirection = "outbound" | "inbound" | "both";

export interface TraversalResult {
  nodeId: string;
  depth: number;
  path: string[];
  totalCost: number;
}

/**
 * Postgres implementation of TraversalEngine (framework interface, kap. 8 + ADR A1).
 *
 * traverse() delegates to DefaultTraversalEngine over PostgresGraphRepository.
 * traverseWithDepth() provides CTE-based raw traversal for the REST traversal route.
 * similarNodes() uses pgvector cosine distance (A10).
 */
export class PostgresTraversalAdapter implements TraversalEngine {
  private readonly repo: PostgresGraphRepository;
  private readonly engine: DefaultTraversalEngine;

  constructor(
    private readonly sql: Sql,
    private readonly tenantId: string,
  ) {
    this.repo = new PostgresGraphRepository(sql, tenantId);
    this.engine = new DefaultTraversalEngine(this.repo);
  }

  async traverse(rootId: string, options?: TraversalOptions): Promise<ContextPackage> {
    return this.engine.traverse(rootId, options);
  }

  async similarNodes(
    rootId: string,
    topK = 10,
    threshold = 0,
  ): Promise<Array<{ nodeId: string; score: number }>> {
    const [embRow] = await this.sql<[{ embedding: string | null }]>`
      SELECT embedding::text AS embedding FROM nodes
      WHERE id = ${rootId} AND tenant_id = ${this.tenantId}
    `;
    const emb = embRow?.embedding;
    if (!emb) return [];
    const rows = await this.sql<Array<{ id: string; score: number }>>`
      SELECT id, (1 - (embedding <=> ${emb}::vector))::float AS score
      FROM nodes
      WHERE tenant_id = ${this.tenantId}
        AND id != ${rootId}
        AND embedding IS NOT NULL
        AND lifecycle_status NOT IN ('ARCHIVED', 'PURGE')
      ORDER BY embedding <=> ${emb}::vector
      LIMIT ${topK}
    `;
    return rows
      .filter((r) => r.score >= threshold)
      .map((r) => ({ nodeId: r.id, score: r.score }));
  }

  // CTE-based raw traversal — used by the REST traversal route and knowledge context.
  // Not part of the framework TraversalEngine interface; complements traverse() with
  // direction/edge-type filtering and cost-aware deduplication.
  async traverseWithDepth(
    rootId: string,
    maxDepth: number,
    direction: TraversalDirection = "both",
    edgeTypes?: string[],
  ): Promise<TraversalResult[]> {
    if (direction === "outbound") {
      return this.outboundCTE(rootId, maxDepth, edgeTypes);
    }
    if (direction === "inbound") {
      return this.inboundCTE(rootId, maxDepth, edgeTypes);
    }
    const [out, inn] = await Promise.all([
      this.outboundCTE(rootId, maxDepth, edgeTypes),
      this.inboundCTE(rootId, maxDepth, edgeTypes),
    ]);
    const seen = new Map<string, TraversalResult>();
    for (const r of [...out, ...inn]) {
      const existing = seen.get(r.nodeId);
      if (
        !existing ||
        r.totalCost < existing.totalCost ||
        (r.totalCost === existing.totalCost && r.depth < existing.depth)
      ) {
        seen.set(r.nodeId, r);
      }
    }
    return Array.from(seen.values());
  }

  private async outboundCTE(
    rootId: string,
    maxDepth: number,
    edgeTypes?: string[],
  ): Promise<TraversalResult[]> {
    // Use a quoted alias "nodeId" so the column name is stable regardless of
    // whether the postgres connection has the camelCase transform enabled.
    type Row = { nodeId: string; depth: number; path: string[]; totalCost: number };
    const hasFilter = edgeTypes && edgeTypes.length > 0;
    const rows: Row[] = hasFilter
      ? await this.sql.unsafe(
          `
          WITH RECURSIVE traversal AS (
            SELECT n.id AS "nodeId", 0 AS depth, ARRAY[n.id::text] AS path, 0.0::float AS "totalCost"
            FROM nodes n WHERE n.id = $1 AND n.tenant_id = $4::uuid
            UNION ALL
            SELECT target.id, t.depth + 1, t.path || target.id::text, t."totalCost" + e.traversal_weight
            FROM traversal t
            JOIN edges e ON e.source_id = t."nodeId"::uuid AND e.type = ANY($3::text[]) AND e.tenant_id = $4::uuid
            JOIN nodes target ON target.id = e.target_id AND target.tenant_id = $4::uuid
            WHERE t.depth < $2 AND NOT (target.id::text = ANY(t.path))
          )
          SELECT "nodeId", depth, path, "totalCost" FROM traversal ORDER BY "totalCost", depth, "nodeId"
        `,
          [rootId, maxDepth, edgeTypes, this.tenantId],
        )
      : await this.sql.unsafe(
          `
          WITH RECURSIVE traversal AS (
            SELECT n.id AS "nodeId", 0 AS depth, ARRAY[n.id::text] AS path, 0.0::float AS "totalCost"
            FROM nodes n WHERE n.id = $1 AND n.tenant_id = $3::uuid
            UNION ALL
            SELECT target.id, t.depth + 1, t.path || target.id::text, t."totalCost" + e.traversal_weight
            FROM traversal t
            JOIN edges e ON e.source_id = t."nodeId"::uuid AND e.tenant_id = $3::uuid
            JOIN nodes target ON target.id = e.target_id AND target.tenant_id = $3::uuid
            WHERE t.depth < $2 AND NOT (target.id::text = ANY(t.path))
          )
          SELECT "nodeId", depth, path, "totalCost" FROM traversal ORDER BY "totalCost", depth, "nodeId"
        `,
          [rootId, maxDepth, this.tenantId],
        );
    const seen = new Map<string, TraversalResult>();
    for (const r of rows) {
      const existing = seen.get(r.nodeId);
      if (
        !existing ||
        r.totalCost < existing.totalCost ||
        (r.totalCost === existing.totalCost && r.depth < existing.depth)
      ) {
        seen.set(r.nodeId, {
          nodeId: r.nodeId,
          depth: r.depth,
          path: r.path,
          totalCost: r.totalCost,
        });
      }
    }
    return Array.from(seen.values());
  }

  private async inboundCTE(
    rootId: string,
    maxDepth: number,
    edgeTypes?: string[],
  ): Promise<TraversalResult[]> {
    type Row = { nodeId: string; depth: number; path: string[]; totalCost: number };
    const hasFilter = edgeTypes && edgeTypes.length > 0;
    const rows: Row[] = hasFilter
      ? await this.sql.unsafe(
          `
          WITH RECURSIVE traversal AS (
            SELECT n.id AS "nodeId", 0 AS depth, ARRAY[n.id::text] AS path, 0.0::float AS "totalCost"
            FROM nodes n WHERE n.id = $1 AND n.tenant_id = $4::uuid
            UNION ALL
            SELECT source.id, t.depth + 1, t.path || source.id::text, t."totalCost" + e.traversal_weight
            FROM traversal t
            JOIN edges e ON e.target_id = t."nodeId"::uuid AND e.type = ANY($3::text[]) AND e.tenant_id = $4::uuid
            JOIN nodes source ON source.id = e.source_id AND source.tenant_id = $4::uuid
            WHERE t.depth < $2 AND NOT (source.id::text = ANY(t.path))
          )
          SELECT "nodeId", depth, path, "totalCost" FROM traversal ORDER BY "totalCost", depth, "nodeId"
        `,
          [rootId, maxDepth, edgeTypes, this.tenantId],
        )
      : await this.sql.unsafe(
          `
          WITH RECURSIVE traversal AS (
            SELECT n.id AS "nodeId", 0 AS depth, ARRAY[n.id::text] AS path, 0.0::float AS "totalCost"
            FROM nodes n WHERE n.id = $1 AND n.tenant_id = $3::uuid
            UNION ALL
            SELECT source.id, t.depth + 1, t.path || source.id::text, t."totalCost" + e.traversal_weight
            FROM traversal t
            JOIN edges e ON e.target_id = t."nodeId"::uuid AND e.tenant_id = $3::uuid
            JOIN nodes source ON source.id = e.source_id AND source.tenant_id = $3::uuid
            WHERE t.depth < $2 AND NOT (source.id::text = ANY(t.path))
          )
          SELECT "nodeId", depth, path, "totalCost" FROM traversal ORDER BY "totalCost", depth, "nodeId"
        `,
          [rootId, maxDepth, this.tenantId],
        );
    const seen = new Map<string, TraversalResult>();
    for (const r of rows) {
      const existing = seen.get(r.nodeId);
      if (
        !existing ||
        r.totalCost < existing.totalCost ||
        (r.totalCost === existing.totalCost && r.depth < existing.depth)
      ) {
        seen.set(r.nodeId, {
          nodeId: r.nodeId,
          depth: r.depth,
          path: r.path,
          totalCost: r.totalCost,
        });
      }
    }
    return Array.from(seen.values());
  }
}
