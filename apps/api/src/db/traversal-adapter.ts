// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { Sql } from "./client.js";

export type TraversalDirection = "outbound" | "inbound" | "both";

export interface TraversalResult {
  nodeId: string;
  depth: number;
  path: string[];
}

export interface TraversalEngine {
  traverse(rootId: string, depth: number): Promise<string[]>;
  traverseWithDepth(
    rootId: string,
    maxDepth: number,
    direction?: TraversalDirection,
    edgeTypes?: string[]
  ): Promise<TraversalResult[]>;
}

export class PostgresTraversalAdapter implements TraversalEngine {
  constructor(private readonly sql: Sql) {}

  async traverse(rootId: string, depth: number): Promise<string[]> {
    const results = await this.traverseWithDepth(rootId, depth, "both");
    return results.map((r) => r.nodeId);
  }

  async traverseWithDepth(
    rootId: string,
    maxDepth: number,
    direction: TraversalDirection = "both",
    edgeTypes?: string[]
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
      if (!existing || r.depth < existing.depth) seen.set(r.nodeId, r);
    }
    return Array.from(seen.values());
  }

  private async outboundCTE(
    rootId: string,
    maxDepth: number,
    edgeTypes?: string[]
  ): Promise<TraversalResult[]> {
    type Row = { node_id: string; depth: number; path: string[] };
    const hasFilter = edgeTypes && edgeTypes.length > 0;
    const rows: Row[] = hasFilter
      ? await this.sql.unsafe(`
          WITH RECURSIVE traversal AS (
            SELECT n.id AS node_id, 0 AS depth, ARRAY[n.id::text] AS path
            FROM nodes n WHERE n.id = $1
            UNION ALL
            SELECT target.id, t.depth + 1, t.path || target.id::text
            FROM traversal t
            JOIN edges e ON e.source_id = t.node_id::uuid AND e.type = ANY($3::text[])
            JOIN nodes target ON target.id = e.target_id
            WHERE t.depth < $2 AND NOT (target.id::text = ANY(t.path))
          )
          SELECT node_id, depth, path FROM traversal ORDER BY depth, node_id
        `, [rootId, maxDepth, edgeTypes])
      : await this.sql.unsafe(`
          WITH RECURSIVE traversal AS (
            SELECT n.id AS node_id, 0 AS depth, ARRAY[n.id::text] AS path
            FROM nodes n WHERE n.id = $1
            UNION ALL
            SELECT target.id, t.depth + 1, t.path || target.id::text
            FROM traversal t
            JOIN edges e ON e.source_id = t.node_id::uuid
            JOIN nodes target ON target.id = e.target_id
            WHERE t.depth < $2 AND NOT (target.id::text = ANY(t.path))
          )
          SELECT node_id, depth, path FROM traversal ORDER BY depth, node_id
        `, [rootId, maxDepth]);
    // Deduplicate: keep the shortest-depth entry per node (same as bidirectional merge).
    const seen = new Map<string, TraversalResult>();
    for (const r of rows) {
      const existing = seen.get(r.node_id);
      if (!existing || r.depth < existing.depth) {
        seen.set(r.node_id, { nodeId: r.node_id, depth: r.depth, path: r.path });
      }
    }
    return Array.from(seen.values());
  }

  private async inboundCTE(
    rootId: string,
    maxDepth: number,
    edgeTypes?: string[]
  ): Promise<TraversalResult[]> {
    type Row = { node_id: string; depth: number; path: string[] };
    const hasFilter = edgeTypes && edgeTypes.length > 0;
    const rows: Row[] = hasFilter
      ? await this.sql.unsafe(`
          WITH RECURSIVE traversal AS (
            SELECT n.id AS node_id, 0 AS depth, ARRAY[n.id::text] AS path
            FROM nodes n WHERE n.id = $1
            UNION ALL
            SELECT source.id, t.depth + 1, t.path || source.id::text
            FROM traversal t
            JOIN edges e ON e.target_id = t.node_id::uuid AND e.type = ANY($3::text[])
            JOIN nodes source ON source.id = e.source_id
            WHERE t.depth < $2 AND NOT (source.id::text = ANY(t.path))
          )
          SELECT node_id, depth, path FROM traversal ORDER BY depth, node_id
        `, [rootId, maxDepth, edgeTypes])
      : await this.sql.unsafe(`
          WITH RECURSIVE traversal AS (
            SELECT n.id AS node_id, 0 AS depth, ARRAY[n.id::text] AS path
            FROM nodes n WHERE n.id = $1
            UNION ALL
            SELECT source.id, t.depth + 1, t.path || source.id::text
            FROM traversal t
            JOIN edges e ON e.target_id = t.node_id::uuid
            JOIN nodes source ON source.id = e.source_id
            WHERE t.depth < $2 AND NOT (source.id::text = ANY(t.path))
          )
          SELECT node_id, depth, path FROM traversal ORDER BY depth, node_id
        `, [rootId, maxDepth]);
    // Deduplicate: keep the shortest-depth entry per node.
    const seen = new Map<string, TraversalResult>();
    for (const r of rows) {
      const existing = seen.get(r.node_id);
      if (!existing || r.depth < existing.depth) {
        seen.set(r.node_id, { nodeId: r.node_id, depth: r.depth, path: r.path });
      }
    }
    return Array.from(seen.values());
  }
}
