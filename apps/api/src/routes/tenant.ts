// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import type { TenantRow } from "../db/types.js";
import { getTenantId } from "./util.js";
import { tenantApiKeysRouter } from "./tenant-api-keys.js";
import { TtlCache } from "../cache/index.js";

const USAGE_TTL_MS = 60_000;
const DIAGNOSTICS_TTL_MS = 30_000;

interface UsagePayload {
  nodes: { total: number; byType: Record<string, number> };
  edges: { total: number; byType: Record<string, number> };
  violations: { total: number; open: number };
  apiKeys: { active: number; expired: number };
  snapshots: { count: number; oldestAt: string | null; newestAt: string | null };
  staleFlagCount: number;
  computedAt: string;
}

const usageCache = new TtlCache<UsagePayload>(USAGE_TTL_MS);

interface DiagnosticsPayload {
  appVersion: string;
  nodeCount: number;
  edgeCount: number;
  apiKeyCount: number;
  webhookEndpointCount: number;
  auditLogEntries: number;
  lastMutationAt: string | null;
  dbConnected: boolean;
}

const diagnosticsCache = new TtlCache<DiagnosticsPayload>(DIAGNOSTICS_TTL_MS);

const PatchTenantSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  retentionDays: z.number().int().min(1).max(36500).optional(),
}).strict();

interface TenantStats {
  nodeCount: number;
  edgeCount: number;
  openViolationCount: number;
}

