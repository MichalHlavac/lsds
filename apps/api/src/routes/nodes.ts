// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { config } from "../config.js";
import type { AnySql, Sql } from "../db/client.js";
import type { LsdsCache } from "../cache/index.js";
import type { NodeHistoryRow, NodeRow } from "../db/types.js";
import { LifecycleTransitionError, type LifecycleService } from "../lifecycle/index.js";
import { recordNodeHistory } from "../db/history.js";
import {
  nodeCreateDiff,
  nodeUpdateDiff,
  nodeDeleteDiff,
  nodeLifecycleDiff,
} from "../db/audit.js";
import { insertAuditLogAndEnqueue } from "../webhooks/hooks.js";
import {
  CreateNodeSchema,
  UpdateNodeSchema,
  LifecycleTransitionSchema,
  BatchLifecycleSchema,
  SearchByAttributesSchema,
  SimilarNodesSchema,
  NODE_SORT_FIELDS,
  SORT_ORDER_VALUES,
  type NodeSortField,
} from "./schemas.js";
import { getTenantId, jsonb, toHttpError, encodeCursor, decodeCursor, parsePaginationLimit } from "./util.js";
import { propagateNodeChange, fetchStaleFlagsForObject } from "../stale-flags.js";
import type { EmbeddingService } from "../embeddings/index.js";
import type { GuardrailsRegistry } from "../guardrails/index.js";
import { getViolationSuggestion, getNamingGuidance } from "../guardrails/naming.js";

