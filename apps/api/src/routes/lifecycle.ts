// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import type { Sql } from "../db/client.js";
import type { NodeRow } from "../db/types.js";
import type { LifecycleService } from "../lifecycle/index.js";
import { insertAuditLog, nodeLifecycleDiff } from "../db/audit.js";
import { getTenantId, toHttpError } from "./util.js";

export function lifecycleRouter(svc: LifecycleService, sql: Sql): Hono {
  const app = new Hono();

  app.post("/nodes/:id/deprecate", async (c) => {
    const tenantId = getTenantId(c);
    const apiKeyId = c.get("apiKeyId") ?? null;
    const { id } = c.req.param();
    const [before] = await sql<NodeRow[]>`SELECT * FROM nodes WHERE id = ${id} AND tenant_id = ${tenantId}`;
    try {
      const row = await svc.deprecate(tenantId, id);
      if (before) {
        await insertAuditLog(sql, tenantId, apiKeyId, "node.deprecate", row.type, id, nodeLifecycleDiff(before, row));
      }
      return c.json({ data: row });
    } catch (e) {
      return c.json(...toHttpError(e));
    }
  });

  app.post("/nodes/:id/reactivate", async (c) => {
    const tenantId = getTenantId(c);
    const apiKeyId = c.get("apiKeyId") ?? null;
    const { id } = c.req.param();
    const [before] = await sql<NodeRow[]>`SELECT * FROM nodes WHERE id = ${id} AND tenant_id = ${tenantId}`;
    try {
      const row = await svc.reactivate(tenantId, id);
      if (before) {
        await insertAuditLog(sql, tenantId, apiKeyId, "node.reactivate", row.type, id, nodeLifecycleDiff(before, row));
      }
      return c.json({ data: row });
    } catch (e) {
      return c.json(...toHttpError(e));
    }
  });

  app.post("/nodes/:id/archive", async (c) => {
    const tenantId = getTenantId(c);
    const apiKeyId = c.get("apiKeyId") ?? null;
    const { id } = c.req.param();
    const [before] = await sql<NodeRow[]>`SELECT * FROM nodes WHERE id = ${id} AND tenant_id = ${tenantId}`;
    try {
      const row = await svc.archive(tenantId, id);
      if (before) {
        await insertAuditLog(sql, tenantId, apiKeyId, "node.archive", row.type, id, nodeLifecycleDiff(before, row));
      }
      return c.json({ data: row });
    } catch (e) {
      return c.json(...toHttpError(e));
    }
  });

  app.post("/nodes/:id/mark-purge", async (c) => {
    const tenantId = getTenantId(c);
    const apiKeyId = c.get("apiKeyId") ?? null;
    const { id } = c.req.param();
    const [before] = await sql<NodeRow[]>`SELECT * FROM nodes WHERE id = ${id} AND tenant_id = ${tenantId}`;
    const body = await c.req.json().catch(() => ({} as { purgeAfterDays?: number }));
    try {
      const row = await svc.markForPurge(tenantId, id, body.purgeAfterDays);
      if (before) {
        await insertAuditLog(sql, tenantId, apiKeyId, "node.purge", row.type, id, nodeLifecycleDiff(before, row));
      }
      return c.json({ data: row });
    } catch (e) {
      return c.json(...toHttpError(e));
    }
  });

  app.delete("/nodes/:id/purge", async (c) => {
    const tenantId = getTenantId(c);
    const apiKeyId = c.get("apiKeyId") ?? null;
    const { id } = c.req.param();
    const [before] = await sql<NodeRow[]>`SELECT * FROM nodes WHERE id = ${id} AND tenant_id = ${tenantId}`;
    try {
      await svc.purge(tenantId, id);
      if (before) {
        await insertAuditLog(sql, tenantId, apiKeyId, "node.purge", before.type, id, nodeLifecycleDiff(before, null));
      }
      return c.json({ data: { id, purged: true } });
    } catch (e) {
      return c.json(...toHttpError(e));
    }
  });

  app.post("/apply-retention", async (c) => {
    const tenantId = getTenantId(c);
    const result = await svc.applyRetentionPolicy(tenantId);
    return c.json({ data: result });
  });

  return app;
}
