// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { randomUUID } from "node:crypto";
import { decideChange, propagateChange } from "@lsds/framework";
import type { PropagationEdge } from "@lsds/framework";
import type { AnySql } from "./db/client.js";
import type { EdgeRow, NodeRow, StaleFlagRow } from "./db/types.js";

interface DbEdgeRef {
  sourceId: string;
  targetId: string;
  type: string;
}

async function fetchNodeEdgesForPropagation(
  sql: AnySql,
  tenantId: string,
  nodeId: string,
): Promise<PropagationEdge[]> {
  const rows = await sql<DbEdgeRef[]>`
    SELECT source_id, target_id, type FROM edges
    WHERE tenant_id = ${tenantId}
      AND (source_id = ${nodeId} OR target_id = ${nodeId})
      AND lifecycle_status = 'ACTIVE'
  `;
  return rows.map((r): PropagationEdge => ({
    toObjectId: r.sourceId === nodeId ? r.targetId : r.sourceId,
    toObjectType: "node",
    // source→node edge means the source is "above" (UP direction from node's view)
    // node→target edge means the target is "below" (DOWN direction from node's view)
    direction: r.targetId === nodeId ? "UP" : "DOWN",
    relationshipType: r.type,
  }));
}

function edgePropagationEdges(edge: EdgeRow): PropagationEdge[] {
  return [
    {
      toObjectId: edge.sourceId,
      toObjectType: "node",
      direction: "UP",
      relationshipType: edge.type,
    },
    {
      toObjectId: edge.targetId,
      toObjectType: "node",
      direction: "DOWN",
      relationshipType: edge.type,
    },
  ];
}

async function clearOwnStaleFlags(
  sql: AnySql,
  tenantId: string,
  objectId: string,
  objectType: "node" | "edge",
): Promise<void> {
  await sql`
    DELETE FROM stale_flags
    WHERE tenant_id = ${tenantId} AND object_id = ${objectId} AND object_type = ${objectType}
  `;
}

// Propagate a change from a mutated node to its neighbors, persisting stale flags.
// Clears the node's own stale flags first (it just changed, so it is no longer stale).
export async function propagateNodeChange(
  sql: AnySql,
  tenantId: string,
  node: NodeRow,
): Promise<void> {
  const decision = decideChange({ layer: node.layer, kind: "METADATA_CHANGED" });

  // L1–L2 layers produce PENDING_CONFIRMATION — propagation requires explicit confirmation.
  if (decision.status !== "APPLIED") {
    await clearOwnStaleFlags(sql, tenantId, node.id, "node");
    return;
  }

  const edges = await fetchNodeEdgesForPropagation(sql, tenantId, node.id);
  const changeId = randomUUID();
  const flags = propagateChange(
    { changeId, objectId: node.id, objectType: "node", decision, raisedAt: new Date().toISOString() },
    edges,
  );

  await clearOwnStaleFlags(sql, tenantId, node.id, "node");

  for (const flag of flags) {
    await sql`
      INSERT INTO stale_flags
        (tenant_id, source_change_id, object_id, object_type, severity, raised_at, message, via_relationship_type, depth)
      VALUES
        (${tenantId}, ${flag.sourceChangeId}::uuid, ${flag.objectId}::uuid, ${flag.objectType},
         ${flag.severity}, ${new Date(flag.raisedAt)}, ${flag.message}, ${flag.viaRelationshipType}, ${flag.depth})
      ON CONFLICT DO NOTHING
    `;
  }
}

// Propagate a change from a mutated edge to its source/target nodes.
// Clears the edge's own stale flags first.
export async function propagateEdgeChange(
  sql: AnySql,
  tenantId: string,
  edge: EdgeRow,
): Promise<void> {
  const decision = decideChange({ layer: edge.layer, kind: "METADATA_CHANGED" });

  if (decision.status !== "APPLIED") {
    await clearOwnStaleFlags(sql, tenantId, edge.id, "edge");
    return;
  }

  const edges = edgePropagationEdges(edge);
  const changeId = randomUUID();
  const flags = propagateChange(
    { changeId, objectId: edge.id, objectType: "edge", decision, raisedAt: new Date().toISOString() },
    edges,
  );

  await clearOwnStaleFlags(sql, tenantId, edge.id, "edge");

  for (const flag of flags) {
    await sql`
      INSERT INTO stale_flags
        (tenant_id, source_change_id, object_id, object_type, severity, raised_at, message, via_relationship_type, depth)
      VALUES
        (${tenantId}, ${flag.sourceChangeId}::uuid, ${flag.objectId}::uuid, ${flag.objectType},
         ${flag.severity}, ${new Date(flag.raisedAt)}, ${flag.message}, ${flag.viaRelationshipType}, ${flag.depth})
      ON CONFLICT DO NOTHING
    `;
  }
}

export async function fetchStaleFlagsForObject(
  sql: AnySql,
  tenantId: string,
  objectId: string,
  objectType: "node" | "edge",
): Promise<StaleFlagRow[]> {
  return sql<StaleFlagRow[]>`
    SELECT id, tenant_id, source_change_id, object_id, object_type, severity,
           raised_at, message, via_relationship_type, depth, created_at
    FROM stale_flags
    WHERE tenant_id = ${tenantId} AND object_id = ${objectId} AND object_type = ${objectType}
    ORDER BY raised_at DESC
  `;
}
