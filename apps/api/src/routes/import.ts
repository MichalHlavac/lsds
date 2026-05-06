// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { validateRelationshipEdge } from "@lsds/framework";
import type { Sql } from "../db/client.js";
import type { EdgeRow, NodeRow } from "../db/types.js";
import { BulkImportSchema } from "./schemas.js";
import { getTenantId, jsonb } from "./util.js";

class BulkImportError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly violations?: Array<{ ruleKey: string; severity: string; message: string }>
  ) {
    super(message);
    this.name = "BulkImportError";
  }
}

export function importRouter(sql: Sql): Hono {
  const app = new Hono();

  app.post("/bulk", async (c) => {
    const tenantId = getTenantId(c);
    const body = BulkImportSchema.parse(await c.req.json());

    try {
      const result = await sql.begin(async (tx) => {
        const txSql = tx as unknown as Sql;
        const createdNodeIds: string[] = [];
        const createdEdgeIds: string[] = [];

        for (const node of body.nodes) {
          const [row] = await tx<NodeRow[]>`
            INSERT INTO nodes (tenant_id, type, layer, name, version, lifecycle_status, attributes)
            VALUES (
              ${tenantId}, ${node.type}, ${node.layer}, ${node.name},
              ${node.version}, ${node.lifecycleStatus}, ${jsonb(txSql, node.attributes)}
            )
            RETURNING *
          `;
          await tx`
            INSERT INTO node_history (node_id, tenant_id, op, previous, current)
            VALUES (
              ${row.id}, ${tenantId}, 'CREATE', NULL,
              ${jsonb(txSql, row as unknown as Record<string, unknown>)}
            )
          `;
          createdNodeIds.push(row.id);
        }

        for (const edge of body.edges) {
          const [sourceNode] = await tx<Pick<NodeRow, "id" | "layer">[]>`
            SELECT id, layer FROM nodes WHERE id = ${edge.sourceId} AND tenant_id = ${tenantId}
          `;
          if (!sourceNode) {
            throw new BulkImportError(`source node not found: ${edge.sourceId}`, 422);
          }

          const [targetNode] = await tx<Pick<NodeRow, "id" | "layer">[]>`
            SELECT id, layer FROM nodes WHERE id = ${edge.targetId} AND tenant_id = ${tenantId}
          `;
          if (!targetNode) {
            throw new BulkImportError(`target node not found: ${edge.targetId}`, 422);
          }

          const validationIssues = validateRelationshipEdge({
            type: edge.type,
            sourceLayer: sourceNode.layer,
            targetLayer: targetNode.layer,
          });
          if (validationIssues.length > 0) {
            throw new BulkImportError(
              "invalid edge: cross-layer guardrail violation",
              422,
              validationIssues.map((i) => ({ ruleKey: "GR-XL-003", severity: "ERROR", message: i.message }))
            );
          }

          const [row] = await tx<EdgeRow[]>`
            INSERT INTO edges (tenant_id, source_id, target_id, type, layer, traversal_weight, attributes)
            VALUES (
              ${tenantId}, ${edge.sourceId}, ${edge.targetId}, ${edge.type},
              ${edge.layer}, ${edge.traversalWeight}, ${jsonb(txSql, edge.attributes)}
            )
            RETURNING *
          `;
          await tx`
            INSERT INTO edge_history (edge_id, tenant_id, op, previous, current)
            VALUES (
              ${row.id}, ${tenantId}, 'CREATE', NULL,
              ${jsonb(txSql, row as unknown as Record<string, unknown>)}
            )
          `;
          createdEdgeIds.push(row.id);
        }

        return { nodes: createdNodeIds, edges: createdEdgeIds };
      });

      return c.json({ data: { created: result, errors: [] } }, 201);
    } catch (err: unknown) {
      if (err instanceof BulkImportError) {
        return c.json(
          {
            error: err.message,
            ...(err.violations ? { violations: err.violations } : {}),
          },
          err.statusCode as 422
        );
      }
      const pgErr = err as { code?: string };
      if (pgErr.code === "23505") {
        return c.json(
          { error: "duplicate item in batch; (type, layer, name) must be unique per node and (sourceId, targetId, type) must be unique per edge" },
          409
        );
      }
      throw err;
    }
  });

  return app;
}
