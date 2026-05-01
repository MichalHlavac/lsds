// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { Sql } from "./client.js";
import type { EdgeRow, HistoryOp, NodeRow } from "./types.js";

type JsonArg = Parameters<Sql["json"]>[0];

export async function recordNodeHistory(
  sql: Sql,
  tenantId: string,
  nodeId: string,
  op: HistoryOp,
  previous: NodeRow | null,
  current: NodeRow
): Promise<void> {
  await sql`
    INSERT INTO node_history (node_id, tenant_id, op, previous, current)
    VALUES (
      ${nodeId},
      ${tenantId},
      ${op},
      ${previous ? sql.json(previous as unknown as JsonArg) : null},
      ${sql.json(current as unknown as JsonArg)}
    )
  `;
}

export async function recordEdgeHistory(
  sql: Sql,
  tenantId: string,
  edgeId: string,
  op: HistoryOp,
  previous: EdgeRow | null,
  current: EdgeRow
): Promise<void> {
  await sql`
    INSERT INTO edge_history (edge_id, tenant_id, op, previous, current)
    VALUES (
      ${edgeId},
      ${tenantId},
      ${op},
      ${previous ? sql.json(previous as unknown as JsonArg) : null},
      ${sql.json(current as unknown as JsonArg)}
    )
  `;
}
