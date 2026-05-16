// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import type { Sql } from "../src/db/client.js";
import { GuardrailsRegistry } from "../src/guardrails/index.js";
import type { NodeRow, EdgeRow, GuardrailRow } from "../src/db/types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeNodeRow(overrides: Partial<NodeRow> = {}): NodeRow {
  return {
    id: "node-1",
    tenantId: "t1",
    type: "Service",
    layer: "L3",
    name: "auth-service",
    version: "1.0.0",
    lifecycleStatus: "ACTIVE",
    attributes: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    deprecatedAt: null,
    archivedAt: null,
    purgeAfter: null,
    ...overrides,
  };
}

function makeEdgeRow(overrides: Partial<EdgeRow> = {}): EdgeRow {
  return {
    id: "edge-1",
    tenantId: "t1",
    sourceId: "src",
    targetId: "tgt",
    type: "CALLS",
    layer: "L3",
    traversalWeight: 1.0,
    attributes: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeGuardrailRow(overrides: Partial<GuardrailRow>): GuardrailRow {
  return {
    id: "gr-1",
    tenantId: "t1",
    description: "",
    severity: "WARN",
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ruleKey: "naming.node.min_length",
    config: {},
    ...overrides,
  };
}

function makeSqlWith(rows: unknown[]): Sql {
  const fn = (_first: unknown, ..._rest: unknown[]) => Promise.resolve(rows);
  return fn as unknown as Sql;
}

// ── naming.node.min_length ────────────────────────────────────────────────────

describe("built-in check: naming.node.min_length", () => {
  it("returns no violation when name meets minimum length", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "naming.node.min_length", config: { min: 3 } })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ name: "auth" }));
    expect(violations).toHaveLength(0);
  });

  it("returns a violation when name is shorter than configured min", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "naming.node.min_length", config: { min: 10 } })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ name: "auth" }));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("naming.node.min_length");
    expect(violations[0]?.severity).toBe("WARN");
    expect(violations[0]?.nodeId).toBe("node-1");
    expect(violations[0]?.message).toContain("auth");
  });

  it("uses default min of 3 when config.min is absent", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "naming.node.min_length", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ name: "ab" }));
    expect(violations).toHaveLength(1);
  });

  it("name exactly at min length produces no violation", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "naming.node.min_length", config: { min: 4 } })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ name: "auth" }));
    expect(violations).toHaveLength(0);
  });

  it("returns no violation for an edge (no 'name' property)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "naming.node.min_length", config: { min: 3 } })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeEdgeRow());
    expect(violations).toHaveLength(0);
  });

  it("violation message includes the node name and configured min", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "naming.node.min_length", config: { min: 20 } })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ name: "svc" }));
    expect(violations[0]?.message).toContain("svc");
    expect(violations[0]?.message).toContain("20");
  });
});

// ── lifecycle.review_cycle ────────────────────────────────────────────────────

describe("built-in check: lifecycle.review_cycle", () => {
  it("returns no violation for a recently updated ACTIVE node", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "lifecycle.review_cycle", config: { maxAgeDays: 365 } })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ updatedAt: new Date() }));
    expect(violations).toHaveLength(0);
  });

  it("returns a violation for a stale ACTIVE node", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "lifecycle.review_cycle", config: { maxAgeDays: 1 } })]);
    const registry = new GuardrailsRegistry(sql);
    const staleDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const violations = await registry.evaluate("t1", makeNodeRow({ updatedAt: staleDate }));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("lifecycle.review_cycle");
    expect(violations[0]?.nodeId).toBe("node-1");
  });

  it("skips check for DEPRECATED nodes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "lifecycle.review_cycle", config: { maxAgeDays: 1 } })]);
    const registry = new GuardrailsRegistry(sql);
    const staleDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const violations = await registry.evaluate("t1", makeNodeRow({ lifecycleStatus: "DEPRECATED", updatedAt: staleDate }));
    expect(violations).toHaveLength(0);
  });

  it("skips check for ARCHIVED nodes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "lifecycle.review_cycle", config: { maxAgeDays: 1 } })]);
    const registry = new GuardrailsRegistry(sql);
    const staleDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const violations = await registry.evaluate("t1", makeNodeRow({ lifecycleStatus: "ARCHIVED", updatedAt: staleDate }));
    expect(violations).toHaveLength(0);
  });

  it("uses default maxAgeDays of 365 when config is empty", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "lifecycle.review_cycle", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const recentDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    const violations = await registry.evaluate("t1", makeNodeRow({ updatedAt: recentDate }));
    expect(violations).toHaveLength(0);
  });

  it("violation message includes node name and day count", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "lifecycle.review_cycle", config: { maxAgeDays: 1 } })]);
    const registry = new GuardrailsRegistry(sql);
    const staleDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const violations = await registry.evaluate("t1", makeNodeRow({ name: "payment-svc", updatedAt: staleDate }));
    expect(violations[0]?.message).toContain("payment-svc");
    expect(violations[0]?.message).toContain("1");
  });

  it("returns no violation for an edge (no 'lifecycleStatus' property)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "lifecycle.review_cycle", config: { maxAgeDays: 1 } })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeEdgeRow());
    expect(violations).toHaveLength(0);
  });
});

