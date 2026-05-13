// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import * as http from "node:http";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant } from "./test-helpers";
import { createWebhookDispatcher } from "../src/webhooks/dispatcher";
import { generateWebhookSecret, encryptSecret, signPayload } from "../src/webhooks/crypto";

// Use a fixed test encryption key (64 hex chars = 32 bytes)
const TEST_KEY = "a".repeat(64);

let tid: string;

const adminH = () => ({
  "content-type": "application/json",
  "x-tenant-id": tid,
  authorization: `Bearer ${process.env.LSDS_ADMIN_SECRET ?? "test-admin-secret"}`,
  // unique IP per test so the 10 req/min admin rate limit never aggregates across tests
  "x-forwarded-for": tid,
});

const apiH = () => ({
  "content-type": "application/json",
  "x-tenant-id": tid,
});

beforeAll(() => {
  process.env.LSDS_WEBHOOK_ENCRYPTION_KEY = TEST_KEY;
  process.env.LSDS_ADMIN_SECRET = "test-admin-secret";
});

afterAll(() => {
  delete process.env.LSDS_WEBHOOK_ENCRYPTION_KEY;
});

beforeEach(() => { tid = randomUUID(); });
afterEach(async () => { await cleanTenant(sql, tid); });

// ── Test HTTP server helpers ───────────────────────────────────────────────────

interface ReceivedRequest {
  headers: Record<string, string>;
  body: string;
  status: number;
}

function createTestServer(responseStatus = 200): {
  url: string;
  requests: ReceivedRequest[];
  server: http.Server;
  close(): Promise<void>;
} {
  const requests: ReceivedRequest[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers[k] = v;
      }
      requests.push({ headers, body, status: responseStatus });
      res.writeHead(responseStatus);
      res.end();
    });
  });

  return {
    get url() {
      const addr = server.address() as { port: number };
      return `https://localhost:${addr.port}`;
    },
    requests,
    server,
    close() {
      return new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
    },
  };
}

