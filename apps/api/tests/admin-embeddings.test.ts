// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Integration tests for POST /api/admin/embeddings/backfill.
// All DB assertions hit real Postgres — no database mocks (ADR A6).
//
// Embedding-dependent tests (backfill behaviour) require EMBEDDING_PROVIDER=stub
// and pgvector; they are skipped automatically when neither is available.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app.js";
import { sql } from "../src/db/client.js";
import { cleanTenant, createTestTenant } from "./test-helpers.js";

const TEST_SECRET = "test-admin-secret";

function adminHeaders(): Record<string, string> {
  return { authorization: `Bearer ${TEST_SECRET}` };
}

const EMBEDDING_ENABLED = !!process.env["EMBEDDING_PROVIDER"];
const maybeIt = EMBEDDING_ENABLED ? it : it.skip;

let tid: string;

beforeEach(async () => {
  tid = randomUUID();
  await createTestTenant(sql, tid);
});

afterEach(async () => {
  await cleanTenant(sql, tid);
});

async function insertNode(
  tenantId: string,
  opts: { withEmbedding?: boolean } = {}
): Promise<string> {
  const nodeId = randomUUID();
  await sql`
    INSERT INTO nodes (id, tenant_id, type, layer, name, version, lifecycle_status, attributes)
    VALUES (${nodeId}, ${tenantId}, 'Service', 'L4', ${"node-" + nodeId.slice(0, 8)}, '0.1.0', 'ACTIVE', '{}')
  `;
  if (opts.withEmbedding) {
    // Stub: constant [1,1,...,1] vector of length 1536
    const stub = `[${new Array(1536).fill(1).join(",")}]`;
    await sql`UPDATE nodes SET embedding = ${stub}::vector WHERE id = ${nodeId}`;
  }
  return nodeId;
}

// ── auth ─────────────────────────────────────────────────────────────────────

describe("POST /api/admin/embeddings/backfill — auth", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const res = await app.request("/api/admin/embeddings/backfill", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid token", async () => {
    const res = await app.request("/api/admin/embeddings/backfill", {
      method: "POST",
      headers: { authorization: "Bearer wrong-secret" },
    });
    expect(res.status).toBe(401);
  });
});

// ── 422 when provider disabled ────────────────────────────────────────────────

describe("POST /api/admin/embeddings/backfill — provider disabled", () => {
  it("returns 422 when EMBEDDING_PROVIDER is not configured", async () => {
    if (EMBEDDING_ENABLED) return; // only meaningful without a provider
    const res = await app.request("/api/admin/embeddings/backfill", {
      method: "POST",
      headers: { ...adminHeaders(), "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("embedding provider is disabled");
  });
});

// ── validation ────────────────────────────────────────────────────────────────

describe("POST /api/admin/embeddings/backfill — validation", () => {
  maybeIt("returns 400 when batchSize exceeds 500", async () => {
    const res = await app.request("/api/admin/embeddings/backfill", {
      method: "POST",
      headers: { ...adminHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ batchSize: 999 }),
    });
    expect(res.status).toBe(400);
  });

  maybeIt("returns 400 when tenantId is not a valid UUID", async () => {
    const res = await app.request("/api/admin/embeddings/backfill", {
      method: "POST",
      headers: { ...adminHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ tenantId: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
  });
});

// ── backfill behaviour ────────────────────────────────────────────────────────

describe("POST /api/admin/embeddings/backfill — backfill", () => {
  maybeIt("queues nodes and returns { queued } immediately", async () => {
    await insertNode(tid);
    await insertNode(tid);

    const res = await app.request("/api/admin/embeddings/backfill", {
      method: "POST",
      headers: { ...adminHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ tenantId: tid }),
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { queued: number; tenantId: string } };
    expect(data.queued).toBe(2);
    expect(data.tenantId).toBe(tid);
  });

  maybeIt("onlyMissing=true (default) does not re-queue already-embedded nodes", async () => {
    await insertNode(tid, { withEmbedding: true }); // already embedded
    await insertNode(tid);                            // missing embedding

    const res = await app.request("/api/admin/embeddings/backfill", {
      method: "POST",
      headers: { ...adminHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ tenantId: tid, onlyMissing: true }),
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { queued: number } };
    expect(data.queued).toBe(1);
  });

  maybeIt("onlyMissing=false re-queues all nodes including already-embedded ones", async () => {
    await insertNode(tid, { withEmbedding: true });
    await insertNode(tid, { withEmbedding: true });

    const res = await app.request("/api/admin/embeddings/backfill", {
      method: "POST",
      headers: { ...adminHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ tenantId: tid, onlyMissing: false }),
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { queued: number } };
    expect(data.queued).toBe(2);
  });

  maybeIt("tenantId filter returns only nodes for that tenant", async () => {
    const otherTid = randomUUID();
    await createTestTenant(sql, otherTid);
    try {
      await insertNode(tid);       // our tenant
      await insertNode(otherTid);  // other tenant

      const res = await app.request("/api/admin/embeddings/backfill", {
        method: "POST",
        headers: { ...adminHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ tenantId: tid }),
      });
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as { data: { queued: number; tenantId: string } };
      expect(data.queued).toBe(1);
      expect(data.tenantId).toBe(tid);
    } finally {
      await cleanTenant(sql, otherTid);
    }
  });

  maybeIt("omitting tenantId queues nodes across all tenants", async () => {
    const otherTid = randomUUID();
    await createTestTenant(sql, otherTid);
    try {
      await insertNode(tid);
      await insertNode(otherTid);

      const res = await app.request("/api/admin/embeddings/backfill", {
        method: "POST",
        headers: { ...adminHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ batchSize: 500 }),
      });
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as { data: { queued: number; tenantId?: string } };
      expect(data.queued).toBeGreaterThanOrEqual(2);
      expect(data.tenantId).toBeUndefined();
    } finally {
      await cleanTenant(sql, otherTid);
    }
  });

  maybeIt("respects batchSize limit", async () => {
    await insertNode(tid);
    await insertNode(tid);
    await insertNode(tid);

    const res = await app.request("/api/admin/embeddings/backfill", {
      method: "POST",
      headers: { ...adminHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ tenantId: tid, batchSize: 2 }),
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { queued: number } };
    expect(data.queued).toBe(2);
  });

  maybeIt("returns queued: 0 when no nodes need embedding", async () => {
    const res = await app.request("/api/admin/embeddings/backfill", {
      method: "POST",
      headers: { ...adminHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ tenantId: tid }),
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { queued: number } };
    expect(data.queued).toBe(0);
  });
});