// ── GuardrailsRegistry.evaluate — orchestration ───────────────────────────────

describe("GuardrailsRegistry.evaluate — orchestration", () => {
  it("returns empty array when no guardrails are enabled", async () => {
    const sql = makeSqlWith([]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow());
    expect(violations).toHaveLength(0);
  });

  it("skips unknown ruleKeys without throwing", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "custom.unknown.rule", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow());
    expect(violations).toHaveLength(0);
  });

  it("accumulates violations from multiple enabled checks", async () => {
    const sql = makeSqlWith([
      makeGuardrailRow({ id: "gr-1", ruleKey: "naming.node.min_length", config: { min: 100 } }),
      makeGuardrailRow({ id: "gr-2", ruleKey: "lifecycle.review_cycle", config: { maxAgeDays: 1 } }),
    ]);
    const registry = new GuardrailsRegistry(sql);
    const staleDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const violations = await registry.evaluate("t1", makeNodeRow({ name: "x", updatedAt: staleDate }));
    expect(violations).toHaveLength(2);
    const ruleKeys = violations.map((v) => v.ruleKey);
    expect(ruleKeys).toContain("naming.node.min_length");
    expect(ruleKeys).toContain("lifecycle.review_cycle");
  });

  it("returns only relevant violations when one check passes and one fails", async () => {
    const sql = makeSqlWith([
      makeGuardrailRow({ id: "gr-1", ruleKey: "naming.node.min_length", config: { min: 3 } }),
      makeGuardrailRow({ id: "gr-2", ruleKey: "lifecycle.review_cycle", config: { maxAgeDays: 1 } }),
    ]);
    const registry = new GuardrailsRegistry(sql);
    const staleDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const violations = await registry.evaluate("t1", makeNodeRow({ name: "auth-service", updatedAt: staleDate }));
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("lifecycle.review_cycle");
  });
});

// ── GR-L3-004: ExternalSystem CRITICAL without fallbackStrategy ───────────────