export function nodesRouter(
  sql: Sql,
  cache: LsdsCache,
  lifecycle: LifecycleService,
  embeddingService: EmbeddingService | undefined,
  guardrails: GuardrailsRegistry
): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const tenantId = getTenantId(c);
    const q = c.req.query("q");
    const type = c.req.query("type");
    const layer = c.req.query("layer");
    const lifecycleStatus = c.req.query("lifecycleStatus");
    const includeArchived = c.req.query("includeArchived") === "true";
    const limit = parsePaginationLimit(c.req.query("limit"), 50, 500);
    const cursorRaw = c.req.query("cursor");
    const countOpt = c.req.query("count") === "true";
    const sortByRaw = c.req.query("sortBy");
    const orderRaw = c.req.query("order");

    if (sortByRaw && !(NODE_SORT_FIELDS as readonly string[]).includes(sortByRaw)) {
      return c.json({ error: `invalid sortBy: must be one of ${NODE_SORT_FIELDS.join(", ")}` }, 400);
    }
    if (orderRaw && !(SORT_ORDER_VALUES as readonly string[]).includes(orderRaw)) {
      return c.json({ error: "invalid order: must be 'asc' or 'desc'" }, 400);
    }

    let cursor: { v: string; id: string } | null = null;
    if (cursorRaw) {
      cursor = decodeCursor(cursorRaw);
      if (!cursor) return c.json({ error: "invalid cursor" }, 400);
    }

    const sortColMap: Record<NodeSortField, ReturnType<typeof sql>> = {
      name: sql`name`,
      createdAt: sql`created_at`,
      updatedAt: sql`updated_at`,
      type: sql`type`,
      layer: sql`layer`,
      lifecycleStatus: sql`lifecycle_status`,
    };

    const isDesc = (orderRaw ?? (sortByRaw ? "asc" : "desc")) === "desc";
    const sortCol = sortByRaw ? sortColMap[sortByRaw as NodeSortField] : sql`created_at`;
    const sortDirSql = isDesc ? sql`DESC` : sql`ASC`;

    type ColSpec = { colSql: ReturnType<typeof sql>; isTs: boolean; getValue: (row: NodeRow) => string };
    const colSpecMap: Record<NodeSortField, ColSpec> = {
      name:            { colSql: sql`name`,             isTs: false, getValue: (r) => r.name },
      createdAt:       { colSql: sql`created_at`,        isTs: true,  getValue: (r) => r.createdAt.toISOString() },
      updatedAt:       { colSql: sql`updated_at`,        isTs: true,  getValue: (r) => r.updatedAt.toISOString() },
      type:            { colSql: sql`type`,              isTs: false, getValue: (r) => r.type },
      layer:           { colSql: sql`layer`,             isTs: false, getValue: (r) => r.layer },
      lifecycleStatus: { colSql: sql`lifecycle_status`,  isTs: false, getValue: (r) => r.lifecycleStatus },
    };
    const colSpec = colSpecMap[(sortByRaw ?? "createdAt") as NodeSortField];

    const cursorClause = cursor
      ? (() => {
          const { v, id } = cursor;
          const vFrag = colSpec.isTs ? sql`${v}::timestamptz` : sql`${v}`;
          const idFrag = sql`${id}::uuid`;
          return isDesc
            ? sql`AND (${colSpec.colSql} < ${vFrag} OR (${colSpec.colSql} = ${vFrag} AND id > ${idFrag}))`
            : sql`AND (${colSpec.colSql} > ${vFrag} OR (${colSpec.colSql} = ${vFrag} AND id > ${idFrag}))`;
        })()
      : sql``;

    const whereClause = sql`
      WHERE tenant_id = ${tenantId}
        ${q ? sql`AND (name ILIKE ${"%" + q + "%"} OR type ILIKE ${"%" + q + "%"})` : sql``}
        ${type ? sql`AND type = ${type}` : sql``}
        ${layer ? sql`AND layer = ${layer}` : sql``}
        ${lifecycleStatus ? sql`AND lifecycle_status = ${lifecycleStatus}` : !includeArchived ? sql`AND lifecycle_status != 'ARCHIVED'` : sql``}
        ${cursorClause}
    `;

    if (countOpt) {
      const rows = await sql<(NodeRow & { totalCount: string })[]>`
        SELECT *, COUNT(*) OVER()::text AS total_count FROM nodes ${whereClause}
        ORDER BY ${sortCol} ${sortDirSql}, id ASC
        LIMIT ${limit}
      `;
      const nextCursor = rows.length === limit
        ? encodeCursor(colSpec.getValue(rows[rows.length - 1]), rows[rows.length - 1].id)
        : null;
      return c.json({ data: rows.map(({ totalCount: _tc, ...r }) => r), nextCursor, totalCount: Number(rows[0]?.totalCount ?? 0) });
    }

    const rows = await sql<NodeRow[]>`
      SELECT * FROM nodes ${whereClause}
      ORDER BY ${sortCol} ${sortDirSql}, id ASC
      LIMIT ${limit}
    `;
    const nextCursor = rows.length === limit
      ? encodeCursor(colSpec.getValue(rows[rows.length - 1]), rows[rows.length - 1].id)
      : null;
    return c.json({ data: rows, nextCursor });
  });

  app.post("/", async (c) => {
    const tenantId = getTenantId(c);
    const apiKeyId = c.get("apiKeyId") ?? null;
    const body = CreateNodeSchema.parse(await c.req.json());
    const ownerId = (body.owner as { id?: string } | undefined)?.id ?? '';
    const ownerName = (body.owner as { name?: string } | undefined)?.name ?? '';
    try {
      const row = await sql.begin(async (tx) => {
        const db: AnySql = tx;
        const [row] = await db<NodeRow[]>`
          INSERT INTO nodes (tenant_id, type, layer, name, version, lifecycle_status, attributes, owner_id, owner_name)
          VALUES (
            ${tenantId}, ${body.type}, ${body.layer}, ${body.name},
            ${body.version}, ${body.lifecycleStatus}, ${jsonb(db, body.attributes)},
            ${ownerId}, ${ownerName}
          )
          RETURNING *
        `;
        await recordNodeHistory(db, tenantId, row.id, "CREATE", null, row);
        await insertAuditLogAndEnqueue(db, tenantId, apiKeyId, "node.create", row.type, row.id, nodeCreateDiff(row));
        return row;
      });
      embeddingService?.embedNodeAsync(tenantId, row.id, embeddingService.nodeText(row));
      return c.json({ data: row }, 201);
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "23505") {
        return c.json({ error: "node already exists with this type, layer, and name; use PUT to upsert" }, 409);
      }
      throw err;
    }
  });

  app.put("/", async (c) => {
    const tenantId = getTenantId(c);
    const apiKeyId = c.get("apiKeyId") ?? null;
    const body = CreateNodeSchema.parse(await c.req.json());
    const ownerId = (body.owner as { id?: string } | undefined)?.id ?? '';
    const ownerName = (body.owner as { name?: string } | undefined)?.name ?? '';

    const [previous] = await sql<NodeRow[]>`
      SELECT * FROM nodes
      WHERE tenant_id = ${tenantId} AND type = ${body.type} AND layer = ${body.layer} AND name = ${body.name}
    `;

    const row = await sql.begin(async (tx) => {
      const db: AnySql = tx;
      const [row] = await db<NodeRow[]>`
        INSERT INTO nodes (tenant_id, type, layer, name, version, lifecycle_status, attributes, owner_id, owner_name)
        VALUES (
          ${tenantId}, ${body.type}, ${body.layer}, ${body.name},
          ${body.version}, ${body.lifecycleStatus}, ${jsonb(db, body.attributes)},
          ${ownerId}, ${ownerName}
        )
        ON CONFLICT (tenant_id, type, layer, name)
        DO UPDATE SET
          version = EXCLUDED.version,
          attributes = EXCLUDED.attributes,
          owner_id = EXCLUDED.owner_id,
          owner_name = EXCLUDED.owner_name,
          updated_at = now()
        RETURNING *
      `;
      const op = previous ? "UPDATE" : "CREATE";
      await recordNodeHistory(db, tenantId, row.id, op, previous ?? null, row);
      const auditOp = previous ? "node.update" : "node.create";
      const auditDiff = previous ? nodeUpdateDiff(previous, row) : nodeCreateDiff(row);
      await insertAuditLogAndEnqueue(db, tenantId, apiKeyId, auditOp, row.type, row.id, auditDiff);
      return row;
    });
    embeddingService?.embedNodeAsync(tenantId, row.id, embeddingService.nodeText(row));
    if (previous) {
      await propagateNodeChange(sql, tenantId, row);
    }
    return c.json({ data: row }, previous ? 200 : 201);
  });

  app.post("/batch-lifecycle", async (c) => {
    const tenantId = getTenantId(c);
    const body = BatchLifecycleSchema.parse(await c.req.json());

    const results = await Promise.allSettled(
      body.ids.map((id) => lifecycle.transitionNode(tenantId, id, body.transition))
    );

    const succeeded: NodeRow[] = [];
    const failed: Array<{
      id: string;
      error: string;
      currentStatus?: string;
      requestedTransition?: string;
      allowed?: string[];
    }> = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const id = body.ids[i];
      if (result.status === "fulfilled") {
        succeeded.push(result.value);
      } else {
        const e = result.reason;
        if (e instanceof LifecycleTransitionError) {
          failed.push({
            id,
            error: e.message,
            currentStatus: e.currentStatus,
            requestedTransition: e.requestedTransition,
            allowed: e.allowed,
          });
        } else if (e instanceof Error && e.message === "node not found") {
          failed.push({ id, error: "not found" });
        } else {
          failed.push({ id, error: "internal server error" });
        }
      }
    }

    const status = failed.length === 0 ? 200 : succeeded.length === 0 ? 422 : 207;
    return c.json({ data: { succeeded, failed } }, status as 200 | 207 | 422);
  });

  // Dry-run: evaluate guardrails against a draft node without persisting.
  // Returns violations that *would* occur plus fix suggestions and naming guidance.
  app.post("/preview-violations", async (c) => {
    const tenantId = getTenantId(c);
    const body = CreateNodeSchema.parse(await c.req.json());

    const draft = {
      id: "",
      tenantId,
      type: body.type,
      layer: body.layer,
      name: body.name,
      version: body.version,
      lifecycleStatus: body.lifecycleStatus,
      attributes: body.attributes,
      ownerId: (body.owner as { id?: string } | undefined)?.id ?? '',
      ownerName: (body.owner as { name?: string } | undefined)?.name ?? '',
      ownerKind: 'team',
      createdAt: new Date(),
      updatedAt: new Date(),
      deprecatedAt: null,
      archivedAt: null,
      purgeAfter: null,
    };

    const rawViolations = await guardrails.evaluate(tenantId, draft);
    // Strip node ID — draft has no persisted ID
    const violations = rawViolations.map(({ nodeId: _id, ...rest }) => rest);
    const suggestions = rawViolations.map(getViolationSuggestion);
    const namingGuidance = getNamingGuidance(body.type, body.name);

    return c.json({ data: { violations, suggestions, namingGuidance } });
  });

  app.get("/search", async (c) => {
    const tenantId = getTenantId(c);
    const attributesRaw = c.req.query("attributes");

    if (!attributesRaw) {
      return c.json({ error: "attributes query param is required" }, 400);
    }

    let parsedAttrs: unknown;
    try {
      parsedAttrs = JSON.parse(attributesRaw);
    } catch {
      return c.json({ error: "attributes must be valid JSON" }, 400);
    }

    const limitRaw = c.req.query("limit");
    const { attributes, nodeType, limit } = SearchByAttributesSchema.parse({
      attributes: parsedAttrs,
      nodeType: c.req.query("type") || undefined,
      limit: limitRaw !== undefined ? Number(limitRaw) : undefined,
    });

    const rows = await sql<NodeRow[]>`
      SELECT * FROM nodes
      WHERE tenant_id = ${tenantId}
        AND attributes @> ${jsonb(sql, attributes)}
        ${nodeType ? sql`AND type = ${nodeType}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return c.json({ data: rows });
  });

  app.get("/:id", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const includeStaleFlags = c.req.query("includeStaleFlags") === "true";

    if (!includeStaleFlags) {
      const cached = cache.nodes.get(cache.nodeKey(tenantId, id));
      if (cached) return c.json({ data: cached });
    }

    const [row] = await sql<NodeRow[]>`
      SELECT * FROM nodes WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!row) return c.json({ error: "not found" }, 404);
    cache.nodes.set(cache.nodeKey(tenantId, id), row);

    if (includeStaleFlags) {
      const staleFlags = await fetchStaleFlagsForObject(sql, tenantId, id, "node");
      return c.json({ data: { ...row, staleFlags } });
    }
    return c.json({ data: row });
  });

  app.patch("/:id", async (c) => {
    const tenantId = getTenantId(c);
    const apiKeyId = c.get("apiKeyId") ?? null;
    const { id } = c.req.param();
    const body = UpdateNodeSchema.parse(await c.req.json());

    const [previous] = await sql<NodeRow[]>`
      SELECT * FROM nodes WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!previous) return c.json({ error: "not found" }, 404);

    if (previous.lifecycleStatus === "DEPRECATED" && body.attributes !== undefined) {
      return c.json({ error: "attributes are immutable on DEPRECATED nodes" }, 422);
    }

    const neighborEdges = await sql<{ sourceId: string; targetId: string }[]>`
      SELECT DISTINCT source_id, target_id FROM edges
      WHERE tenant_id = ${tenantId} AND (source_id = ${id} OR target_id = ${id})
    `;
    const neighborIds = [...new Set(neighborEdges.flatMap(e => [e.sourceId, e.targetId]).filter(nid => nid !== id))];

    const row = await sql.begin(async (tx) => {
      const db: AnySql = tx;
      const [row] = await db<NodeRow[]>`
        UPDATE nodes SET
          ${body.name !== undefined ? db`name = ${body.name},` : db``}
          ${body.version !== undefined ? db`version = ${body.version},` : db``}
          ${body.lifecycleStatus !== undefined ? db`lifecycle_status = ${body.lifecycleStatus},` : db``}
          ${body.attributes !== undefined ? db`attributes = ${jsonb(db, body.attributes)},` : db``}
          updated_at = now()
        WHERE id = ${id} AND tenant_id = ${tenantId}
        RETURNING *
      `;
      if (!row) return null;
      await recordNodeHistory(db, tenantId, id, "UPDATE", previous, row);
      await insertAuditLogAndEnqueue(db, tenantId, apiKeyId, "node.update", row.type, id, nodeUpdateDiff(previous, row));
      return row;
    });
    if (!row) return c.json({ error: "not found" }, 404);
    cache.invalidateNode(tenantId, id, neighborIds);
    // `type` and `layer` are not in UpdateNodeSchema (immutable after creation), so
    // only `name` and `attributes` can affect the embedded text.
    if (body.name !== undefined || body.attributes !== undefined) {
      embeddingService?.embedNodeAsync(tenantId, id, embeddingService.nodeText(row));
    }
    await propagateNodeChange(sql, tenantId, row);
    return c.json({ data: row });
  });

  app.patch("/:id/lifecycle", async (c) => {
    const tenantId = getTenantId(c);
    const apiKeyId = c.get("apiKeyId") ?? null;
    const { id } = c.req.param();
    const body = LifecycleTransitionSchema.parse(await c.req.json());

    const [previous] = await sql<NodeRow[]>`
      SELECT * FROM nodes WHERE id = ${id} AND tenant_id = ${tenantId}
    `;

    try {
      const row = await sql.begin(async (tx) => {
        const db: AnySql = tx;
        const result = await lifecycle.withTransaction(db).transitionNode(tenantId, id, body.transition);
        if (previous) {
          await recordNodeHistory(db, tenantId, id, "LIFECYCLE_TRANSITION", previous, result);
          const auditOp = body.transition === "deprecate" ? "node.deprecate"
            : body.transition === "archive" ? "node.archive"
            : body.transition === "reactivate" ? "node.reactivate"
            : "node.purge";
          await insertAuditLogAndEnqueue(db, tenantId, apiKeyId, auditOp, result.type, id, nodeLifecycleDiff(previous, result));
        }
        return result;
      });
      if (body.transition === "deprecate" || body.transition === "archive") {
        await propagateNodeChange(sql, tenantId, row);
      }
      return c.json({ data: row });
    } catch (e) {
      if (e instanceof LifecycleTransitionError) {
        return c.json(
          {
            error: "invalid lifecycle transition",
            currentStatus: e.currentStatus,
            requestedTransition: e.requestedTransition,
            allowed: e.allowed,
          },
          422
        );
      }
      if (e instanceof Error && e.message === "node not found") {
        return c.json({ error: "not found" }, 404);
      }
      return c.json(...toHttpError(e));
    }
  });

  app.delete("/:id", async (c) => {
    const tenantId = getTenantId(c);
    const apiKeyId = c.get("apiKeyId") ?? null;
    const { id } = c.req.param();

    const [existing] = await sql<NodeRow[]>`
      SELECT * FROM nodes WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!existing) return c.json({ error: "not found" }, 404);
    if (existing.lifecycleStatus !== "ARCHIVED") {
      return c.json({ error: "node must be ARCHIVED before it can be purged" }, 422);
    }

    const retentionDays = config.lifecycleRetentionDays;
    const archivedAt = existing.archivedAt ? new Date(existing.archivedAt).getTime() : 0;
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    if (Date.now() - archivedAt < retentionMs) {
      return c.json({ error: `retention period of ${retentionDays} days has not elapsed since archival` }, 422);
    }

    const neighborEdges = await sql<{ sourceId: string; targetId: string }[]>`
      SELECT DISTINCT source_id, target_id FROM edges
      WHERE tenant_id = ${tenantId} AND (source_id = ${id} OR target_id = ${id})
    `;
    const neighborIds = [...new Set(neighborEdges.flatMap(e => [e.sourceId, e.targetId]).filter(nid => nid !== id))];

    await sql.begin(async (tx) => {
      const db: AnySql = tx;
      await db`DELETE FROM nodes WHERE id = ${id} AND tenant_id = ${tenantId}`;
      await insertAuditLogAndEnqueue(db, tenantId, apiKeyId, "node.delete", existing.type, id, nodeDeleteDiff(existing));
    });
    cache.invalidateNode(tenantId, id, neighborIds);
    return c.json({ data: { id } });
  });

  app.get("/:id/neighbors", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const direction = (c.req.query("direction") ?? "both") as "outbound" | "inbound" | "both";
    const edgeTypesRaw = c.req.query("edgeTypes");
    const edgeTypes = edgeTypesRaw?.split(",").filter(Boolean);

    const cacheKey = cache.traversalKey(tenantId, id, 1, direction, edgeTypes);
    const hit = cache.neighbors.get(cacheKey);
    if (hit) return c.json({ data: hit });

    let outboundNodes: NodeRow[] = [];
    let inboundNodes: NodeRow[] = [];

    if (direction === "outbound" || direction === "both") {
      outboundNodes = await sql<NodeRow[]>`
        SELECT n.* FROM nodes n
        JOIN edges e ON e.target_id = n.id
        WHERE e.source_id = ${id} AND n.tenant_id = ${tenantId}
          ${edgeTypes?.length ? sql`AND e.type = ANY(${edgeTypes})` : sql``}
      `;
    }
    if (direction === "inbound" || direction === "both") {
      inboundNodes = await sql<NodeRow[]>`
        SELECT n.* FROM nodes n
        JOIN edges e ON e.source_id = n.id
        WHERE e.target_id = ${id} AND n.tenant_id = ${tenantId}
          ${edgeTypes?.length ? sql`AND e.type = ANY(${edgeTypes})` : sql``}
      `;
    }

    const result = { outbound: outboundNodes, inbound: inboundNodes };
    cache.neighbors.set(cacheKey, result);
    return c.json({ data: result });
  });

  // POST /similar — cosine-similarity nearest-neighbour over node_embeddings.
  // Embeddings are populated by callers (MCP/agent); this endpoint is query-only.
  app.post("/similar", async (c) => {
    const tenantId = getTenantId(c);
    const body = SimilarNodesSchema.parse(await c.req.json());
    const { nodeId, topK, threshold, model } = body;

    const [root] = await sql<[{ id: string }]>`
      SELECT id FROM nodes WHERE id = ${nodeId} AND tenant_id = ${tenantId}
    `;
    if (!root) return c.json({ error: "not found" }, 404);

    const [rootEmb] = await sql<[{ embedding: string }]>`
      SELECT embedding::text AS embedding
      FROM node_embeddings
      WHERE node_id = ${nodeId} AND tenant_id = ${tenantId}
        ${model ? sql`AND model = ${model}` : sql``}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (!rootEmb?.embedding) {
      return c.json({ error: "node has no embedding" }, 422);
    }

    const emb = rootEmb.embedding;

    const rows = await sql<Array<NodeRow & { score: number }>>`
      WITH closest AS (
        SELECT ne.node_id,
          (1 - (ne.embedding <=> ${emb}::vector))::float AS score
        FROM node_embeddings ne
        WHERE ne.tenant_id = ${tenantId}
          AND ne.node_id != ${nodeId}
          ${model ? sql`AND ne.model = ${model}` : sql``}
        ORDER BY ne.embedding <=> ${emb}::vector
        LIMIT ${topK}
      )
      SELECT
        n.id, n.tenant_id, n.type, n.layer, n.name, n.version,
        n.lifecycle_status, n.attributes, n.created_at, n.updated_at,
        n.deprecated_at, n.archived_at, n.purge_after,
        c.score
      FROM closest c
      JOIN nodes n ON n.id = c.node_id
      WHERE n.tenant_id = ${tenantId}
        AND n.lifecycle_status NOT IN ('ARCHIVED', 'PURGE')
        ${threshold !== undefined ? sql`AND c.score >= ${threshold}` : sql``}
      ORDER BY c.score DESC
    `;

    return c.json({ data: rows.map(({ score, ...node }) => ({ node, score })) });
  });

  app.get("/:id/history", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const limit = parsePaginationLimit(c.req.query("limit"), 20, 500);
    const offset = Number(c.req.query("offset") ?? 0);

    const [node] = await sql<{ id: string }[]>`
      SELECT id FROM nodes WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!node) return c.json({ error: "not found" }, 404);

    const [{ total }] = await sql<{ total: string }[]>`
      SELECT COUNT(*) AS total FROM node_history
      WHERE node_id = ${id} AND tenant_id = ${tenantId}
    `;

    const rows = await sql<NodeHistoryRow[]>`
      SELECT * FROM node_history
      WHERE node_id = ${id} AND tenant_id = ${tenantId}
      ORDER BY changed_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return c.json({ data: rows, total: Number(total) });
  });

  return app;
}
