// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant } from "./test-helpers";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

beforeEach(() => {
  tid = randomUUID();
});
afterEach(async () => {
  await cleanTenant(sql, tid);
});

async function createNode(
  layer: string,
  name: string,
  type = "Service",
  attributes: Record<string, unknown> = {}
) {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ type, layer, name, attributes }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).data as { id: string; name: string };
}

async function createEdge(sourceId: string, targetId: string, type = "contains") {
  const res = await app.request("/v1/edges", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ sourceId, targetId, type, layer: "L3" }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).data as { id: string };
}

// ── GET /agent/v1/architect/consistency ──────────────────────────────────────

describe("GET /agent/v1/architect/consistency", () => {
  it("returns 400 when x-tenant-id header is missing", async () => {
    const res = await app.request("/agent/v1/architect/consistency", {});
    expect(res.status).toBe(400);
  });

  it("returns empty patterns for an empty graph", async () => {
    const res = await app.request("/agent/v1/architect/consistency", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.patternCount).toBe(0);
    expect(data.patterns).toEqual([]);
  });

  it("flags ArchitectureComponent without a BoundedContext link", async () => {
    await createNode("L3", "PaymentComponent", "ArchitectureComponent");

    const res = await app.request("/agent/v1/architect/consistency", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();

    const pattern = data.patterns.find(
      (p: { patternId: string }) => p.patternId === "ARCH_COMPONENT_WITHOUT_BOUNDED_CONTEXT"
    );
    expect(pattern).toBeDefined();
    expect(pattern.count).toBe(1);
    expect(pattern.affectedNodes[0].name).toBe("PaymentComponent");
  });

  it("does NOT flag ArchitectureComponent linked to a BoundedContext", async () => {
    const component = await createNode("L3", "PaymentComponent", "ArchitectureComponent");
    const ctx = await createNode("L2", "PaymentContext", "BoundedContext");
    await createEdge(component.id, ctx.id, "part-of");

    const res = await app.request("/agent/v1/architect/consistency", { headers: h() });
    const { data } = await res.json();
    const pattern = data.patterns.find(
      (p: { patternId: string }) => p.patternId === "ARCH_COMPONENT_WITHOUT_BOUNDED_CONTEXT"
    );
    expect(pattern).toBeUndefined();
  });

  it("flags TechnicalDebt without an owner attribute", async () => {
    await createNode("L5", "Legacy Auth Debt", "TechnicalDebt", {
      debtType: "DESIGN",
      status: "OPEN",
      interestRate: "HIGH",
    });

    const res = await app.request("/agent/v1/architect/consistency", { headers: h() });
    const { data } = await res.json();
    const pattern = data.patterns.find(
      (p: { patternId: string }) => p.patternId === "TECHNICAL_DEBT_WITHOUT_OWNER"
    );
    expect(pattern).toBeDefined();
    expect(pattern.count).toBeGreaterThanOrEqual(1);
  });

  it("does NOT flag TechnicalDebt that has an owner", async () => {
    await createNode("L5", "Owned Debt", "TechnicalDebt", {
      debtType: "CODE",
      status: "OPEN",
      interestRate: "LOW",
      owner: "team-platform",
    });

    const res = await app.request("/agent/v1/architect/consistency", { headers: h() });
    const { data } = await res.json();
    const pattern = data.patterns.find(
      (p: { patternId: string }) => p.patternId === "TECHNICAL_DEBT_WITHOUT_OWNER"
    );
    expect(pattern).toBeUndefined();
  });

  it("includes scannedAt timestamp", async () => {
    const res = await app.request("/agent/v1/architect/consistency", { headers: h() });
    const { data } = await res.json();
    expect(data.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ── GET /agent/v1/architect/snapshots ────────────────────────────────────────

describe("GET /agent/v1/architect/snapshots", () => {
  it("returns 400 when x-tenant-id is missing", async () => {
    const res = await app.request("/agent/v1/architect/snapshots");
    expect(res.status).toBe(400);
  });

  it("returns empty array for a tenant with no snapshots", async () => {
    const res = await app.request("/agent/v1/architect/snapshots", { headers: h() });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);
  });

  it("returns snapshots after POST creates them", async () => {
    await app.request("/agent/v1/architect/snapshots?label=test", {
      method: "POST",
      headers: h(),
    });
    const res = await app.request("/agent/v1/architect/snapshots", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].label).toBe("test");
  });
});

// ── POST /agent/v1/architect/snapshots ───────────────────────────────────────

describe("POST /agent/v1/architect/snapshots", () => {
  it("returns 400 when x-tenant-id is missing", async () => {
    const res = await app.request("/agent/v1/architect/snapshots", { method: "POST" });
    expect(res.status).toBe(400);
  });

  it("creates a snapshot from live graph counts", async () => {
    await createNode("L4", "n1");
    await createNode("L4", "n2");

    const res = await app.request("/agent/v1/architect/snapshots?label=baseline", {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.label).toBe("baseline");
    expect(data.nodeCount).toBe(2);
    expect(data.edgeCount).toBe(0);
    expect(typeof data.id).toBe("string");
  });

  it("counts edges in the snapshot", async () => {
    const a = await createNode("L4", "a");
    const b = await createNode("L4", "b");
    await createEdge(a.id, b.id);

    const res = await app.request("/agent/v1/architect/snapshots", {
      method: "POST",
      headers: h(),
    });
    const { data } = await res.json();
    expect(data.nodeCount).toBe(2);
    expect(data.edgeCount).toBe(1);
  });
});

// ── GET /agent/v1/architect/drift ─────────────────────────────────────────────

describe("GET /agent/v1/architect/drift", () => {
  it("returns current state with null delta when no snapshot exists", async () => {
    await createNode("L3", "SomeService", "Service");

    const res = await app.request("/agent/v1/architect/drift", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.snapshot).toBeNull();
    expect(data.delta).toBeNull();
    expect(data.current.nodeCount).toBeGreaterThanOrEqual(1);
  });

  it("returns delta when a snapshot exists", async () => {
    // Create snapshot with 0 nodes
    await app.request("/v1/snapshots", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ label: "baseline", nodeCount: 0, edgeCount: 0, snapshotData: {} }),
    });

    await createNode("L3", "NewService", "Service");

    const res = await app.request("/agent/v1/architect/drift", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.snapshot).not.toBeNull();
    expect(data.delta).not.toBeNull();
    expect(data.delta.nodesDelta).toBeGreaterThan(0);
  });

  it("returns 404 for unknown snapshotId", async () => {
    const res = await app.request(
      `/agent/v1/architect/drift?snapshotId=${randomUUID()}`,
      { headers: h() }
    );
    expect(res.status).toBe(404);
  });

  it("includes nodesByType breakdown", async () => {
    await createNode("L4", "PaymentService", "Service");

    const res = await app.request("/agent/v1/architect/drift", { headers: h() });
    const { data } = await res.json();
    expect(Array.isArray(data.nodesByType)).toBe(true);
    const svcEntry = data.nodesByType.find(
      (e: { type: string }) => e.type === "Service"
    );
    expect(svcEntry).toBeDefined();
    expect(svcEntry.count).toBeGreaterThanOrEqual(1);
  });
});

// ── GET /agent/v1/architect/debt ──────────────────────────────────────────────

describe("GET /agent/v1/architect/debt", () => {
  it("returns zero totals for an empty graph", async () => {
    const res = await app.request("/agent/v1/architect/debt", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.totals.total).toBe(0);
    expect(data.totals.open).toBe(0);
  });

  it("counts open TechnicalDebt correctly", async () => {
    await createNode("L5", "Debt A", "TechnicalDebt", {
      debtType: "CODE",
      status: "OPEN",
      interestRate: "HIGH",
    });
    await createNode("L5", "Debt B", "TechnicalDebt", {
      debtType: "DESIGN",
      status: "OPEN",
      interestRate: "MEDIUM",
    });
    await createNode("L5", "Debt C", "TechnicalDebt", {
      debtType: "CODE",
      status: "RESOLVED",
      interestRate: "LOW",
    });

    const res = await app.request("/agent/v1/architect/debt", { headers: h() });
    const { data } = await res.json();
    expect(data.totals.total).toBe(3);
    expect(data.totals.open).toBe(2);
  });

  it("groups by debtType and omits RESOLVED entries", async () => {
    await createNode("L5", "Code Debt", "TechnicalDebt", {
      debtType: "CODE",
      status: "OPEN",
      interestRate: "HIGH",
    });
    await createNode("L5", "Resolved Debt", "TechnicalDebt", {
      debtType: "TEST",
      status: "RESOLVED",
      interestRate: "LOW",
    });

    const res = await app.request("/agent/v1/architect/debt", { headers: h() });
    const { data } = await res.json();
    const types = data.byDebtType.map((e: { debtType: string }) => e.debtType);
    expect(types).toContain("CODE");
    expect(types).not.toContain("TEST");
  });

  it("surfaces systemic patterns when a node has 2+ debts", async () => {
    const component = await createNode("L3", "LegacyComponent", "ArchitectureComponent");
    const debt1 = await createNode("L5", "Debt 1", "TechnicalDebt", {
      debtType: "CODE",
      status: "OPEN",
      interestRate: "HIGH",
    });
    const debt2 = await createNode("L5", "Debt 2", "TechnicalDebt", {
      debtType: "DESIGN",
      status: "OPEN",
      interestRate: "MEDIUM",
    });
    await createEdge(component.id, debt1.id, "contains");
    await createEdge(component.id, debt2.id, "contains");

    const res = await app.request("/agent/v1/architect/debt", { headers: h() });
    const { data } = await res.json();
    const pattern = data.systemicPatterns.find(
      (p: { nodeId: string }) => p.nodeId === component.id
    );
    expect(pattern).toBeDefined();
    expect(pattern.debtCount).toBe(2);
  });
});

// ── GET /agent/v1/architect/adr-coverage ─────────────────────────────────────

describe("GET /agent/v1/architect/adr-coverage", () => {
  it("returns empty uncoveredNodes when graph is empty", async () => {
    const res = await app.request("/agent/v1/architect/adr-coverage", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.coverage.totalArchitectureNodes).toBe(0);
    expect(data.uncoveredNodes).toEqual([]);
  });

  it("flags BoundedContext with many edges but no linked ADR", async () => {
    const ctx = await createNode("L2", "OrderContext", "BoundedContext");
    for (let i = 0; i < 6; i++) {
      const svc = await createNode("L4", `Service-${i}`, "Service");
      await createEdge(ctx.id, svc.id, "contains");
    }

    const res = await app.request(
      "/agent/v1/architect/adr-coverage?minEdges=5",
      { headers: h() }
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const uncovered = data.uncoveredNodes.find((n: { id: string }) => n.id === ctx.id);
    expect(uncovered).toBeDefined();
    expect(uncovered.edgeCount).toBeGreaterThanOrEqual(5);
    expect(typeof uncovered.suggestion).toBe("string");
  });

  it("does NOT flag BoundedContext that has a linked ADR", async () => {
    const ctx = await createNode("L2", "CoveredContext", "BoundedContext");
    const adr = await createNode("L3", "ADR-001", "ADR");
    for (let i = 0; i < 6; i++) {
      const svc = await createNode("L4", `Service-${i}`, "Service");
      await createEdge(ctx.id, svc.id, "contains");
    }
    await createEdge(ctx.id, adr.id, "decided-by");

    const res = await app.request(
      "/agent/v1/architect/adr-coverage?minEdges=5",
      { headers: h() }
    );
    const { data } = await res.json();
    const uncovered = data.uncoveredNodes.find((n: { id: string }) => n.id === ctx.id);
    expect(uncovered).toBeUndefined();
  });

  it("respects minEdges threshold — nodes below threshold are not flagged", async () => {
    const ctx = await createNode("L2", "SmallContext", "BoundedContext");
    const svc = await createNode("L4", "OnlyService", "Service");
    await createEdge(ctx.id, svc.id, "contains");

    // Only 1 edge — below default threshold of 5
    const res = await app.request("/agent/v1/architect/adr-coverage", { headers: h() });
    const { data } = await res.json();
    const uncovered = data.uncoveredNodes.find((n: { id: string }) => n.id === ctx.id);
    expect(uncovered).toBeUndefined();
  });

  it("includes coverage stats", async () => {
    const res = await app.request("/agent/v1/architect/adr-coverage", { headers: h() });
    const { data } = await res.json();
    expect(typeof data.coverage.totalArchitectureNodes).toBe("number");
    expect(typeof data.coverage.coveredByAdr).toBe("number");
    expect(typeof data.coverage.totalAdrs).toBe("number");
  });
});

// ── GET /agent/v1/architect/requirements ─────────────────────────────────────

describe("GET /agent/v1/architect/requirements", () => {
  it("returns empty summary when no requirements exist", async () => {
    const res = await app.request("/agent/v1/architect/requirements", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.summary.total).toBe(0);
    expect(data.requirements).toEqual([]);
  });

  it("classifies IMPLEMENTED requirement as fulfilled", async () => {
    await createNode("L1", "User login", "Requirement", {
      status: "IMPLEMENTED",
      requirementType: "FUNCTIONAL",
    });

    const res = await app.request("/agent/v1/architect/requirements", { headers: h() });
    const { data } = await res.json();
    expect(data.summary.fulfilled).toBe(1);
    expect(data.summary.unfulfilled).toBe(0);
  });

  it("classifies APPROVED requirement without links as unfulfilled", async () => {
    await createNode("L1", "Performance SLA", "Requirement", {
      status: "APPROVED",
      requirementType: "NON_FUNCTIONAL",
    });

    const res = await app.request("/agent/v1/architect/requirements", { headers: h() });
    const { data } = await res.json();
    expect(data.summary.unfulfilled).toBe(1);
  });

  it("classifies APPROVED requirement with linked nodes as inProgress", async () => {
    const req = await createNode("L1", "Search feature", "Requirement", {
      status: "APPROVED",
      requirementType: "FUNCTIONAL",
    });
    const svc = await createNode("L4", "SearchService", "Service");
    await createEdge(svc.id, req.id, "motivated-by");

    const res = await app.request("/agent/v1/architect/requirements", { headers: h() });
    const { data } = await res.json();
    const found = data.requirements.find((r: { id: string }) => r.id === req.id);
    expect(found.fulfillmentStatus).toBe("inProgress");
    expect(found.linkedNodes).toBeGreaterThan(0);
  });

  it("classifies OBSOLETE requirement correctly", async () => {
    await createNode("L1", "Old feature", "Requirement", {
      status: "OBSOLETE",
      requirementType: "FUNCTIONAL",
    });

    const res = await app.request("/agent/v1/architect/requirements", { headers: h() });
    const { data } = await res.json();
    expect(data.summary.obsolete).toBe(1);
  });

  it("returns consistent summary totals", async () => {
    await createNode("L1", "Req A", "Requirement", { status: "IMPLEMENTED" });
    await createNode("L1", "Req B", "Requirement", { status: "APPROVED" });
    await createNode("L1", "Req C", "Requirement", { status: "OBSOLETE" });

    const res = await app.request("/agent/v1/architect/requirements", { headers: h() });
    const { data } = await res.json();
    const { summary } = data;
    expect(summary.total).toBe(3);
    expect(summary.fulfilled + summary.inProgress + summary.unfulfilled + summary.obsolete).toBe(
      summary.total
    );
  });
});
