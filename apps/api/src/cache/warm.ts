// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { Sql } from "../db/client.js";
import type { NodeRow, EdgeRow } from "../db/types.js";
import type { LsdsCache } from "./index.js";

export async function warmCache(
  sql: Sql,
  cache: LsdsCache,
  limit: number = Number(process.env.CACHE_WARMUP_LIMIT ?? 500)
): Promise<void> {
  const [nodes, edges] = await Promise.all([
    sql<NodeRow[]>`SELECT * FROM nodes ORDER BY updated_at DESC LIMIT ${limit}`,
    sql<EdgeRow[]>`SELECT * FROM edges ORDER BY updated_at DESC LIMIT ${limit}`,
  ]);

  for (const node of nodes) {
    cache.nodes.set(cache.nodeKey(node.tenantId, node.id), node);
  }
  for (const edge of edges) {
    cache.edges.set(cache.edgeKey(edge.tenantId, edge.id), edge);
  }
}
