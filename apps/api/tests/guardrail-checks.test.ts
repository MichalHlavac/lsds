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

// ── GR-L6-003: P1 Runbook last_tested > 90 days ──────────────────────────────

describe("built-in check: GR-L6-003 (P1 Runbook stale last_tested)", () => {
  it("fires for P1 Runbook with no last_tested date", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Runbook", layer: "L6", attributes: { severity: "P1" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L6-003");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.nodeId).toBe(node.id);
  });

  it("fires for P1 Runbook last_tested more than 90 days ago", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const staleDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const node = makeNodeRow({ type: "Runbook", layer: "L6", attributes: { severity: "P1", lastTested: staleDate } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L6-003");
    expect(violations[0]?.message).toContain("max: 90");
  });

  it("does not fire for P1 Runbook last_tested within 90 days", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const recentDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const node = makeNodeRow({ type: "Runbook", layer: "L6", attributes: { severity: "P1", lastTested: recentDate } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for P2 Runbook with no last_tested (only P1 is in scope)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Runbook", layer: "L6", attributes: { severity: "P2" } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("also accepts snake_case last_tested attribute", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const staleDate = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const node = makeNodeRow({ type: "Runbook", layer: "L6", attributes: { severity: "P1", last_tested: staleDate } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
  });

  it("does not fire for non-Runbook nodes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-003", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ type: "Alert", attributes: { severity: "P1" } }));
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L6-004: Production Service without SLO ────────────────────────────────

describe("built-in check: GR-L6-004 (Production Service without SLO)", () => {
  it("fires for a Service in production with sloCount=0", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Service", layer: "L4", attributes: { inProductionEnvironment: true, sloCount: 0 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L6-004");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.nodeId).toBe(node.id);
  });

  it("does not fire for a Service in production with sloCount > 0", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Service", layer: "L4", attributes: { inProductionEnvironment: true, sloCount: 2 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for a Service NOT in production (no inProductionEnvironment flag)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Service", layer: "L4", attributes: { sloCount: 0 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("also accepts snake_case slo_count and in_production_environment", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Service", layer: "L4", attributes: { in_production_environment: true, slo_count: 0 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
  });

  it("does not fire for non-Service nodes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-004", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ type: "InfrastructureComponent", attributes: { inProductionEnvironment: true, sloCount: 0 } }));
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L6-005: SLO without traces-to QualityAttribute ────────────────────────

describe("built-in check: GR-L6-005 (SLO without traces-to QualityAttribute)", () => {
  it("fires for SLO with no qualityAttributeCount", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-005", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "SLO", layer: "L6", attributes: {} });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L6-005");
    expect(violations[0]?.severity).toBe("WARN");
    expect(violations[0]?.nodeId).toBe(node.id);
  });

  it("fires for SLO with qualityAttributeCount=0", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-005", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "SLO", layer: "L6", attributes: { qualityAttributeCount: 0 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
  });

  it("does not fire for SLO with qualityAttributeCount >= 1", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-005", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "SLO", layer: "L6", attributes: { qualityAttributeCount: 1 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("also accepts snake_case quality_attribute_count", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-005", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "SLO", layer: "L6", attributes: { quality_attribute_count: 2 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for non-SLO nodes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-005", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ type: "Alert", attributes: {} }));
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L6-008: OnCallPolicy must cover ≥ 1 target and declare p1 SLA ─────────

describe("built-in check: GR-L6-008 (OnCallPolicy coverage and p1 SLA)", () => {
  it("fires for OnCallPolicy with coversCount=0 and no p1 SLA", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-008", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "OnCallPolicy", layer: "L6", attributes: { coversCount: 0 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L6-008");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.message).toContain("coversCount=0");
    expect(violations[0]?.message).toContain("responseTimeSla.p1 absent");
  });

  it("fires for OnCallPolicy with covers ≥ 1 but missing p1 SLA", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-008", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "OnCallPolicy", layer: "L6", attributes: { coversCount: 1, responseTimeSla: { p2: "PT30M" } } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("responseTimeSla.p1 absent");
  });

  it("fires for OnCallPolicy with p1 SLA but coversCount=0", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-008", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "OnCallPolicy", layer: "L6", attributes: { coversCount: 0, responseTimeSla: { p1: "PT15M" } } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("coversCount=0");
  });

  it("does not fire for OnCallPolicy with coversCount >= 1 and p1 SLA set", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-008", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "OnCallPolicy", layer: "L6", attributes: { coversCount: 2, responseTimeSla: { p1: "PT15M", p2: "PT30M" } } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("also accepts snake_case covers_count and response_time_sla", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-008", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "OnCallPolicy", layer: "L6", attributes: { covers_count: 1, response_time_sla: { p1: "PT15M" } } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for non-OnCallPolicy nodes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-008", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ type: "Service", attributes: { coversCount: 0 } }));
    expect(violations).toHaveLength(0);
  });
});

// ── GR-L6-009: Production Service without OnCallPolicy ───────────────────────

