// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Contract and adversarial edge-case tests for:
//   POST /agent/v1/context              — KnowledgeContextSchema boundary
//   GET  /agent/v1/write-guidance/:nodeType — auth and header boundary
//
// These tests target the request-contract layer: malformed bodies, schema
// violations, oversized inputs, and auth rejections. Functional traversal
// logic is covered by knowledge-context.test.ts and agent-write-guidance.test.ts.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant } from "./test-helpers";

let tid: string;
const jsonHeaders = () => ({ "content-type": "application/json", "x-tenant-id": tid });

beforeEach(() => { tid = randomUUID(); });
afterEach(async () => { await cleanTenant(sql, tid); });

// ── POST /agent/v1/context — malformed body ───────────────────────────────────

describe("POST /agent/v1/context — malformed body", () => {
  it("returns 400 (not 500) for a non-JSON body", async () => {
    const res = await app.request("/agent/v1/context", {
      method: "POST",
      headers: jsonHeaders(),
      body: "this is not json",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for an empty body", async () => {
    const res = await app.request("/agent/v1/context", {
      method: "POST",
      headers: jsonHeaders(),
      body: "",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is a JSON array instead of an object", async () => {
    const res = await app.request("/agent/v1/context", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify([{ nodeId: randomUUID(), profile: "depth" }]),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for partial / truncated JSON", async () => {
    const res = await app.request("/agent/v1/context", {
      method: "POST",
      headers: jsonHeaders(),
      body: '{"nodeId":"',
    });
    expect(res.status).toBe(400);
  });
});

// ── POST /agent/v1/context — Zod schema contract ──────────────────────────────

describe("POST /agent/v1/context — Zod schema contract", () => {
  it("returns 400 with issues array when profile field is missing", async () => {
    const res = await app.request("/agent/v1/context", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ nodeId: randomUUID() }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Array.isArray(body.issues)).toBe(true);
    const paths = body.issues.flatMap((i: { path: unknown[] }) => i.path);
    expect(paths).toContain("profile");
  });

  it("returns 400 with issues array when nodeId field is missing", async () => {
    const res = await app.request("/agent/v1/context", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ profile: "depth" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Array.isArray(body.issues)).toBe(true);
    const paths = body.issues.flatMap((i: { path: unknown[] }) => i.path);
    expect(paths).toContain("nodeId");
  });

  it("returns 400 with at least two issues when both required fields are absent", async () => {
    const res = await app.request("/agent/v1/context", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.issues.length).toBeGreaterThanOrEqual(2);
  });

  it("returns 400 when profile has an unrecognized value", async () => {
    const res = await app.request("/agent/v1/context", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ nodeId: randomUUID(), profile: "bogus" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    const paths = body.issues.flatMap((i: { path: unknown[] }) => i.path);
    expect(paths).toContain("profile");
  });

  it("returns 400 when nodeId is not a UUID-format string", async () => {
    const res = await app.request("/agent/v1/context", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ nodeId: "not-a-uuid", profile: "breadth" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    const paths = body.issues.flatMap((i: { path: unknown[] }) => i.path);
    expect(paths).toContain("nodeId");
  });

  it("returns 400 when nodeId is a number instead of a string", async () => {
    const res = await app.request("/agent/v1/context", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ nodeId: 42, profile: "depth" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when maxNodes is 0 (must be a positive integer)", async () => {
    const res = await app.request("/agent/v1/context", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ nodeId: randomUUID(), profile: "depth", maxNodes: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when maxNodes exceeds the maximum of 100", async () => {
    const res = await app.request("/agent/v1/context", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ nodeId: randomUUID(), profile: "depth", maxNodes: 101 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when maxNodes is a negative integer", async () => {
    const res = await app.request("/agent/v1/context", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ nodeId: randomUUID(), profile: "depth", maxNodes: -1 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when minSimilarity is above 1.0", async () => {
    const res = await app.request("/agent/v1/context", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ nodeId: randomUUID(), profile: "semantic", minSimilarity: 1.1 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when minSimilarity is negative", async () => {
    const res = await app.request("/agent/v1/context", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ nodeId: randomUUID(), profile: "semantic", minSimilarity: -0.1 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for an oversized nodeId string (not a valid UUID)", async () => {
    const res = await app.request("/agent/v1/context", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ nodeId: "x".repeat(4096), profile: "depth" }),
    });
    expect(res.status).toBe(400);
  });
});

// ── POST /agent/v1/context — API key auth boundary ───────────────────────────

describe("POST /agent/v1/context — API key auth boundary", () => {
  it("returns 403 when an unrecognized X-Api-Key is provided", async () => {
    // Middleware validates the key against the DB regardless of apiKeyAuthEnabled;
    // an unknown key always yields 403. The 401 (no-key) path is tested in the
    // api-key-middleware unit test with apiKeyAuthEnabled=true.
    const res = await app.request("/agent/v1/context", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": tid,
        "X-Api-Key": `lsds_${"0".repeat(32)}invalid`,
      },
      body: JSON.stringify({ nodeId: randomUUID(), profile: "depth" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/forbidden/i);
  });
});

// ── GET /agent/v1/write-guidance/:nodeType — request contract ─────────────────

describe("GET /agent/v1/write-guidance/:nodeType — request contract", () => {
  it("returns 400 when x-tenant-id header is missing", async () => {
    const res = await app.request("/agent/v1/write-guidance/Service", {});
    expect(res.status).toBe(400);
  });

  it("returns 403 when an unrecognized X-Api-Key is provided", async () => {
    const res = await app.request("/agent/v1/write-guidance/Service", {
      headers: {
        "x-tenant-id": tid,
        "X-Api-Key": `lsds_${"0".repeat(32)}invalid`,
      },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/forbidden/i);
  });

  it("returns 200 with expected shape for a valid request", async () => {
    const res = await app.request("/agent/v1/write-guidance/Service", {
      headers: { "x-tenant-id": tid },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.nodeType).toBe("Service");
    expect(Array.isArray(body.data.guardrails)).toBe(true);
    expect(typeof body.data.instruction).toBe("string");
    expect(body.data.instruction.length).toBeGreaterThan(0);
  });
});
