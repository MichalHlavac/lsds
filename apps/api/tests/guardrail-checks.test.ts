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