async function listenOnFreePort(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

// ── Admin webhook registration ─────────────────────────────────────────────────

describe("webhook registration", () => {
  it("rejects non-https urls", async () => {
    const res = await app.request("/api/admin/webhooks", {
      method: "POST",
      headers: adminH(),
      body: JSON.stringify({ url: "http://example.com/hook", eventTypes: ["node.create"] }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects missing eventTypes", async () => {
    const res = await app.request("/api/admin/webhooks", {
      method: "POST",
      headers: adminH(),
      body: JSON.stringify({ url: "https://example.com/hook", eventTypes: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("registers a webhook and returns secret exactly once", async () => {
    const res = await app.request("/api/admin/webhooks", {
      method: "POST",
      headers: adminH(),
      body: JSON.stringify({
        url: "https://example.com/hook",
        eventTypes: ["node.create", "node.update"],
      }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.id).toBeDefined();
    expect(data.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(data.url).toBe("https://example.com/hook");
    expect(data.eventTypes).toEqual(["node.create", "node.update"]);

    // Subsequent GET must NOT expose the secret
    const getRes = await app.request(`/api/admin/webhooks/${data.id}`, { headers: adminH() });
    expect(getRes.status).toBe(200);
    const { data: fetched } = await getRes.json();
    expect(fetched.secret).toBeUndefined();
    expect(fetched.secretEnc).toBeUndefined();
  });

  it("enforces per-tenant cap of 10 webhooks", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await app.request("/api/admin/webhooks", {
        method: "POST",
        headers: adminH(),
        body: JSON.stringify({ url: `https://example.com/hook${i}`, eventTypes: ["node.create"] }),
      });
      expect(r.status).toBe(201);
    }
    // Use a fresh x-forwarded-for IP so the per-IP rate limit (10/min) doesn't
    // fire before the per-tenant webhook count check (the thing under test here).
    const overflow = await app.request("/api/admin/webhooks", {
      method: "POST",
      headers: { ...adminH(), "x-forwarded-for": `${tid}-overflow` },
      body: JSON.stringify({ url: "https://example.com/hook10", eventTypes: ["node.create"] }),
    });
    expect(overflow.status).toBe(422);
    const body = await overflow.json();
    expect(body.error).toMatch(/limit/);
  });

  it("returns 503 when encryption key not set", async () => {
    const saved = process.env.LSDS_WEBHOOK_ENCRYPTION_KEY;
    delete process.env.LSDS_WEBHOOK_ENCRYPTION_KEY;
    try {
      const res = await app.request("/api/admin/webhooks", {
        method: "POST",
        headers: adminH(),
        body: JSON.stringify({ url: "https://example.com/hook", eventTypes: ["node.create"] }),
      });
      expect(res.status).toBe(503);
    } finally {
      process.env.LSDS_WEBHOOK_ENCRYPTION_KEY = saved;
    }
  });
});

// ── Secret rotation ────────────────────────────────────────────────────────────

describe("webhook secret rotation", () => {
  it("returns new secret exactly once on rotate", async () => {
    const createRes = await app.request("/api/admin/webhooks", {
      method: "POST",
      headers: adminH(),
      body: JSON.stringify({ url: "https://example.com/hook", eventTypes: ["node.create"] }),
    });
    const { data } = await createRes.json();
    const originalSecret = data.secret;

    const rotateRes = await app.request(`/api/admin/webhooks/${data.id}/rotate-secret`, {
      method: "POST",
      headers: adminH(),
    });
    expect(rotateRes.status).toBe(200);
    const { data: rotated } = await rotateRes.json();
    expect(rotated.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(rotated.secret).not.toBe(originalSecret);

    // Second rotate returns another new secret (not same)
    const rotate2Res = await app.request(`/api/admin/webhooks/${data.id}/rotate-secret`, {
      method: "POST",
      headers: adminH(),
    });
    const { data: rotated2 } = await rotate2Res.json();
    expect(rotated2.secret).not.toBe(rotated.secret);
  });
});

// ── Enqueue on mutation ────────────────────────────────────────────────────────

describe("webhook enqueue on mutation", () => {
  it("enqueues delivery when a matching webhook exists", async () => {
    await app.request("/api/admin/webhooks", {
      method: "POST",
      headers: adminH(),
      body: JSON.stringify({ url: "https://example.com/hook", eventTypes: ["node.create"] }),
    });

    const nodeRes = await app.request("/v1/nodes", {
      method: "POST",
      headers: apiH(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "enqueue-test" }),
    });
    expect(nodeRes.status).toBe(201);

    const [delivery] = await sql<[{ status: string; eventType: string }]>`
      SELECT d.status, d.event_type
      FROM webhook_deliveries d
      JOIN webhooks w ON w.id = d.webhook_id
      WHERE w.tenant_id = ${tid}
      ORDER BY d.created_at DESC
      LIMIT 1
    `;
    expect(delivery).toBeDefined();
    expect(delivery!.status).toBe("pending");
    expect(delivery!.eventType).toBe("node.create");
  });

  it("does NOT enqueue when event type does not match", async () => {
    await app.request("/api/admin/webhooks", {
      method: "POST",
      headers: adminH(),
      body: JSON.stringify({ url: "https://example.com/hook", eventTypes: ["edge.create"] }),
    });

    await app.request("/v1/nodes", {
      method: "POST",
      headers: apiH(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "no-match" }),
    });

    const [{ count }] = await sql<[{ count: string }]>`
      SELECT count(*)::text AS count
      FROM webhook_deliveries d
      JOIN webhooks w ON w.id = d.webhook_id
      WHERE w.tenant_id = ${tid}
    `;
    expect(Number(count)).toBe(0);
  });

  it("does NOT enqueue when webhook is inactive", async () => {
    const createRes = await app.request("/api/admin/webhooks", {
      method: "POST",
      headers: adminH(),
      body: JSON.stringify({ url: "https://example.com/hook", eventTypes: ["node.create"] }),
    });
    const { data } = await createRes.json();
    await app.request(`/api/admin/webhooks/${data.id}`, {
      method: "PATCH",
      headers: adminH(),
      body: JSON.stringify({ isActive: false }),
    });

    await app.request("/v1/nodes", {
      method: "POST",
      headers: apiH(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "inactive-test" }),
    });

    const [{ count }] = await sql<[{ count: string }]>`
      SELECT count(*)::text AS count
      FROM webhook_deliveries d
      JOIN webhooks w ON w.id = d.webhook_id
      WHERE w.tenant_id = ${tid}
    `;
    expect(Number(count)).toBe(0);
  });
});

// ── Tenant isolation ───────────────────────────────────────────────────────────

describe("webhook tenant isolation", () => {
  it("webhook from tenant A does not receive events from tenant B", async () => {
    const tidB = randomUUID();
    try {
      await app.request("/api/admin/webhooks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": tid,
          "x-admin-secret": "test-admin-secret",
        },
        body: JSON.stringify({ url: "https://example.com/hook", eventTypes: ["node.create"] }),
      });

      // Node created under tenant B
      await app.request("/v1/nodes", {
        method: "POST",
        headers: { "content-type": "application/json", "x-tenant-id": tidB },
        body: JSON.stringify({ type: "Service", layer: "L4", name: "tenant-b-node" }),
      });

      // Tenant A webhook should have no deliveries
      const [{ count }] = await sql<[{ count: string }]>`
        SELECT count(*)::text AS count
        FROM webhook_deliveries d
        JOIN webhooks w ON w.id = d.webhook_id
        WHERE w.tenant_id = ${tid}
      `;
      expect(Number(count)).toBe(0);
    } finally {
      await cleanTenant(sql, tidB);
    }
  });
});

// ── Signature verification ─────────────────────────────────────────────────────

describe("webhook signature", () => {
  it("delivered request has correct HMAC-SHA256 signature", async () => {
    const testServer = createTestServer(200);
    // Use HTTP for test server since HTTPS needs cert — override URL manually
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === "string") headers[k] = v;
        }
        testServer.requests.push({ headers, body, status: 200 });
        res.writeHead(200); res.end();
      });
    });
    await listenOnFreePort(server);
    const addr = server.address() as { port: number };
    const hookUrl = `http://127.0.0.1:${addr.port}/hook`;

    try {
      // Register webhook — need to bypass HTTPS check for test
      // Insert directly into DB to use a plain http URL
      const secret = generateWebhookSecret();
      const { encryptSecret } = await import("../src/webhooks/crypto");
      const secretEnc = encryptSecret(secret);
      const [wh] = await sql<[{ id: string }]>`
        INSERT INTO webhooks (tenant_id, url, event_types, secret_enc)
        VALUES (
          ${tid}, ${hookUrl}, ${sql.array(["node.create"])},
          decode(${secretEnc.toString("hex")}, 'hex')
        )
        RETURNING id
      `;

      // Create node → enqueues delivery
      await app.request("/v1/nodes", {
        method: "POST",
        headers: apiH(),
        body: JSON.stringify({ type: "Service", layer: "L4", name: "sig-test" }),
      });

      // Run dispatcher poll
      const dispatcher = createWebhookDispatcher(sql);
      await dispatcher.poll();

      // Give delivery a moment
      await new Promise((r) => setTimeout(r, 100));

      expect(testServer.requests.length).toBeGreaterThanOrEqual(1);
      const req = testServer.requests[0]!;
      const ts = req.headers["x-lsds-timestamp"]!;
      const sig = req.headers["x-lsds-signature"]!;
      const expectedSig = signPayload(secret, ts, req.body);
      expect(sig).toBe(expectedSig);
      expect(req.headers["x-lsds-webhook-id"]).toBe(wh!.id);
      expect(req.headers["x-lsds-event-type"]).toBe("node.create");
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

// ── Retry / backoff ────────────────────────────────────────────────────────────

describe("webhook retry and backoff", () => {
  it("retries on failure and marks exhausted after max attempts", async () => {
    // Insert a webhook pointing to a non-existent endpoint (will fail)
    const retrySecret = generateWebhookSecret();
    const retrySecretEnc = encryptSecret(retrySecret);
    const [wh] = await sql<[{ id: string }]>`
      INSERT INTO webhooks (tenant_id, url, event_types, secret_enc)
      VALUES (
        ${tid}, ${"http://127.0.0.1:1/nonexistent"}, ${sql.array(["node.create"])},
        decode(${retrySecretEnc.toString("hex")}, 'hex')
      )
      RETURNING id
    `;

    // Manually insert a delivery
    const [entry] = await sql<[{ id: string }]>`
      INSERT INTO audit_log (tenant_id, api_key_id, operation, entity_type, entity_id)
      VALUES (${tid}, null, 'node.create', 'Service', ${randomUUID()})
      RETURNING id
    `;
    await sql`
      INSERT INTO webhook_deliveries (webhook_id, tenant_id, audit_log_id, event_type, payload)
      VALUES (
        ${wh!.id}, ${tid}, ${entry!.id}, 'node.create',
        ${sql.json({ id: entry!.id, event: "node.create", timestamp: new Date().toISOString(), data: {} })}
      )
    `;

    const dispatcher = createWebhookDispatcher(sql);

    // 6 polls to exhaust all attempts
    for (let i = 0; i < 6; i++) {
      // Force next_attempt to now for each retry
      await sql`UPDATE webhook_deliveries SET next_attempt = now() WHERE tenant_id = ${tid}`;
      await dispatcher.poll();
    }

    const [delivery] = await sql<[{ status: string; attemptCount: number }]>`
      SELECT status, attempt_count FROM webhook_deliveries WHERE tenant_id = ${tid}
    `;
    expect(delivery!.status).toBe("failed");
    expect(delivery!.attemptCount).toBe(6);
  });

  it("marks delivered and stops retrying when attempt 3 succeeds", async () => {
    let callCount = 0;
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        callCount++;
        // Fail first 2 attempts, succeed on the 3rd
        res.writeHead(callCount < 3 ? 500 : 200);
        res.end();
      });
    });
    await listenOnFreePort(server);
    const addr = server.address() as { port: number };

    const secret = generateWebhookSecret();
    const secretEnc = encryptSecret(secret);
    try {
      const [wh] = await sql<[{ id: string }]>`
        INSERT INTO webhooks (tenant_id, url, event_types, secret_enc)
        VALUES (
          ${tid}, ${`http://127.0.0.1:${addr.port}/hook`}, ${sql.array(["node.create"])},
          decode(${secretEnc.toString("hex")}, 'hex')
        )
        RETURNING id
      `;
      const [entry] = await sql<[{ id: string }]>`
        INSERT INTO audit_log (tenant_id, api_key_id, operation, entity_type, entity_id)
        VALUES (${tid}, null, 'node.create', 'Service', ${randomUUID()})
        RETURNING id
      `;
      const [del] = await sql<[{ id: string }]>`
        INSERT INTO webhook_deliveries (webhook_id, tenant_id, audit_log_id, event_type, payload)
        VALUES (
          ${wh!.id}, ${tid}, ${entry!.id}, 'node.create',
          ${sql.json({ id: entry!.id, event: "node.create", timestamp: new Date().toISOString(), data: {} })}
        )
        RETURNING id
      `;

      const dispatcher = createWebhookDispatcher(sql);
      for (let i = 0; i < 3; i++) {
        await sql`UPDATE webhook_deliveries SET next_attempt = now() WHERE id = ${del!.id}`;
        await dispatcher.poll();
      }

      const [delivery] = await sql<[{ status: string; attemptCount: number }]>`
        SELECT status, attempt_count FROM webhook_deliveries WHERE id = ${del!.id}
      `;
      expect(delivery!.status).toBe("delivered");
      expect(delivery!.attemptCount).toBe(3);
      expect(callCount).toBe(3);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("honors Retry-After header when larger than backoff", async () => {
    // Create a server that returns Retry-After: 999
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        res.writeHead(503, { "Retry-After": "999" });
        res.end();
      });
    });
    await listenOnFreePort(server);
    const addr = server.address() as { port: number };

    const retryAfterSecret = generateWebhookSecret();
    const retryAfterSecretEnc = encryptSecret(retryAfterSecret);
    try {
      const [wh] = await sql<[{ id: string }]>`
        INSERT INTO webhooks (tenant_id, url, event_types, secret_enc)
        VALUES (
          ${tid}, ${`http://127.0.0.1:${addr.port}/retry`}, ${sql.array(["node.create"])},
          decode(${retryAfterSecretEnc.toString("hex")}, 'hex')
        )
        RETURNING id
      `;
      const [entry] = await sql<[{ id: string }]>`
        INSERT INTO audit_log (tenant_id, api_key_id, operation, entity_type, entity_id)
        VALUES (${tid}, null, 'node.create', 'Service', ${randomUUID()})
        RETURNING id
      `;
      await sql`
        INSERT INTO webhook_deliveries (webhook_id, tenant_id, audit_log_id, event_type, payload)
        VALUES (
          ${wh!.id}, ${tid}, ${entry!.id}, 'node.create',
          ${sql.json({ id: entry!.id, event: "node.create", timestamp: new Date().toISOString(), data: {} })}
        )
      `;

      const dispatcher = createWebhookDispatcher(sql);
      await dispatcher.poll();

      const [delivery] = await sql<[{ nextAttempt: Date }]>`
        SELECT next_attempt FROM webhook_deliveries WHERE tenant_id = ${tid}
      `;
      // next_attempt should be ~999s from now (well past the 1s backoff)
      const secsUntilNextAttempt = (delivery!.nextAttempt.getTime() - Date.now()) / 1000;
      expect(secsUntilNextAttempt).toBeGreaterThan(900);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

// ── Audit log emission ─────────────────────────────────────────────────────────

describe("webhook audit log emission", () => {
  it("emits webhook.delivered audit entry on successful delivery", async () => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => { res.writeHead(200); res.end(); });
    });
    await listenOnFreePort(server);
    const addr = server.address() as { port: number };

    const deliveredSecret = generateWebhookSecret();
    const deliveredSecretEnc = encryptSecret(deliveredSecret);
    try {
      const [wh] = await sql<[{ id: string }]>`
        INSERT INTO webhooks (tenant_id, url, event_types, secret_enc)
        VALUES (
          ${tid}, ${`http://127.0.0.1:${addr.port}/hook`}, ${sql.array(["node.create"])},
          decode(${deliveredSecretEnc.toString("hex")}, 'hex')
        )
        RETURNING id
      `;
      const [entry] = await sql<[{ id: string }]>`
        INSERT INTO audit_log (tenant_id, api_key_id, operation, entity_type, entity_id)
        VALUES (${tid}, null, 'node.create', 'Service', ${randomUUID()})
        RETURNING id
      `;
      const [del] = await sql<[{ id: string }]>`
        INSERT INTO webhook_deliveries (webhook_id, tenant_id, audit_log_id, event_type, payload)
        VALUES (
          ${wh!.id}, ${tid}, ${entry!.id}, 'node.create',
          ${sql.json({ id: entry!.id, event: "node.create", timestamp: new Date().toISOString(), data: {} })}
        )
        RETURNING id
      `;

      const dispatcher = createWebhookDispatcher(sql);
      await dispatcher.poll();

      const auditRows = await sql<[{ operation: string }]>`
        SELECT operation FROM audit_log
        WHERE tenant_id = ${tid} AND entity_id = ${del!.id}
        ORDER BY created_at ASC
      `;
      const ops = auditRows.map((r) => r.operation);
      expect(ops).toContain("webhook.delivered");
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("emits webhook.exhausted when all retries are consumed", async () => {
    const exhaustedSecret = generateWebhookSecret();
    const exhaustedSecretEnc = encryptSecret(exhaustedSecret);
    const [wh] = await sql<[{ id: string }]>`
      INSERT INTO webhooks (tenant_id, url, event_types, secret_enc)
      VALUES (
        ${tid}, ${"http://127.0.0.1:1/gone"}, ${sql.array(["node.create"])},
        decode(${exhaustedSecretEnc.toString("hex")}, 'hex')
      )
      RETURNING id
    `;
    const [entry] = await sql<[{ id: string }]>`
      INSERT INTO audit_log (tenant_id, api_key_id, operation, entity_type, entity_id)
      VALUES (${tid}, null, 'node.create', 'Service', ${randomUUID()})
      RETURNING id
    `;
    const [del] = await sql<[{ id: string }]>`
      INSERT INTO webhook_deliveries (webhook_id, tenant_id, audit_log_id, event_type, payload)
      VALUES (
        ${wh!.id}, ${tid}, ${entry!.id}, 'node.create',
        ${sql.json({ id: entry!.id, event: "node.create", timestamp: new Date().toISOString(), data: {} })}
      )
      RETURNING id
    `;

    const dispatcher = createWebhookDispatcher(sql);
    for (let i = 0; i < 6; i++) {
      await sql`UPDATE webhook_deliveries SET next_attempt = now() WHERE id = ${del!.id}`;
      await dispatcher.poll();
    }

    const auditRows = await sql<[{ operation: string }]>`
      SELECT operation FROM audit_log
      WHERE tenant_id = ${tid} AND entity_id = ${del!.id}
      ORDER BY created_at ASC
    `;
    const ops = auditRows.map((r) => r.operation);
    expect(ops).toContain("webhook.exhausted");
  });
});

// ── GET /deliveries endpoint ───────────────────────────────────────────────────

describe("GET /api/admin/webhooks/:id/deliveries", () => {
  it("returns delivery history for the webhook", async () => {
    const createRes = await app.request("/api/admin/webhooks", {
      method: "POST",
      headers: adminH(),
      body: JSON.stringify({ url: "https://example.com/hook", eventTypes: ["node.create"] }),
    });
    const { data: wh } = await createRes.json();

    await app.request("/v1/nodes", {
      method: "POST",
      headers: apiH(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "del-list" }),
    });

    const res = await app.request(`/api/admin/webhooks/${wh.id}/deliveries`, { headers: adminH() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0].webhookId).toBe(wh.id);
  });

  it("returns 404 for non-existent webhook", async () => {
    const res = await app.request(`/api/admin/webhooks/${randomUUID()}/deliveries`, {
      headers: adminH(),
    });
    expect(res.status).toBe(404);
  });
});