describe("built-in check: GR-L3-004 (ExternalSystem CRITICAL without fallbackStrategy)", () => {
  it("fires for CRITICAL ExternalSystem with no fallbackStrategy", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L3-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ExternalSystem", layer: "L3", attributes: { criticality: "CRITICAL" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L3-004");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.nodeId).toBe(node.id);
  });

  it("fires for CRITICAL ExternalSystem with fallbackStrategy shorter than 20 chars", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L3-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ExternalSystem", layer: "L3", attributes: { criticality: "CRITICAL", fallbackStrategy: "short" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
  });

  it("does not fire for CRITICAL ExternalSystem with valid fallbackStrategy (≥ 20 chars)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L3-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ExternalSystem", layer: "L3", attributes: { criticality: "CRITICAL", fallbackStrategy: "Degrade to read-only cache mode" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for HIGH ExternalSystem (only CRITICAL is in scope)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L3-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ExternalSystem", layer: "L3", attributes: { criticality: "HIGH" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for non-ExternalSystem nodes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L3-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ type: "Service", attributes: { criticality: "CRITICAL" } }));
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L3-005: ExternalSystem CRITICAL/HIGH without slaReference ──────────────

describe("built-in check: GR-L3-005 (ExternalSystem CRITICAL/HIGH without slaReference)", () => {
  it("fires for HIGH ExternalSystem with no slaReference", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L3-005", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ExternalSystem", layer: "L3", attributes: { criticality: "HIGH" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L3-005");
    expect(violations[0]?.severity).toBe("ERROR");
  });

  it("fires for CRITICAL ExternalSystem with no slaReference", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L3-005", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ExternalSystem", layer: "L3", attributes: { criticality: "CRITICAL", fallbackStrategy: "Use secondary queue for all writes" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L3-005");
  });

  it("does not fire for HIGH ExternalSystem with valid slaReference (≥ 10 chars)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L3-005", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ExternalSystem", layer: "L3", attributes: { criticality: "HIGH", slaReference: "https://vendor.example/sla" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for MEDIUM ExternalSystem (below HIGH threshold)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L3-005", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ExternalSystem", layer: "L3", attributes: { criticality: "MEDIUM" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L3-009: ExternalSystem review older than 180 days ─────────────────────

describe("built-in check: GR-L3-009 (ExternalSystem stale review date)", () => {
  it("fires when lastReviewDate is older than 180 days", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L3-009", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const staleDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const node = makeNodeRow({ type: "ExternalSystem", layer: "L3", attributes: { lastReviewDate: staleDate } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L3-009");
    expect(violations[0]?.severity).toBe("WARN");
  });

  it("does not fire when lastReviewDate is within 180 days", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L3-009", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const recentDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const node = makeNodeRow({ type: "ExternalSystem", layer: "L3", attributes: { lastReviewDate: recentDate } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire when lastReviewDate is absent (handled by a separate ownership rule)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L3-009", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ExternalSystem", layer: "L3", attributes: { criticality: "HIGH" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("also accepts snake_case last_review_date attribute", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L3-009", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const staleDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const node = makeNodeRow({ type: "ExternalSystem", layer: "L3", attributes: { last_review_date: staleDate } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
  });
});

// ── GR-L5-004: ExternalDependency CRITICAL without securityAuditDate ──────────

describe("built-in check: GR-L5-004 (ExternalDependency CRITICAL without securityAuditDate)", () => {
  it("fires for CRITICAL ExternalDependency with no securityAuditDate", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ExternalDependency", layer: "L5", attributes: { criticality: "CRITICAL" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L5-004");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.nodeId).toBe(node.id);
  });

  it("does not fire for CRITICAL ExternalDependency with securityAuditDate set", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ExternalDependency", layer: "L5", attributes: { criticality: "CRITICAL", securityAuditDate: "2026-01-15" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for HIGH ExternalDependency (only CRITICAL is in scope)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ExternalDependency", layer: "L5", attributes: { criticality: "HIGH" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for non-ExternalDependency nodes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ type: "Package", attributes: { criticality: "CRITICAL" } }));
    expect(violations).toHaveLength(0);
  });

  it("also accepts snake_case security_audit_date attribute", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ExternalDependency", layer: "L5", attributes: { criticality: "CRITICAL", security_audit_date: "2026-01-15" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L5-007: ExternalDependency with GPL-family license in COMMERCIAL context

describe("built-in check: GR-L5-007 (ExternalDependency GPL license)", () => {
  it("fires for ExternalDependency with GPL-3.0 license in COMMERCIAL distribution context", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-007", config: { distribution: { context: "COMMERCIAL" } } })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ExternalDependency", layer: "L5", attributes: { license: "GPL-3.0" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L5-007");
    expect(violations[0]?.severity).toBe("WARN");
    expect(violations[0]?.message).toContain("GPL-3.0");
  });

  it("fires for ExternalDependency with GPL-2.0-only license in COMMERCIAL distribution context", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-007", config: { distribution: { context: "COMMERCIAL" } } })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ExternalDependency", layer: "L5", attributes: { license: "GPL-2.0-only" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
  });

  it("does not fire for GPL-3.0 when distribution.context is not configured (open-source / internal deployment)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-007", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ExternalDependency", layer: "L5", attributes: { license: "GPL-3.0" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for GPL-3.0 when distribution.context is INTERNAL", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-007", config: { distribution: { context: "INTERNAL" } } })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ExternalDependency", layer: "L5", attributes: { license: "GPL-3.0" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for ExternalDependency with LGPL-2.1 license (LGPL does not start with GPL)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-007", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ExternalDependency", layer: "L5", attributes: { license: "LGPL-2.1" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for ExternalDependency with MIT license", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-007", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ExternalDependency", layer: "L5", attributes: { license: "MIT" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire when license attribute is absent", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-007", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ExternalDependency", layer: "L5", attributes: { criticality: "HIGH" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for non-ExternalDependency nodes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-007", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ type: "Service", attributes: { license: "GPL-3.0" } }));
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L1-002: BusinessGoal must have at least one success_metric ─────────────

describe("built-in check: GR-L1-002 (BusinessGoal success_metrics)", () => {
  it("fires for BusinessGoal with no success_metrics", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L1-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "BusinessGoal", layer: "L1", attributes: {} });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L1-002");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.nodeId).toBe(node.id);
  });

  it("fires for BusinessGoal with empty success_metrics array", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L1-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "BusinessGoal", layer: "L1", attributes: { success_metrics: [] } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
  });

  it("does not fire for BusinessGoal with at least one success_metric", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L1-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "BusinessGoal", layer: "L1", attributes: { success_metrics: ["NPS > 50"] } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("also accepts camelCase successMetrics attribute", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L1-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "BusinessGoal", layer: "L1", attributes: { successMetrics: ["ARR 1M"] } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for non-BusinessGoal nodes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L1-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ type: "Requirement", attributes: {} }));
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L1-003: Requirement.motivation non-null/non-empty ─────────────────────

describe("built-in check: GR-L1-003 (Requirement motivation)", () => {
  it("fires for Requirement with no motivation", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L1-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Requirement", layer: "L1", attributes: {} });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L1-003");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.nodeId).toBe(node.id);
  });

  it("fires for Requirement with blank motivation", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L1-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Requirement", layer: "L1", attributes: { motivation: "   " } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
  });

  it("does not fire for Requirement with non-empty motivation", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L1-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Requirement", layer: "L1", attributes: { motivation: "Reduce churn by improving onboarding" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for non-Requirement nodes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L1-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ type: "BusinessGoal", attributes: {} }));
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L1-004: Requirement must have at least one acceptance_criterion ────────

describe("built-in check: GR-L1-004 (Requirement acceptance_criteria)", () => {
  it("fires for Requirement with no acceptance_criteria", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L1-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Requirement", layer: "L1", attributes: { motivation: "Improve UX" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L1-004");
    expect(violations[0]?.severity).toBe("ERROR");
  });

  it("fires for Requirement with empty acceptance_criteria array", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L1-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Requirement", layer: "L1", attributes: { acceptance_criteria: [] } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
  });

  it("does not fire for Requirement with at least one criterion", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L1-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Requirement", layer: "L1", attributes: { acceptance_criteria: ["Given X when Y then Z"] } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("also accepts camelCase acceptanceCriteria attribute", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L1-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Requirement", layer: "L1", attributes: { acceptanceCriteria: ["System returns 200 in < 500ms"] } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L2-003: DomainEntity must have at least one invariant ─────────────────

describe("built-in check: GR-L2-003 (DomainEntity invariants)", () => {
  it("fires for DomainEntity with no invariants", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L2-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "DomainEntity", layer: "L2", attributes: {} });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L2-003");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.nodeId).toBe(node.id);
  });

  it("fires for DomainEntity with empty invariants array", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L2-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "DomainEntity", layer: "L2", attributes: { invariants: [] } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
  });

  it("does not fire for DomainEntity with at least one invariant", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L2-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "DomainEntity", layer: "L2", attributes: { invariants: ["Amount must be positive"] } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for non-DomainEntity nodes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L2-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ type: "Aggregate", attributes: {} }));
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L2-004: Aggregate.transaction_boundary non-null ───────────────────────

