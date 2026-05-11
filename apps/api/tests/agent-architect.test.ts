// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant } from "./test-helpers";
import { ClassifyChangeSchema } from "../src/routes/schemas";
import {
  classifyFilePath,
  pickLayer,
  type ChangeSignal,
} from "../src/agent/architect-analysis";

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

async function createGuardrail(
  ruleKey: string,
  config: Record<string, unknown>,
  severity: "ERROR" | "WARN" | "INFO" = "WARN"
) {
  const res = await app.request("/v1/guardrails", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ ruleKey, severity, enabled: true, config }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).data as { id: string };
}

// ── POST /agent/v1/architect/analyze ─────────────────────────────────────────

describe("POST /agent/v1/architect/analyze", () => {
  it("returns 400 when x-tenant-id header is missing", async () => {
    const res = await app.request("/agent/v1/architect/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });

  it("returns zero violations for an empty graph", async () => {
    const res = await app.request("/agent/v1/architect/analyze", {
      method: "POST",
      headers: h(),
      body: "{}",
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.scope.nodeCount).toBe(0);
    expect(data.rulesEvaluated).toBe(0);
    expect(data.summary.totalViolations).toBe(0);
    expect(data.samples).toEqual([]);
    expect(data.persisted).toBe(false);
    expect(data.persistedCount).toBe(0);
  });

  it("returns zero violations when no guardrails are configured", async () => {
    await createNode("L4", "OrderService", "Service");

    const res = await app.request("/agent/v1/architect/analyze", {
      method: "POST",
      headers: h(),
      body: "{}",
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.scope.nodeCount).toBe(1);
    expect(data.rulesEvaluated).toBe(0);
    expect(data.summary.totalViolations).toBe(0);
  });

  it("flags every node violating naming.node.min_length and groups by rule", async () => {
    await createGuardrail("naming.node.min_length", { min: 20 });
    await createNode("L4", "shortA", "Service");
    await createNode("L4", "shortB", "Service");
    await createNode("L4", "this-name-is-long-enough-to-pass", "Service");

    const res = await app.request("/agent/v1/architect/analyze", {
      method: "POST",
      headers: h(),
      body: "{}",
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.summary.totalViolations).toBe(2);
    expect(data.summary.bySeverity.WARN).toBe(2);
    expect(data.summary.byRule).toHaveLength(1);
    expect(data.summary.byRule[0]).toMatchObject({
      ruleKey: "naming.node.min_length",
      severity: "WARN",
      count: 2,
    });
    expect(data.samples).toHaveLength(2);
    expect(data.samples[0].nodeId).toBeTruthy();
  });

  it("aggregates violations across multiple rules", async () => {
    await createGuardrail("naming.node.min_length", { min: 50 });
    await createGuardrail("lifecycle.review_cycle", { maxAgeDays: 0 });
    await createNode("L4", "svc", "Service");

    const res = await app.request("/agent/v1/architect/analyze", {
      method: "POST",
      headers: h(),
      body: "{}",
    });
    const { data } = await res.json();
    expect(data.summary.totalViolations).toBeGreaterThanOrEqual(2);
    const ruleKeys = data.summary.byRule.map((r: { ruleKey: string }) => r.ruleKey);
    expect(ruleKeys).toContain("naming.node.min_length");
    expect(ruleKeys).toContain("lifecycle.review_cycle");
  });

  it("filters by type", async () => {
    await createGuardrail("naming.node.min_length", { min: 50 });
    await createNode("L4", "svc", "Service");
    await createNode("L2", "ctx", "BoundedContext");

    const res = await app.request("/agent/v1/architect/analyze", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ types: ["Service"] }),
    });
    const { data } = await res.json();
    expect(data.scope.nodeCount).toBe(1);
    expect(data.scope.filters.types).toEqual(["Service"]);
    expect(data.summary.totalViolations).toBe(1);
  });

  it("filters by layer", async () => {
    await createGuardrail("naming.node.min_length", { min: 50 });
    await createNode("L4", "svc", "Service");
    await createNode("L2", "ctx", "BoundedContext");

    const res = await app.request("/agent/v1/architect/analyze", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ layers: ["L2"] }),
    });
    const { data } = await res.json();
    expect(data.scope.nodeCount).toBe(1);
    expect(data.scope.filters.layers).toEqual(["L2"]);
  });

  it("excludes ARCHIVED and PURGE nodes by default", async () => {
    await createGuardrail("naming.node.min_length", { min: 50 });
    const archived = await createNode("L4", "old", "Service");
    const dep = await app.request(`/v1/lifecycle/nodes/${archived.id}/deprecate`, {
      method: "POST",
      headers: h(),
    });
    expect(dep.status).toBe(200);
    const arc = await app.request(`/v1/lifecycle/nodes/${archived.id}/archive`, {
      method: "POST",
      headers: h(),
    });
    expect(arc.status).toBe(200);
    await createNode("L4", "live", "Service");

    const res = await app.request("/agent/v1/architect/analyze", {
      method: "POST",
      headers: h(),
      body: "{}",
    });
    const { data } = await res.json();
    expect(data.scope.nodeCount).toBe(1);
    expect(data.summary.totalViolations).toBe(1);
  });

  it("persists violations when persist=true", async () => {
    await createGuardrail("naming.node.min_length", { min: 50 });
    await createNode("L4", "svc", "Service");

    const res = await app.request("/agent/v1/architect/analyze", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ persist: true }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.persisted).toBe(true);
    expect(data.persistedCount).toBe(1);

    const summaryRes = await app.request("/agent/v1/violations/summary", { headers: h() });
    const { data: summary } = await summaryRes.json();
    const warn = summary.find((s: { severity: string }) => s.severity === "WARN");
    expect(warn?.count).toBeGreaterThanOrEqual(1);
  });

  it("does NOT persist by default", async () => {
    await createGuardrail("naming.node.min_length", { min: 50 });
    await createNode("L4", "svc", "Service");

    await app.request("/agent/v1/architect/analyze", {
      method: "POST",
      headers: h(),
      body: "{}",
    });

    const summaryRes = await app.request("/agent/v1/violations/summary", { headers: h() });
    const { data: summary } = await summaryRes.json();
    expect(summary).toEqual([]);
  });

  it("respects sampleLimit by truncating samples but not summary counts", async () => {
    await createGuardrail("naming.node.min_length", { min: 50 });
    for (let i = 0; i < 5; i++) {
      await createNode("L4", `svc${i}`, "Service");
    }

    const res = await app.request("/agent/v1/architect/analyze", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sampleLimit: 2 }),
    });
    const { data } = await res.json();
    expect(data.summary.totalViolations).toBe(5);
    expect(data.samples).toHaveLength(2);
  });

  it("includes scannedAt timestamp", async () => {
    const res = await app.request("/agent/v1/architect/analyze", {
      method: "POST",
      headers: h(),
      body: "{}",
    });
    const { data } = await res.json();
    expect(data.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

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

// ── GET /agent/v1/architect/requirement-fulfillment ───────────────────────────

describe("GET /agent/v1/architect/requirement-fulfillment", () => {
  it("returns 400 when x-tenant-id header is missing", async () => {
    const res = await app.request("/agent/v1/architect/requirement-fulfillment", {});
    expect(res.status).toBe(400);
  });

  it("returns empty result when no APPROVED requirements exist", async () => {
    // IMPLEMENTED and OBSOLETE requirements must not appear
    await createNode("L1", "Done Req", "Requirement", { status: "IMPLEMENTED" });
    await createNode("L1", "Old Req", "Requirement", { status: "OBSOLETE" });

    const res = await app.request("/agent/v1/architect/requirement-fulfillment", {
      headers: h(),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.summary.total).toBe(0);
    expect(data.summary.gap).toBe(0);
    expect(data.summary.reflected).toBe(0);
    expect(data.gaps).toEqual([]);
    expect(data.requirements).toEqual([]);
  });

  it("classifies APPROVED requirement with no linked nodes as gap", async () => {
    const req = await createNode("L1", "Unlinked Req", "Requirement", {
      status: "APPROVED",
      requirementType: "FUNCTIONAL",
    });

    const res = await app.request("/agent/v1/architect/requirement-fulfillment", {
      headers: h(),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.summary.total).toBe(1);
    expect(data.summary.gap).toBe(1);
    expect(data.summary.reflected).toBe(0);
    const gap = data.gaps.find((r: { id: string }) => r.id === req.id);
    expect(gap).toBeDefined();
    expect(gap.fulfillmentStatus).toBe("gap");
  });

  it("classifies APPROVED requirement as reflected when a linked neighbor has post-approval history", async () => {
    // Create requirement first (establishes approvedAt = req.updatedAt = T1)
    const req = await createNode("L1", "Linked Req", "Requirement", {
      status: "APPROVED",
      requirementType: "FUNCTIONAL",
    });
    // Create a service node AFTER the requirement — its node_history.changed_at > req.updatedAt
    const svc = await createNode("L4", "PaymentService", "Service");
    await createEdge(svc.id, req.id, "motivated-by");

    const res = await app.request("/agent/v1/architect/requirement-fulfillment", {
      headers: h(),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const found = data.requirements.find((r: { id: string }) => r.id === req.id);
    expect(found).toBeDefined();
    expect(found.fulfillmentStatus).toBe("reflected");
    expect(data.summary.reflected).toBe(1);
    expect(data.summary.gap).toBe(0);
    // reflected items must not appear in gaps
    expect(data.gaps.find((r: { id: string }) => r.id === req.id)).toBeUndefined();
  });

  it("excludes non-APPROVED requirements (IMPLEMENTED, OBSOLETE, PROPOSED)", async () => {
    await createNode("L1", "Impl Req", "Requirement", { status: "IMPLEMENTED" });
    await createNode("L1", "Obs Req", "Requirement", { status: "OBSOLETE" });
    await createNode("L1", "Draft Req", "Requirement", { status: "PROPOSED" });

    const res = await app.request("/agent/v1/architect/requirement-fulfillment", {
      headers: h(),
    });
    const { data } = await res.json();
    expect(data.summary.total).toBe(0);
  });

  it("returns consistent summary totals", async () => {
    const req1 = await createNode("L1", "Gap Req", "Requirement", { status: "APPROVED" });
    const req2 = await createNode("L1", "Reflected Req", "Requirement", { status: "APPROVED" });
    const svc = await createNode("L4", "AuthService", "Service");
    await createEdge(svc.id, req2.id, "motivated-by");

    const res = await app.request("/agent/v1/architect/requirement-fulfillment", {
      headers: h(),
    });
    const { data } = await res.json();
    expect(data.summary.total).toBe(2);
    expect(data.summary.gap + data.summary.reflected).toBe(data.summary.total);
    // req1 has no linked nodes → gap
    expect(data.gaps.some((r: { id: string }) => r.id === req1.id)).toBe(true);
    // req2 has a linked node created after it → reflected
    expect(data.requirements.find((r: { id: string }) => r.id === req2.id)?.fulfillmentStatus).toBe("reflected");
  });

  it("includes scannedAt and approvedAt timestamps", async () => {
    await createNode("L1", "TS Req", "Requirement", { status: "APPROVED" });

    const res = await app.request("/agent/v1/architect/requirement-fulfillment", {
      headers: h(),
    });
    const { data } = await res.json();
    expect(data.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(data.requirements[0].approvedAt).toBeTruthy();
  });
});

// ── ClassifyChangeSchema contract ──────────────────────────────────────────────

describe("ClassifyChangeSchema", () => {
  it("accepts a non-empty diff string", () => {
    expect(() =>
      ClassifyChangeSchema.parse({ diff: "- old line\n+ new line" })
    ).not.toThrow();
  });

  it("accepts a non-empty filePaths array", () => {
    expect(() =>
      ClassifyChangeSchema.parse({ filePaths: ["apps/api/src/routes/nodes.ts"] })
    ).not.toThrow();
  });

  it("accepts a non-empty nodeTypes array", () => {
    expect(() =>
      ClassifyChangeSchema.parse({ nodeTypes: ["BoundedContext"] })
    ).not.toThrow();
  });

  it("accepts a non-empty nodeIds array of valid UUIDs", () => {
    expect(() =>
      ClassifyChangeSchema.parse({
        nodeIds: ["550e8400-e29b-41d4-a716-446655440000"],
      })
    ).not.toThrow();
  });

  it("accepts all four fields combined", () => {
    expect(() =>
      ClassifyChangeSchema.parse({
        diff: "+ add",
        filePaths: ["apps/api/src/x.ts"],
        nodeTypes: ["Service"],
        nodeIds: ["550e8400-e29b-41d4-a716-446655440000"],
      })
    ).not.toThrow();
  });

  it("rejects empty object — at least one field required", () => {
    expect(() => ClassifyChangeSchema.parse({})).toThrow();
  });

  it("rejects diff that is an empty string", () => {
    expect(() => ClassifyChangeSchema.parse({ diff: "" })).toThrow();
  });

  it("rejects filePaths that is an empty array", () => {
    expect(() => ClassifyChangeSchema.parse({ filePaths: [] })).toThrow();
  });

  it("rejects nodeTypes that is an empty array", () => {
    expect(() => ClassifyChangeSchema.parse({ nodeTypes: [] })).toThrow();
  });

  it("rejects nodeIds that is an empty array", () => {
    expect(() => ClassifyChangeSchema.parse({ nodeIds: [] })).toThrow();
  });

  it("rejects nodeIds containing a non-UUID string", () => {
    expect(() =>
      ClassifyChangeSchema.parse({ nodeIds: ["not-a-uuid"] })
    ).toThrow();
  });
});

// ── classifyFilePath unit tests ───────────────────────────────────────────────

describe("classifyFilePath", () => {
  it("classifies DB migration SQL path as L1 HIGH", () => {
    const r = classifyFilePath("apps/api/src/db/migrations/001_init.sql");
    expect(r?.layer).toBe("L1");
    expect(r?.confidence).toBe("HIGH");
  });

  it("classifies framework types path as L1 HIGH", () => {
    const r = classifyFilePath("packages/framework/src/types.ts");
    expect(r?.layer).toBe("L1");
    expect(r?.confidence).toBe("HIGH");
  });

  it("classifies framework schema path as L1 HIGH", () => {
    const r = classifyFilePath("packages/framework/src/schema/index.ts");
    expect(r?.layer).toBe("L1");
    expect(r?.confidence).toBe("HIGH");
  });

  it("classifies framework core module (non-types) as L2 HIGH", () => {
    const r = classifyFilePath("packages/framework/src/traversal.ts");
    expect(r?.layer).toBe("L2");
    expect(r?.confidence).toBe("HIGH");
  });

  it("classifies shared package as L2 MEDIUM", () => {
    const r = classifyFilePath("packages/shared/src/index.ts");
    expect(r?.layer).toBe("L2");
    expect(r?.confidence).toBe("MEDIUM");
  });

  it("classifies guardrails module as L2 HIGH", () => {
    const r = classifyFilePath("apps/api/src/guardrails/registry.ts");
    expect(r?.layer).toBe("L2");
    expect(r?.confidence).toBe("HIGH");
  });

  it("classifies routes module as L3 HIGH", () => {
    const r = classifyFilePath("apps/api/src/routes/nodes.ts");
    expect(r?.layer).toBe("L3");
    expect(r?.confidence).toBe("HIGH");
  });

  it("classifies MCP app path as L3 HIGH", () => {
    const r = classifyFilePath("apps/mcp/src/index.ts");
    expect(r?.layer).toBe("L3");
    expect(r?.confidence).toBe("HIGH");
  });

  it("classifies agent module as L3 MEDIUM", () => {
    const r = classifyFilePath("apps/api/src/agent/architect.ts");
    expect(r?.layer).toBe("L3");
    expect(r?.confidence).toBe("MEDIUM");
  });

  it("classifies DB access module as L4 HIGH", () => {
    const r = classifyFilePath("apps/api/src/db/client.ts");
    expect(r?.layer).toBe("L4");
    expect(r?.confidence).toBe("HIGH");
  });

  it("classifies frontend (apps/web) as L5 HIGH", () => {
    const r = classifyFilePath("apps/web/src/pages/index.tsx");
    expect(r?.layer).toBe("L5");
    expect(r?.confidence).toBe("HIGH");
  });

  it("classifies .test.ts file as L6", () => {
    const r = classifyFilePath("apps/api/tests/nodes.test.ts");
    expect(r?.layer).toBe("L6");
  });

  it("classifies YAML CI config as L6 HIGH", () => {
    const r = classifyFilePath(".github/workflows/ci.yml");
    expect(r?.layer).toBe("L6");
    expect(r?.confidence).toBe("HIGH");
  });

  it("returns null for an unrecognised path", () => {
    const r = classifyFilePath("random/unknown/file.txt");
    expect(r).toBeNull();
  });
});

// ── pickLayer unit tests ──────────────────────────────────────────────────────

describe("pickLayer", () => {
  const sig = (
    inferredLayer: ChangeSignal["inferredLayer"],
    confidence: ChangeSignal["confidence"]
  ): ChangeSignal => ({
    source: "file_path",
    value: "x",
    inferredLayer,
    confidence,
    rationale: "test",
  });

  it("returns L5 LOW for empty signal list", () => {
    const r = pickLayer([]);
    expect(r.layer).toBe("L5");
    expect(r.confidence).toBe("LOW");
  });

  it("returns the single signal's layer and HIGH confidence", () => {
    const r = pickLayer([sig("L3", "HIGH")]);
    expect(r.layer).toBe("L3");
    expect(r.confidence).toBe("HIGH");
  });

  it("picks worst-case (lowest L number) among HIGH signals", () => {
    const r = pickLayer([sig("L4", "HIGH"), sig("L2", "HIGH"), sig("L5", "HIGH")]);
    expect(r.layer).toBe("L2");
    expect(r.confidence).toBe("HIGH");
  });

  it("ignores MEDIUM/LOW signals when HIGH signals exist", () => {
    const r = pickLayer([sig("L1", "MEDIUM"), sig("L4", "HIGH")]);
    expect(r.layer).toBe("L4");
    expect(r.confidence).toBe("HIGH");
  });

  it("falls back to all signals when no HIGH signals exist", () => {
    const r = pickLayer([sig("L3", "MEDIUM"), sig("L5", "LOW")]);
    expect(r.layer).toBe("L3");
  });

  it("returns MEDIUM confidence when 2+ signals agree on same layer (no HIGH)", () => {
    const r = pickLayer([sig("L3", "MEDIUM"), sig("L3", "LOW")]);
    expect(r.layer).toBe("L3");
    expect(r.confidence).toBe("MEDIUM");
  });

  it("returns LOW confidence for single LOW signal", () => {
    const r = pickLayer([sig("L5", "LOW")]);
    expect(r.layer).toBe("L5");
    expect(r.confidence).toBe("LOW");
  });
});

// ── POST /agent/v1/architect/classify-change ─────────────────────────────────

describe("POST /agent/v1/architect/classify-change", () => {
  it("returns 400 when x-tenant-id header is missing", async () => {
    const res = await app.request("/agent/v1/architect/classify-change", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filePaths: ["apps/api/src/routes/nodes.ts"] }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when body has no valid input field", async () => {
    const res = await app.request("/agent/v1/architect/classify-change", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 200 with classifiedAt and classification shape", async () => {
    const res = await app.request("/agent/v1/architect/classify-change", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ filePaths: ["apps/api/src/routes/nodes.ts"] }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.classifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(data.classification).toMatchObject({
      layer: expect.stringMatching(/^L[1-6]$/),
      confidence: expect.stringMatching(/^(HIGH|MEDIUM|LOW)$/),
      reviewPath: expect.stringMatching(/^(REQUIRE_CONFIRMATION|AUTO_WITH_OVERRIDE|AUTO)$/),
    });
    expect(Array.isArray(data.signals)).toBe(true);
    expect(Array.isArray(data.recommendations)).toBe(true);
  });

  it("classifies framework/types path as L1 REQUIRE_CONFIRMATION", async () => {
    const res = await app.request("/agent/v1/architect/classify-change", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        filePaths: ["packages/framework/src/types.ts"],
      }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.classification.layer).toBe("L1");
    expect(data.classification.reviewPath).toBe("REQUIRE_CONFIRMATION");
    expect(data.signals).toHaveLength(1);
    expect(data.signals[0].source).toBe("file_path");
  });

  it("classifies L5 file path as AUTO", async () => {
    const res = await app.request("/agent/v1/architect/classify-change", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ filePaths: ["apps/web/src/pages/index.tsx"] }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.classification.layer).toBe("L5");
    expect(data.classification.reviewPath).toBe("AUTO");
  });

  it("classifies SQL DDL diff as L1 REQUIRE_CONFIRMATION", async () => {
    const res = await app.request("/agent/v1/architect/classify-change", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        diff: "+CREATE TABLE orders (id uuid PRIMARY KEY);",
      }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.classification.layer).toBe("L1");
    expect(data.classification.reviewPath).toBe("REQUIRE_CONFIRMATION");
    const ddlSignal = data.signals.find(
      (s: { source: string }) => s.source === "diff_content"
    );
    expect(ddlSignal).toBeDefined();
  });

  it("classifies BoundedContext nodeType as L1", async () => {
    const res = await app.request("/agent/v1/architect/classify-change", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ nodeTypes: ["BoundedContext"] }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.classification.layer).toBe("L1");
    expect(data.signals[0].source).toBe("node_type");
  });

  it("classifies Service nodeType as L5 AUTO", async () => {
    const res = await app.request("/agent/v1/architect/classify-change", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ nodeTypes: ["Service"] }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.classification.layer).toBe("L5");
    expect(data.classification.reviewPath).toBe("AUTO");
  });

  it("classifies by nodeIds — looks up DB node layer", async () => {
    // Create an L1 node in the DB
    const createRes = await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "BoundedContext", layer: "L1", name: "PaymentContext" }),
    });
    expect(createRes.status).toBe(201);
    const { data: node } = await createRes.json();

    const res = await app.request("/agent/v1/architect/classify-change", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ nodeIds: [node.id] }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.classification.layer).toBe("L1");
    expect(data.classification.reviewPath).toBe("REQUIRE_CONFIRMATION");
    const nodeSignal = data.signals.find(
      (s: { source: string }) => s.source === "node_id"
    );
    expect(nodeSignal).toBeDefined();
    expect(nodeSignal.value).toBe(node.id);
  });

  it("returns no signals for unknown nodeId (not in DB)", async () => {
    const res = await app.request("/agent/v1/architect/classify-change", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ nodeIds: [randomUUID()] }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    // No signals from the unknown id; defaults to L5
    expect(data.signals).toHaveLength(0);
    expect(data.classification.layer).toBe("L5");
  });

  it("picks worst-case layer when filePaths span multiple layers", async () => {
    const res = await app.request("/agent/v1/architect/classify-change", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        filePaths: [
          "apps/web/src/pages/index.tsx",
          "packages/framework/src/types.ts",
        ],
      }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    // L1 is worse than L5 — must win
    expect(data.classification.layer).toBe("L1");
  });

  it("includes L1/L2 recommendations for REQUIRE_CONFIRMATION paths", async () => {
    const res = await app.request("/agent/v1/architect/classify-change", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ filePaths: ["packages/framework/src/types.ts"] }),
    });
    const { data } = await res.json();
    expect(
      data.recommendations.some((r: string) => r.includes("confirmation"))
    ).toBe(true);
  });

  it("includes AUTO recommendation for L5/L6 paths", async () => {
    const res = await app.request("/agent/v1/architect/classify-change", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ filePaths: ["apps/web/src/pages/index.tsx"] }),
    });
    const { data } = await res.json();
    expect(
      data.recommendations.some((r: string) => r.includes("autonomously"))
    ).toBe(true);
  });
});