describe("built-in check: GR-L6-009 (Production Service without OnCallPolicy)", () => {
  it("fires for a Service in production with onCallPolicyCount=0", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-009", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Service", layer: "L4", attributes: { inProductionEnvironment: true, onCallPolicyCount: 0 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-L6-009");
    expect(violations[0]?.severity).toBe("WARN");
    expect(violations[0]?.nodeId).toBe(node.id);
  });

  it("does not fire for a Service in production with onCallPolicyCount >= 1", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-009", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Service", layer: "L4", attributes: { inProductionEnvironment: true, onCallPolicyCount: 1 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for a Service NOT in production", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-009", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Service", layer: "L4", attributes: { onCallPolicyCount: 0 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("also accepts snake_case on_call_policy_count", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-009", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Service", layer: "L4", attributes: { inProductionEnvironment: true, on_call_policy_count: 0 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
  });

  it("does not fire for non-Service nodes", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-L6-009", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeNodeRow({ type: "DeploymentUnit", attributes: { inProductionEnvironment: true, onCallPolicyCount: 0 } }));
    expect(violations).toHaveLength(0);
  });
});

// ── GR-XL-001: Object without owner ──────────────────────────────────────────

describe("built-in check: GR-XL-001 (Object without owner)", () => {
  it("fires for a node with no ownerId (empty string)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-001", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ ownerId: "" });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-XL-001");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.nodeId).toBe(node.id);
    expect(violations[0]?.message).toContain("no owner");
  });

  it("fires for a node with undefined ownerId", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-001", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const node = makeNodeRow({ ownerId: undefined as any });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
  });

  it("does not fire for a node with a valid ownerId", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-001", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ ownerId: "team-platform-uuid" });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire for edge subjects (edges are not ownership-checked)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-001", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeEdgeRow());
    expect(violations).toHaveLength(0);
  });

  it("violation message includes node type", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-001", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ type: "Runbook", ownerId: "" });
    const violations = await registry.evaluate("t1", node);
    expect(violations[0]?.message).toContain("Runbook");
  });
});

// ── GR-XL-005: Hard delete with incoming relationships ───────────────────────

describe("built-in check: GR-XL-005 (Hard delete with incoming relationships)", () => {
  it("fires when incomingRelCount > 0", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-005", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ attributes: { incomingRelCount: 3 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-XL-005");
    expect(violations[0]?.severity).toBe("ERROR");
    expect(violations[0]?.message).toContain("3");
  });

  it("does not fire when incomingRelCount=0", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-005", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ attributes: { incomingRelCount: 0 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire when incomingRelCount attribute is absent (defaults to 0)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-005", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ attributes: {} });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("also accepts snake_case incoming_rel_count", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-005", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ attributes: { incoming_rel_count: 5 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("5");
  });

  it("does not fire for edge subjects", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-005", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeEdgeRow());
    expect(violations).toHaveLength(0);
  });
});

// ── GR-XL-007: Object without revision for > threshold ───────────────────────

describe("built-in check: GR-XL-007 (Object without revision for > threshold)", () => {
  it("fires when last_review_date is absent (treat as never reviewed)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-007", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ attributes: {} });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-XL-007");
    expect(violations[0]?.severity).toBe("INFO");
  });

  it("fires when lastReviewDate is older than the threshold", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-007", config: { governance: { review_threshold_days: 90 } } })]);
    const registry = new GuardrailsRegistry(sql);
    const staleDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const node = makeNodeRow({ attributes: { lastReviewDate: staleDate } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-XL-007");
    expect(violations[0]?.message).toContain("90"); // threshold always appears in message
  });

  it("does not fire when lastReviewDate is within the threshold", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-007", config: { governance: { review_threshold_days: 180 } } })]);
    const registry = new GuardrailsRegistry(sql);
    const recentDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const node = makeNodeRow({ attributes: { lastReviewDate: recentDate } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("uses default threshold of 180 days when config is absent", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-007", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const recentDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const node = makeNodeRow({ attributes: { lastReviewDate: recentDate } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("also accepts snake_case last_review_date attribute", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-007", config: { governance: { review_threshold_days: 90 } } })]);
    const registry = new GuardrailsRegistry(sql);
    const staleDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const node = makeNodeRow({ attributes: { last_review_date: staleDate } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
  });

  it("does not fire for edge subjects", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-007", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeEdgeRow());
    expect(violations).toHaveLength(0);
  });
});

// ── GR-XL-008: God object with > 20 direct relationships ─────────────────────

describe("built-in check: GR-XL-008 (God object with > 20 direct relationships)", () => {
  it("fires when directRelationshipCount exceeds 20", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-008", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ attributes: { directRelationshipCount: 25 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.ruleKey).toBe("GR-XL-008");
    expect(violations[0]?.severity).toBe("INFO");
    expect(violations[0]?.message).toContain("25");
    expect(violations[0]?.nodeId).toBe(node.id);
  });

  it("does not fire when directRelationshipCount is exactly 20", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-008", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ attributes: { directRelationshipCount: 20 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("does not fire when directRelationshipCount is absent (defaults to 0)", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-008", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ attributes: {} });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(0);
  });

  it("also accepts snake_case direct_relationship_count", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-008", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const node = makeNodeRow({ attributes: { direct_relationship_count: 21 } });
    const violations = await registry.evaluate("t1", node);
    expect(violations).toHaveLength(1);
  });

  it("does not fire for edge subjects", async () => {
    const sql = makeSqlWith([makeGuardrailRow({ ruleKey: "GR-XL-008", config: {} })]);
    const registry = new GuardrailsRegistry(sql);
    const violations = await registry.evaluate("t1", makeEdgeRow());
    expect(violations).toHaveLength(0);
  });
});