describe("built-in check: GR-L2-004 (Aggregate transaction_boundary)", () => {
  it("fires for Aggregate with no transaction_boundary", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L2-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Aggregate", layer: "L2", attributes: {} });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L2-004");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.nodeId).toBe(node.id);
  });

  it("does not fire for Aggregate with transaction_boundary set", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L2-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Aggregate", layer: "L2", attributes: { transaction_boundary: "Order" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("also accepts camelCase transactionBoundary attribute", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L2-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Aggregate", layer: "L2", attributes: { transactionBoundary: "Payment" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for non-Aggregate nodes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L2-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ type: "DomainEntity", attributes: {} }));
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L3-001: ArchitectureComponent.technology non-null/non-empty ────────────

describe("built-in check: GR-L3-001 (ArchitectureComponent technology)", () => {
  it("fires for ArchitectureComponent with no technology", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L3-001", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ArchitectureComponent", layer: "L3", attributes: {} });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L3-001");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.nodeId).toBe(node.id);
  });

  it("does not fire for ArchitectureComponent with technology set", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L3-001", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ArchitectureComponent", layer: "L3", attributes: { technology: "Node.js" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("fires for ArchitectureComponent with blank technology string", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L3-001", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ArchitectureComponent", layer: "L3", attributes: { technology: "  " } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
  });

  it("does not fire for non-ArchitectureComponent nodes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L3-001", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ type: "Service", attributes: {} }));
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L3-002: ADR must have at least one alternative considered ──────────────

describe("built-in check: GR-L3-002 (ADR alternatives_considered)", () => {
  it("fires for ADR with no alternatives_considered", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L3-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ADR", layer: "L3", attributes: {} });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L3-002");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.nodeId).toBe(node.id);
  });

  it("fires for ADR with empty alternatives_considered array", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L3-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ADR", layer: "L3", attributes: { alternatives_considered: [] } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
  });

  it("does not fire for ADR with at least one alternative", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L3-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ADR", layer: "L3", attributes: { alternatives_considered: ["REST vs GraphQL"] } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("also accepts camelCase alternativesConsidered attribute", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L3-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "ADR", layer: "L3", attributes: { alternativesConsidered: ["Kafka vs RabbitMQ"] } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L4-001: APIEndpoint must have at least one error_response ──────────────

describe("built-in check: GR-L4-001 (APIEndpoint error_responses)", () => {
  it("fires for APIEndpoint with no error_responses", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L4-001", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "APIEndpoint", layer: "L4", attributes: {} });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L4-001");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.nodeId).toBe(node.id);
  });

  it("fires for APIEndpoint with empty error_responses array", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L4-001", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "APIEndpoint", layer: "L4", attributes: { error_responses: [] } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
  });

  it("does not fire for APIEndpoint with at least one error_response", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L4-001", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "APIEndpoint", layer: "L4", attributes: { error_responses: [{ status: 400, description: "Bad request" }] } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("also accepts camelCase errorResponses attribute", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L4-001", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "APIEndpoint", layer: "L4", attributes: { errorResponses: [{ status: 404 }] } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for non-APIEndpoint nodes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L4-001", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ type: "APIContract", attributes: {} }));
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L4-002: APIEndpoint.response_schema non-null ──────────────────────────

describe("built-in check: GR-L4-002 (APIEndpoint response_schema)", () => {
  it("fires for APIEndpoint with no response_schema", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L4-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "APIEndpoint", layer: "L4", attributes: {} });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L4-002");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.nodeId).toBe(node.id);
  });

  it("does not fire for APIEndpoint with response_schema set", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L4-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "APIEndpoint", layer: "L4", attributes: { response_schema: { type: "object" } } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("also accepts camelCase responseSchema attribute", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L4-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "APIEndpoint", layer: "L4", attributes: { responseSchema: "#/components/schemas/User" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for non-APIEndpoint nodes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L4-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ type: "EventContract", attributes: {} }));
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L4-003: EventContract ordering_guarantee AND delivery_guarantee ────────