export function tenantRouter(sql: Sql): Hono {
  const app = new Hono();

  app.route("/api-keys", tenantApiKeysRouter(sql));

  app.get("/", async (c) => {
    const tenantId = getTenantId(c);

    // Auto-provision tenant row on first access so GET is always idempotent
    const [tenant] = await sql<TenantRow[]>`
      INSERT INTO tenants (id, name, plan, retention_days)
      VALUES (${tenantId}, 'Default Tenant', 'standard', 730)
      ON CONFLICT (id) DO UPDATE SET updated_at = tenants.updated_at
      RETURNING id, name, plan, retention_days, created_at, updated_at
    `;
    if (!tenant) return c.json({ error: "tenant not found" }, 404);

    const [stats] = await sql<[TenantStats]>`
      SELECT
        (SELECT count(*)::int FROM nodes    WHERE tenant_id = ${tenantId} AND lifecycle_status = 'ACTIVE') AS "nodeCount",
        (SELECT count(*)::int FROM edges    WHERE tenant_id = ${tenantId} AND lifecycle_status = 'ACTIVE') AS "edgeCount",
        (SELECT count(*)::int FROM violations WHERE tenant_id = ${tenantId} AND resolved = false)           AS "openViolationCount"
    `;

    return c.json({ data: { ...tenant, stats } });
  });

  app.get("/usage", async (c) => {
    const tenantId = getTenantId(c);
    const cacheKey = `usage:${tenantId}`;
    const cached = usageCache.get(cacheKey);
    if (cached) return c.json({ data: cached });

    interface UsageRow {
      nodesTotal: number;
      nodesByType: Record<string, number> | null;
      edgesTotal: number;
      edgesByType: Record<string, number> | null;
      violationsTotal: number;
      violationsOpen: number;
      apiKeysActive: number;
      apiKeysExpired: number;
      snapshotsCount: number;
      snapshotsOldestAt: Date | null;
      snapshotsNewestAt: Date | null;
      staleFlagCount: number;
    }

    const [row] = await sql<[UsageRow]>`
      SELECT
        (SELECT count(*)::int FROM nodes WHERE tenant_id = ${tenantId})                                           AS "nodesTotal",
        (SELECT jsonb_object_agg(type, cnt) FROM (SELECT type, count(*)::int AS cnt FROM nodes WHERE tenant_id = ${tenantId} GROUP BY type) _n) AS "nodesByType",
        (SELECT count(*)::int FROM edges WHERE tenant_id = ${tenantId})                                           AS "edgesTotal",
        (SELECT jsonb_object_agg(type, cnt) FROM (SELECT type, count(*)::int AS cnt FROM edges WHERE tenant_id = ${tenantId} GROUP BY type) _e) AS "edgesByType",
        (SELECT count(*)::int FROM violations WHERE tenant_id = ${tenantId})                                      AS "violationsTotal",
        (SELECT count(*)::int FROM violations WHERE tenant_id = ${tenantId} AND resolved = false)                 AS "violationsOpen",
        (SELECT count(*)::int FROM api_keys WHERE tenant_id = ${tenantId} AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())) AS "apiKeysActive",
        (SELECT count(*)::int FROM api_keys WHERE tenant_id = ${tenantId} AND (revoked_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at <= now()))) AS "apiKeysExpired",
        (SELECT count(*)::int FROM snapshots WHERE tenant_id = ${tenantId})                                       AS "snapshotsCount",
        (SELECT min(created_at) FROM snapshots WHERE tenant_id = ${tenantId})                                     AS "snapshotsOldestAt",
        (SELECT max(created_at) FROM snapshots WHERE tenant_id = ${tenantId})                                     AS "snapshotsNewestAt",
        (SELECT count(*)::int FROM stale_flags WHERE tenant_id = ${tenantId})                                     AS "staleFlagCount"
    `;

    const payload: UsagePayload = {
      nodes: { total: row.nodesTotal, byType: row.nodesByType ?? {} },
      edges: { total: row.edgesTotal, byType: row.edgesByType ?? {} },
      violations: { total: row.violationsTotal, open: row.violationsOpen },
      apiKeys: { active: row.apiKeysActive, expired: row.apiKeysExpired },
      snapshots: {
        count: row.snapshotsCount,
        oldestAt: row.snapshotsOldestAt ? row.snapshotsOldestAt.toISOString() : null,
        newestAt: row.snapshotsNewestAt ? row.snapshotsNewestAt.toISOString() : null,
      },
      staleFlagCount: row.staleFlagCount,
      computedAt: new Date().toISOString(),
    };

    usageCache.set(cacheKey, payload);
    return c.json({ data: payload });
  });

  app.get("/diagnostics", async (c) => {
    const tenantId = getTenantId(c);
    const cacheKey = `diagnostics:${tenantId}`;
    const cached = diagnosticsCache.get(cacheKey);
    if (cached) return c.json({ data: cached });

    interface DiagnosticsRow {
      nodeCount: number;
      edgeCount: number;
      apiKeyCount: number;
      webhookEndpointCount: number;
      auditLogEntries: number;
      lastMutationAt: Date | null;
    }

    let dbConnected = true;
    let row: DiagnosticsRow;

    try {
      [row] = await sql<[DiagnosticsRow]>`
        SELECT
          (SELECT count(*)::int FROM nodes       WHERE tenant_id = ${tenantId})                                                       AS "nodeCount",
          (SELECT count(*)::int FROM edges       WHERE tenant_id = ${tenantId})                                                       AS "edgeCount",
          (SELECT count(*)::int FROM api_keys    WHERE tenant_id = ${tenantId} AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())) AS "apiKeyCount",
          (SELECT count(*)::int FROM webhooks    WHERE tenant_id = ${tenantId} AND is_active = true)                                  AS "webhookEndpointCount",
          (SELECT count(*)::int FROM audit_log   WHERE tenant_id = ${tenantId})                                                       AS "auditLogEntries",
          (SELECT max(changed_at) FROM node_history WHERE tenant_id = ${tenantId})                                                    AS "lastMutationAt"
      `;
    } catch {
      dbConnected = false;
      row = { nodeCount: 0, edgeCount: 0, apiKeyCount: 0, webhookEndpointCount: 0, auditLogEntries: 0, lastMutationAt: null };
    }

    const payload: DiagnosticsPayload = {
      appVersion: process.env["APP_VERSION"] ?? "unknown",
      nodeCount: row.nodeCount,
      edgeCount: row.edgeCount,
      apiKeyCount: row.apiKeyCount,
      webhookEndpointCount: row.webhookEndpointCount,
      auditLogEntries: row.auditLogEntries,
      lastMutationAt: row.lastMutationAt ? row.lastMutationAt.toISOString() : null,
      dbConnected,
    };

    diagnosticsCache.set(cacheKey, payload);
    return c.json({ data: payload });
  });

  app.patch("/", async (c) => {
    const tenantId = getTenantId(c);
    const body = PatchTenantSchema.parse(await c.req.json());

    if (Object.keys(body).length === 0) {
      return c.json({ error: "no fields to update" }, 400);
    }

    const updates: { name?: string; retention_days?: number } = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.retentionDays !== undefined) updates.retention_days = body.retentionDays;

    const [tenant] = await sql<TenantRow[]>`
      UPDATE tenants
      SET
        ${body.name !== undefined ? sql`name = ${body.name},` : sql``}
        ${body.retentionDays !== undefined ? sql`retention_days = ${body.retentionDays},` : sql``}
        updated_at = now()
      WHERE id = ${tenantId}
      RETURNING id, name, plan, retention_days, created_at, updated_at
    `;
    if (!tenant) return c.json({ error: "tenant not found" }, 404);

    return c.json({ data: tenant });
  });

  return app;
}
