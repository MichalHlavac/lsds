import { describe, expect, it, vi } from "vitest";
import type { Sql } from "../src/db/client.js";
import {
  GuardrailsRegistry,
  type ViolationCandidate,
} from "../src/guardrails/index.js";

function makeMockSql() {
  let dbRoundTrips = 0;
  const fn = (first: unknown, ...rest: unknown[]) => {
    void rest;
    // TemplateStringsArray has a 'raw' property; plain object arrays do not
    if (Array.isArray(first) && Object.hasOwn(first, "raw")) {
      dbRoundTrips++;
      return Promise.resolve([]);
    }
    // Fragment builder call (sql(rows, ...columns)) — return empty sentinel
    return [];
  };
  return { sql: fn as unknown as Sql, getDbRoundTrips: () => dbRoundTrips };
}

describe("GuardrailsRegistry.persistViolations", () => {
  it("makes zero DB round-trips when given no violations", async () => {
    const { sql, getDbRoundTrips } = makeMockSql();
    const registry = new GuardrailsRegistry(sql);
    await registry.persistViolations("tenant-1", []);
    expect(getDbRoundTrips()).toBe(0);
  });

  it("makes exactly one DB round-trip for multiple violations", async () => {
    const { sql, getDbRoundTrips } = makeMockSql();
    const registry = new GuardrailsRegistry(sql);

    const violations: ViolationCandidate[] = [
      { ruleKey: "naming.node.min_length", severity: "WARN", message: "too short", nodeId: "node-1" },
      { ruleKey: "naming.node.min_length", severity: "WARN", message: "too short", nodeId: "node-2" },
      { ruleKey: "lifecycle.review_cycle", severity: "WARN", message: "stale", nodeId: "node-3" },
    ];
    await registry.persistViolations("tenant-1", violations);
    expect(getDbRoundTrips()).toBe(1);
  });

  it("makes exactly one DB round-trip for a single violation", async () => {
    const { sql, getDbRoundTrips } = makeMockSql();
    const registry = new GuardrailsRegistry(sql);

    const violations: ViolationCandidate[] = [
      { ruleKey: "naming.node.min_length", severity: "WARN", message: "too short", nodeId: "node-1" },
    ];
    await registry.persistViolations("tenant-1", violations);
    expect(getDbRoundTrips()).toBe(1);
  });

  it("passes the correct row shape to the batch fragment builder", async () => {
    const fragmentArgs: unknown[][] = [];
    const fn = (first: unknown, ...rest: unknown[]) => {
      if (Array.isArray(first) && !Object.hasOwn(first, "raw")) {
        fragmentArgs.push([first, ...rest]);
      }
      return Array.isArray(first) && Object.hasOwn(first, "raw")
        ? Promise.resolve([])
        : [];
    };
    const registry = new GuardrailsRegistry(fn as unknown as Sql);

    const violations: ViolationCandidate[] = [
      { ruleKey: "naming.node.min_length", severity: "WARN", message: "short", nodeId: "node-a" },
      { ruleKey: "lifecycle.review_cycle", severity: "INFO", message: "stale", edgeId: "edge-b" },
    ];
    await registry.persistViolations("t-1", violations);

    expect(fragmentArgs).toHaveLength(1);
    const [rows, ...cols] = fragmentArgs[0] as [unknown[], ...string[]];
    expect(cols).toEqual(["tenantId", "nodeId", "edgeId", "ruleKey", "severity", "message"]);
    expect(rows).toEqual([
      { tenantId: "t-1", nodeId: "node-a", edgeId: null, ruleKey: "naming.node.min_length", severity: "WARN", message: "short" },
      { tenantId: "t-1", nodeId: null, edgeId: "edge-b", ruleKey: "lifecycle.review_cycle", severity: "INFO", message: "stale" },
    ]);
  });
});