describe("built-in check: GR-L4-003 (EventContract guarantees)", () => {
  it("fires for EventContract missing both guarantees", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L4-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "EventContract", layer: "L4", attributes: {} });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L4-003");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.message).toContain("ordering_guarantee");
    expect(violations[0]?.message).toContain("delivery_guarantee");
  });

  it("fires for EventContract missing only delivery_guarantee", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L4-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "EventContract", layer: "L4", attributes: { ordering_guarantee: "ORDERED" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("delivery_guarantee");
    expect(violations[0]?.message).not.toContain("ordering_guarantee");
  });

  it("fires for EventContract missing only ordering_guarantee", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L4-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "EventContract", layer: "L4", attributes: { delivery_guarantee: "AT_LEAST_ONCE" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("ordering_guarantee");
  });

  it("does not fire for EventContract with both guarantees present", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L4-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "EventContract", layer: "L4", attributes: { ordering_guarantee: "ORDERED", delivery_guarantee: "AT_LEAST_ONCE" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("also accepts camelCase attribute names", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L4-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "EventContract", layer: "L4", attributes: { orderingGuarantee: "UNORDERED", deliveryGuarantee: "EXACTLY_ONCE" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for non-EventContract nodes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L4-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ type: "APIEndpoint", attributes: {} }));
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L4-004: APIContract.version non-null AND valid semver ─────────────────

describe("built-in check: GR-L4-004 (APIContract semver version)", () => {
  it("fires for APIContract with no version", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L4-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "APIContract", layer: "L4", attributes: {} });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L4-004");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.nodeId).toBe(node.id);
  });

  it("fires for APIContract with non-semver version string", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L4-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "APIContract", layer: "L4", attributes: { version: "v2" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("v2");
  });

  it("does not fire for APIContract with valid semver version", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L4-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "APIContract", layer: "L4", attributes: { version: "2.1.0" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for APIContract with semver version including pre-release tag", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L4-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "APIContract", layer: "L4", attributes: { version: "1.0.0-beta.1" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for non-APIContract nodes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L4-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ type: "APIEndpoint", attributes: {} }));
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L5-001: TechnicalDebt.rationale non-null/non-empty ────────────────────

describe("built-in check: GR-L5-001 (TechnicalDebt rationale)", () => {
  it("fires for TechnicalDebt with no rationale", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-001", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "TechnicalDebt", layer: "L5", attributes: {} });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L5-001");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.nodeId).toBe(node.id);
  });

  it("fires for TechnicalDebt with blank rationale", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-001", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "TechnicalDebt", layer: "L5", attributes: { rationale: "  " } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
  });

  it("does not fire for TechnicalDebt with non-empty rationale", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-001", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "TechnicalDebt", layer: "L5", attributes: { rationale: "Chosen for speed of delivery; refactor planned Q3" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for non-TechnicalDebt nodes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-001", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ type: "CodeModule", attributes: {} }));
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L5-002: CodeModule.repository_reference non-null ──────────────────────

