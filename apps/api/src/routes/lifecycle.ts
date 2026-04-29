// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import type { LifecycleService } from "../lifecycle/index.js";
import { getTenantId } from "./util.js";

export function lifecycleRouter(svc: LifecycleService): Hono {
  const app = new Hono();

  app.post("/nodes/:id/deprecate", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    try {
      const row = await svc.deprecate(tenantId, id);
      return c.json({ data: row });
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  });

  app.post("/nodes/:id/archive", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    try {
      const row = await svc.archive(tenantId, id);
      return c.json({ data: row });
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  });

  app.post("/nodes/:id/mark-purge", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const body = await c.req.json().catch(() => ({} as { purgeAfterDays?: number }));
    try {
      const row = await svc.markForPurge(tenantId, id, body.purgeAfterDays);
      return c.json({ data: row });
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  });

  app.delete("/nodes/:id/purge", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    try {
      await svc.purge(tenantId, id);
      return c.json({ data: { id, purged: true } });
    } catch (e) {
      return c.json({ error: String(e) }, 400);
    }
  });

  app.post("/apply-retention", async (c) => {
    const tenantId = getTenantId(c);
    const result = await svc.applyRetentionPolicy(tenantId);
    return c.json({ data: result });
  });

  return app;
}
