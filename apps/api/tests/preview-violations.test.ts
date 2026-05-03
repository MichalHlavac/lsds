// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant } from "./test-helpers";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

beforeEach(() => { tid = randomUUID(); });
afterEach(async () => { await cleanTenant(sql, tid); });

async function createGuardrail(body: {
  ruleKey: string;
  severity: "ERROR" | "WARN" | "INFO";
  enabled?: boolean;
  config: Record<string, unknown>;
}) {
  const res = await app.request("/v1/guardrails", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ ...body, description: "", enabled: body.enabled ?? true }),
  });
  if (res.status !== 201) throw new Error(`createGuardrail failed: ${await res.text()}`);
  return (await res.json()).data;
}

async function createNode(body: { type: string; layer: string; name: string; attributes?: Record<string, unknown> }) {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify(body),
  });
  if (res.status !== 201) throw new Error(`createNode failed: ${await res.text()}`);
  return (await res.json()).data;
}

// ── POST /v1/nodes/preview-violations ────────────────────────────────────────

describe("POST /v1/nodes/preview-violations", () => {
  it("returns empty violations when no guardrails are registered", async () => {
    const res = await app.request("/v1/nodes/preview-violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L3", name: "auth-service" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.violations).toEqual([]);
    expect(body.data.suggestions).toEqual([]);
    expect(body.data.namingGuidance).toEqual([]);
  });

  it("returns violations that would occur without persisting a node", async () => {
    await createGuardrail({
      ruleKey: "naming.node.min_length",
      severity: "WARN",
      config: { min: 20 },
    });

    const res = await app.request("/v1/nodes/preview-violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L3", name: "ab" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.violations).toHaveLength(1);
    expect(body.data.violations[0].ruleKey).toBe("naming.node.min_length");
    expect(body.data.violations[0].severity).toBe("WARN");
    // nodeId must not be present (draft has no persisted ID)
    expect(body.data.violations[0].nodeId).toBeUndefined();
  });

  it("does not persist a node to the database", async () => {
    await app.request("/v1/nodes/preview-violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L3", name: "ghost-service" }),
    });

    const listRes = await app.request("/v1/nodes?q=ghost-service", { headers: h() });
    expect(listRes.status).toBe(200);
    const listed = await listRes.json();
    expect(listed.data).toHaveLength(0);
  });

  it("returns a suggestion for each violation", async () => {
    await createGuardrail({
      ruleKey: "naming.node.min_length",
      severity: "WARN",
      config: { min: 10 },
    });

    const res = await app.request("/v1/nodes/preview-violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L3", name: "ab" }),
    });
    const body = await res.json();
    expect(body.data.suggestions).toHaveLength(body.data.violations.length);
    expect(body.data.suggestions[0]).toContain("10");
  });

  it("returns namingGuidance for DomainEvent without past-tense name", async () => {
    const res = await app.request("/v1/nodes/preview-violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "DomainEvent", layer: "L2", name: "CreateUser" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.namingGuidance).toHaveLength(1);
    expect(body.data.namingGuidance[0]).toMatch(/past tense/i);
  });

  it("returns empty namingGuidance for DomainEvent with correct past-tense name", async () => {
    const res = await app.request("/v1/nodes/preview-violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "DomainEvent", layer: "L2", name: "UserCreated" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.namingGuidance).toEqual([]);
  });

  it("returns 400 for invalid payload", async () => {
    const res = await app.request("/v1/nodes/preview-violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service" }), // missing layer and name
    });
    expect(res.status).toBe(400);
  });
});

// ── POST /v1/edges/preview-violations ────────────────────────────────────────

describe("POST /v1/edges/preview-violations", () => {
  it("returns empty violations for a valid edge draft", async () => {
    const source = await createNode({ type: "Service", layer: "L3", name: "source-svc" });
    const target = await createNode({ type: "Service", layer: "L3", name: "target-svc" });

    const res = await app.request("/v1/edges/preview-violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        sourceId: source.id,
        targetId: target.id,
        type: "depends-on",
        layer: "L3",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.violations).toHaveLength(0);
    expect(body.data.namingGuidance).toEqual([]);
  });

  it("returns framework violations for invalid cross-layer edge without persisting", async () => {
    // depends-on has SOURCE_LTE_TARGET: source ordinal must be ≤ target ordinal.
    // Service(L3) → BoundedContext(L1) violates that (3 > 1).
    const source = await createNode({ type: "Service", layer: "L3", name: "payment-svc" });
    const target = await createNode({ type: "BoundedContext", layer: "L1", name: "billing-ctx" });

    const res = await app.request("/v1/edges/preview-violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        sourceId: source.id,
        targetId: target.id,
        type: "depends-on",
        layer: "L3",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.violations.length).toBeGreaterThan(0);
    expect(body.data.violations[0].ruleKey).toBe("GR-XL-003");
    expect(body.data.violations[0].severity).toBe("ERROR");

    // Edge must not be persisted
    const edgesRes = await app.request(`/v1/edges?sourceId=${source.id}`, { headers: h() });
    const edges = await edgesRes.json();
    expect(edges.data).toHaveLength(0);
  });

  it("returns 404 when source node does not exist", async () => {
    const target = await createNode({ type: "Service", layer: "L3", name: "real-svc" });
    const res = await app.request("/v1/edges/preview-violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        sourceId: randomUUID(),
        targetId: target.id,
        type: "depends-on",
        layer: "L3",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when target node does not exist", async () => {
    const source = await createNode({ type: "Service", layer: "L3", name: "real-svc-2" });
    const res = await app.request("/v1/edges/preview-violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        sourceId: source.id,
        targetId: randomUUID(),
        type: "depends-on",
        layer: "L3",
      }),
    });
    expect(res.status).toBe(404);
  });
});

// ── GET /agent/v1/naming-check ────────────────────────────────────────────────

describe("GET /agent/v1/naming-check", () => {
  it("returns valid=true for DomainEvent with past-tense name", async () => {
    const res = await app.request("/agent/v1/naming-check?type=DomainEvent&name=UserCreated", { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.valid).toBe(true);
    expect(body.data.suggestions).toEqual([]);
  });

  it("returns valid=false with suggestions for DomainEvent with non-past-tense name", async () => {
    const res = await app.request("/agent/v1/naming-check?type=DomainEvent&name=CreateUser", { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.valid).toBe(false);
    expect(body.data.suggestions).toHaveLength(1);
    expect(body.data.suggestions[0]).toMatch(/past tense/i);
  });

  it("returns valid=true for unknown type (no convention defined)", async () => {
    const res = await app.request("/agent/v1/naming-check?type=Service&name=any-name", { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.valid).toBe(true);
  });

  it("returns 400 when type or name is missing", async () => {
    const res = await app.request("/agent/v1/naming-check?type=DomainEvent", { headers: h() });
    expect(res.status).toBe(400);
  });

  it("includes type and name in the response", async () => {
    const res = await app.request("/agent/v1/naming-check?type=DomainEvent&name=OrderPlaced", { headers: h() });
    const body = await res.json();
    expect(body.data.type).toBe("DomainEvent");
    expect(body.data.name).toBe("OrderPlaced");
  });
});