describe("built-in check: GR-L5-002 (CodeModule repository_reference)", () => {
  it("fires for CodeModule with no repository_reference", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "CodeModule", layer: "L5", attributes: {} });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L5-002");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.nodeId).toBe(node.id);
  });

  it("does not fire for CodeModule with repository_reference set", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "CodeModule", layer: "L5", attributes: { repository_reference: "github.com/org/repo/src/payments" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("also accepts camelCase repositoryReference attribute", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "CodeModule", layer: "L5", attributes: { repositoryReference: "github.com/org/repo" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for non-CodeModule nodes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ type: "TechnicalDebt", attributes: {} }));
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L6-001: InfrastructureComponent.iac_reference non-null ────────────────

describe("built-in check: GR-L6-001 (InfrastructureComponent iac_reference)", () => {
  it("fires for InfrastructureComponent with no iac_reference", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-001", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "InfrastructureComponent", layer: "L6", attributes: {} });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L6-001");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.nodeId).toBe(node.id);
  });

  it("does not fire for InfrastructureComponent with iac_reference set", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-001", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "InfrastructureComponent", layer: "L6", attributes: { iac_reference: "terraform/modules/rds" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("also accepts camelCase iacReference attribute", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-001", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "InfrastructureComponent", layer: "L6", attributes: { iacReference: "terraform/modules/vpc" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for non-InfrastructureComponent nodes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-001", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ type: "Alert", attributes: {} }));
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L6-002: Alert.runbook_reference non-null ───────────────────────────────

describe("built-in check: GR-L6-002 (Alert runbook_reference)", () => {
  it("fires for Alert with no runbook_reference", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Alert", layer: "L6", attributes: {} });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L6-002");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.nodeId).toBe(node.id);
  });

  it("does not fire for Alert with runbook_reference set", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Alert", layer: "L6", attributes: { runbook_reference: "https://runbooks.internal/high-error-rate" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("also accepts camelCase runbookReference attribute", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Alert", layer: "L6", attributes: { runbookReference: "https://runbooks.internal/db-down" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for non-Alert nodes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ type: "InfrastructureComponent", attributes: {} }));
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L6-006: Environment (PRODUCTION/DR) must have iac_reference ────────────

describe("built-in check: GR-L6-006 (Environment PRODUCTION/DR iac_reference)", () => {
  it("fires for PRODUCTION Environment with no iac_reference", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-006", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Environment", layer: "L6", attributes: { environment_type: "PRODUCTION" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L6-006");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.nodeId).toBe(node.id);
    expect(violations[0]?.message).toContain("PRODUCTION");
  });

  it("fires for DR Environment with no iac_reference", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-006", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Environment", layer: "L6", attributes: { environment_type: "DR" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("DR");
  });

  it("does not fire for PRODUCTION Environment with iac_reference set", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-006", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Environment", layer: "L6", attributes: { environment_type: "PRODUCTION", iac_reference: "terraform/envs/prod" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for STAGING Environment (only PRODUCTION/DR are in scope)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-006", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Environment", layer: "L6", attributes: { environment_type: "STAGING" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("also accepts camelCase attributes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-006", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Environment", layer: "L6", attributes: { environmentType: "PRODUCTION", iacReference: "terraform/envs/prod" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L6-007: Environment (PRODUCTION/DR) must have promotion_gate ──────────

describe("built-in check: GR-L6-007 (Environment PRODUCTION/DR promotion_gate)", () => {
  it("fires for PRODUCTION Environment with no promotion_gate", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-007", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Environment", layer: "L6", attributes: { environment_type: "PRODUCTION" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L6-007");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.nodeId).toBe(node.id);
    expect(violations[0]?.message).toContain("PRODUCTION");
  });

  it("fires for DR Environment with no promotion_gate", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-007", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Environment", layer: "L6", attributes: { environment_type: "DR" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("DR");
  });

  it("does not fire for PRODUCTION Environment with promotion_gate set", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-007", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Environment", layer: "L6", attributes: { environment_type: "PRODUCTION", promotion_gate: "manual-approval-required" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for DEVELOPMENT Environment (only PRODUCTION/DR are in scope)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-007", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Environment", layer: "L6", attributes: { environment_type: "DEVELOPMENT" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("also accepts camelCase promotionGate attribute", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-007", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Environment", layer: "L6", attributes: { environmentType: "PRODUCTION", promotionGate: "2-approvers" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });
});

// ── GR-XL-002: Relationship targets a non-existent object ────────────────────

describe("built-in check: GR-XL-002 (edge targets non-existent object)", () => {
  it("fires when edge attributes.targetExists is false", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const edge = makeEdgeRow({ type: "depends-on", attributes: { targetExists: false } });
    const violations = await registry.evaluate("t1", edge);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-XL-002");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.edgeId).toBe(edge.id);
    expect(violations[0]?.sourceNodeId).toBe(edge.sourceId);
    expect(violations[0]?.targetNodeId).toBe(edge.targetId);
  });

  it("fires when snake_case target_exists is false", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const edge = makeEdgeRow({ attributes: { target_exists: false } });
    const violations = await registry.evaluate("t1", edge);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-XL-002");
  });

  it("does not fire when targetExists is true", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const edge = makeEdgeRow({ attributes: { targetExists: true } });
    const violations = await registry.evaluate("t1", edge);
    expect(violations).toHaveLength(0);
  });

  it("does not fire when targetExists is absent (conservative — no flag means no violation)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const edge = makeEdgeRow({ attributes: {} });
    const violations = await registry.evaluate("t1", edge);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for node rows", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ attributes: { targetExists: false } }));
    expect(violations).toHaveLength(0);
  });

  it("violation message includes source and target ids", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-002", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const edge = makeEdgeRow({ sourceId: "node-a", targetId: "node-b", attributes: { targetExists: false } });
    const violations = await registry.evaluate("t1", edge);
    expect(violations[0]?.message).toContain("node-b");
  });
});

// ── GR-XL-003: Relationship violates layer rules ──────────────────────────────

describe("built-in check: GR-XL-003 (edge violates layer rules)", () => {
  it("fires when layer distance exceeds default max of 2 (L1 → L5, distance 4)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const edge = makeEdgeRow({ attributes: { sourceLayer: "L1", targetLayer: "L5" } });
    const violations = await registry.evaluate("t1", edge);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-XL-003");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.edgeId).toBe(edge.id);
    expect(violations[0]?.sourceNodeId).toBe(edge.sourceId);
    expect(violations[0]?.targetNodeId).toBe(edge.targetId);
  });

  it("fires for snake_case source_layer / target_layer attributes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const edge = makeEdgeRow({ attributes: { source_layer: "L1", target_layer: "L6" } });
    const violations = await registry.evaluate("t1", edge);
    expect(violations).toHaveLength(1);
  });

  it("does not fire when layer distance is within default max (L2 → L4, distance 2)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const edge = makeEdgeRow({ attributes: { sourceLayer: "L2", targetLayer: "L4" } });
    const violations = await registry.evaluate("t1", edge);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for adjacent layers (L3 → L4, distance 1)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const edge = makeEdgeRow({ attributes: { sourceLayer: "L3", targetLayer: "L4" } });
    const violations = await registry.evaluate("t1", edge);
    expect(violations).toHaveLength(0);
  });

  it("respects custom maxLayerDistance config", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-003", config: { maxLayerDistance: 1 } })]);
    const registry = new GuardrailsRegistry(sql);
    const edge = makeEdgeRow({ attributes: { sourceLayer: "L1", targetLayer: "L3" } });
    const violations = await registry.evaluate("t1", edge);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("L1");
    expect(violations[0]?.message).toContain("L3");
  });

  it("does not fire when layer attributes are absent", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const edge = makeEdgeRow({ attributes: {} });
    const violations = await registry.evaluate("t1", edge);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for node rows", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ attributes: { sourceLayer: "L1", targetLayer: "L6" } }));
    expect(violations).toHaveLength(0);
  });
});

// ── GR-XL-004: Archiving an object with ACTIVE incoming dependents ────────────

describe("built-in check: GR-XL-004 (archiving node with active incoming dependents)", () => {
  it("fires for ARCHIVED node with activeIncomingCount > 0", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ lifecycleStatus: "ARCHIVED", attributes: { activeIncomingCount: 3 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-XL-004");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.nodeId).toBe(node.id);
  });

  it("fires for snake_case active_incoming_count attribute", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ lifecycleStatus: "ARCHIVED", attributes: { active_incoming_count: 1 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
  });

  it("does not fire for ARCHIVED node with activeIncomingCount of 0", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ lifecycleStatus: "ARCHIVED", attributes: { activeIncomingCount: 0 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for ACTIVE node even with activeIncomingCount > 0", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ lifecycleStatus: "ACTIVE", attributes: { activeIncomingCount: 5 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for DEPRECATED node with activeIncomingCount > 0 (different rule)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ lifecycleStatus: "DEPRECATED", attributes: { activeIncomingCount: 2 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for edge rows", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeEdgeRow({ attributes: { activeIncomingCount: 3 } }));
    expect(violations).toHaveLength(0);
  });

  it("violation message includes node name and count", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ name: "legacy-svc", lifecycleStatus: "ARCHIVED", attributes: { activeIncomingCount: 2 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations[0]?.message).toContain("legacy-svc");
    expect(violations[0]?.message).toContain("2");
  });
});

