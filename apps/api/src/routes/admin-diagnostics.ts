// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import type { Sql } from "../db/client.js";
import { poolStats } from "../db/client.js";
import { TtlCache } from "../cache/index.js";

const DIAGNOSTICS_TTL_MS = 30_000;

interface AdminDiagnosticsPayload {
  appVersion: string;
  nodeVersion: string;
  uptime: number;
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  dbConnected: boolean;
  dbPoolSize: number;
  totalTenants: number;
  totalActiveApiKeys: number;
  totalNodes: number;
  totalEdges: number;
  embeddings: { total: number; populated: number; missing: number };
  generatedAt: string;
}

const diagnosticsCache = new TtlCache<AdminDiagnosticsPayload>(DIAGNOSTICS_TTL_MS);
const CACHE_KEY = "admin:diagnostics";

export function adminDiagnosticsRouter(sql: Sql): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const cached = diagnosticsCache.get(CACHE_KEY);
    if (cached) return c.json({ data: cached });

    interface DiagnosticsRow {
      totalTenants: number;
      totalActiveApiKeys: number;
      totalNodes: number;
      totalEdges: number;
    }

    interface EmbeddingStatsRow {
      total: number;
      populated: number;
      missing: number;
    }

    let dbConnected = true;
    let row: DiagnosticsRow;

    try {
      [row] = await sql<[DiagnosticsRow]>`
        SELECT
          (SELECT count(*)::int FROM tenants)                                                                                               AS "totalTenants",
          (SELECT count(*)::int FROM api_keys WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()))                      AS "totalActiveApiKeys",
          (SELECT count(*)::int FROM nodes)                                                                                                 AS "totalNodes",
          (SELECT count(*)::int FROM edges)                                                                                                 AS "totalEdges"
      `;
    } catch {
      dbConnected = false;
      row = { totalTenants: 0, totalActiveApiKeys: 0, totalNodes: 0, totalEdges: 0 };
    }

    let embeddingStats: EmbeddingStatsRow = { total: 0, populated: 0, missing: 0 };
    if (dbConnected) {
      try {
        [embeddingStats] = await sql<[EmbeddingStatsRow]>`
          SELECT
            count(*)::int                   AS total,
            count(embedding)::int           AS populated,
            (count(*) - count(embedding))::int AS missing
          FROM nodes
        `;
      } catch {
        // pgvector extension or embedding column unavailable — return zeros
      }
    }

    const mem = process.memoryUsage();
    const payload: AdminDiagnosticsPayload = {
      appVersion: process.env["APP_VERSION"] ?? "unknown",
      nodeVersion: process.version,
      uptime: Math.floor(process.uptime()),
      memory: {
        rss: mem.rss,
        heapTotal: mem.heapTotal,
        heapUsed: mem.heapUsed,
        external: mem.external,
      },
      dbConnected,
      dbPoolSize: poolStats.size,
      totalTenants: row.totalTenants,
      totalActiveApiKeys: row.totalActiveApiKeys,
      totalNodes: row.totalNodes,
      totalEdges: row.totalEdges,
      embeddings: embeddingStats,
      generatedAt: new Date().toISOString(),
    };

    diagnosticsCache.set(CACHE_KEY, payload);
    return c.json({ data: payload });
  });

  return app;
}