// ── GR-XL-006: DEPRECATED object still has active depends-on dependents ───────

describe("built-in check: GR-XL-006 (deprecated node with active depends-on dependents)", () => {
  it("fires for DEPRECATED node with activeDependsOnCount > 0", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-006", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ lifecycleStatus: "DEPRECATED", attributes: { activeDependsOnCount: 4 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-XL-006");
    expect(violations[0]?.severity).toBe("WARN");
    expect(violations[0]?.nodeId).toBe(node.id);
  });

  it("fires for snake_case active_depends_on_count attribute", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-006", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ lifecycleStatus: "DEPRECATED", attributes: { active_depends_on_count: 2 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
  });

  it("does not fire for DEPRECATED node with activeDependsOnCount of 0", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-006", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ lifecycleStatus: "DEPRECATED", attributes: { activeDependsOnCount: 0 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for ACTIVE node with activeDependsOnCount > 0", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-006", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ lifecycleStatus: "ACTIVE", attributes: { activeDependsOnCount: 3 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for edge rows", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-006", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeEdgeRow({ attributes: { activeDependsOnCount: 2 } }));
    expect(violations).toHaveLength(0);
  });

  it("violation message includes node name and count", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-006", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ name: "old-payments-api", lifecycleStatus: "DEPRECATED", attributes: { activeDependsOnCount: 5 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations[0]?.message).toContain("old-payments-api");
    expect(violations[0]?.message).toContain("5");
  });
});

// ── GR-XL-010: ARCHIVED object has non-archived contains children ─────────────

describe("built-in check: GR-XL-010 (archived node with non-archived contains children)", () => {
  it("fires for ARCHIVED node with nonArchivedContainsCount > 0", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-010", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ lifecycleStatus: "ARCHIVED", attributes: { nonArchivedContainsCount: 2 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-XL-010");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.nodeId).toBe(node.id);
  });

  it("fires for snake_case non_archived_contains_count attribute", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-010", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ lifecycleStatus: "ARCHIVED", attributes: { non_archived_contains_count: 1 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
  });

  it("does not fire for ARCHIVED node with nonArchivedContainsCount of 0", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-010", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ lifecycleStatus: "ARCHIVED", attributes: { nonArchivedContainsCount: 0 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for ACTIVE node (lifecycle gate)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-010", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ lifecycleStatus: "ACTIVE", attributes: { nonArchivedContainsCount: 3 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for edge rows", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-010", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeEdgeRow({ attributes: { nonArchivedContainsCount: 2 } }));
    expect(violations).toHaveLength(0);
  });

  it("violation message includes node name and count", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-010", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ name: "bounded-context-payments", lifecycleStatus: "ARCHIVED", attributes: { nonArchivedContainsCount: 3 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations[0]?.message).toContain("bounded-context-payments");
    expect(violations[0]?.message).toContain("3");
  });
});

// ── GR-L5-003: DOMAIN CodeModule depends-on INFRASTRUCTURE module ─────────────

describe("built-in check: GR-L5-003 (DOMAIN CodeModule depends-on INFRASTRUCTURE)", () => {
  it("fires for depends-on edge with sourceModuleType=DOMAIN and targetModuleType=INFRASTRUCTURE", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const edge = makeEdgeRow({ type: "depends-on", attributes: { sourceModuleType: "DOMAIN", targetModuleType: "INFRASTRUCTURE" } });
    const violations = await registry.evaluate("t1", edge);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L5-003");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.edgeId).toBe(edge.id);
    expect(violations[0]?.sourceNodeId).toBe(edge.sourceId);
    expect(violations[0]?.targetNodeId).toBe(edge.targetId);
  });

  it("fires for snake_case source_module_type / target_module_type attributes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const edge = makeEdgeRow({ type: "depends-on", attributes: { source_module_type: "DOMAIN", target_module_type: "INFRASTRUCTURE" } });
    const violations = await registry.evaluate("t1", edge);
    expect(violations).toHaveLength(1);
  });

  it("does not fire for depends-on edge where source is APPLICATION (not DOMAIN)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const edge = makeEdgeRow({ type: "depends-on", attributes: { sourceModuleType: "APPLICATION", targetModuleType: "INFRASTRUCTURE" } });
    const violations = await registry.evaluate("t1", edge);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for depends-on edge where target is APPLICATION (not INFRASTRUCTURE)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const edge = makeEdgeRow({ type: "depends-on", attributes: { sourceModuleType: "DOMAIN", targetModuleType: "APPLICATION" } });
    const violations = await registry.evaluate("t1", edge);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for a different edge type (calls, not depends-on)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const edge = makeEdgeRow({ type: "calls", attributes: { sourceModuleType: "DOMAIN", targetModuleType: "INFRASTRUCTURE" } });
    const violations = await registry.evaluate("t1", edge);
    expect(violations).toHaveLength(0);
  });

  it("does not fire when module type attributes are absent", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const edge = makeEdgeRow({ type: "depends-on", attributes: {} });
    const violations = await registry.evaluate("t1", edge);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for node rows", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ attributes: { sourceModuleType: "DOMAIN", targetModuleType: "INFRASTRUCTURE" } }));
    expect(violations).toHaveLength(0);
  });

  it("violation message mentions DOMAIN and INFRASTRUCTURE", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L5-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const edge = makeEdgeRow({ type: "depends-on", attributes: { sourceModuleType: "DOMAIN", targetModuleType: "INFRASTRUCTURE" } });
    const violations = await registry.evaluate("t1", edge);
    expect(violations[0]?.message).toContain("DOMAIN");
    expect(violations[0]?.message).toContain("INFRASTRUCTURE");
  });
});

