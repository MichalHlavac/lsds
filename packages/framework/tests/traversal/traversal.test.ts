// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { beforeEach, describe, expect, it } from "vitest";

import {
  DefaultTraversalEngine,
  TraversalError,
  estimateTokens,
  truncateToBudget,
  type ContextPackage,
} from "../../src/traversal.js";
import { InMemoryGraphRepository } from "../../src/persistence/in-memory-graph.js";
import type { TknBase } from "../../src/shared/base.js";
import type { Lifecycle } from "../../src/lifecycle.js";

import { makeEdge, makeNode, resetCounter } from "./fixtures.js";

// Builds a BoundedContext TknBase (with ubiquitousLanguage embedded).
function makeBoundedContext(
  id: string,
  name: string,
  terms: Array<{ term: string; definition: string }>,
  lifecycle: Lifecycle = "ACTIVE",
): TknBase & { ubiquitousLanguage: Array<{ term: string; definition: string }> } {
  return {
    id,
    type: "BoundedContext",
    layer: "L2",
    name,
    version: "1.0.0",
    lifecycle,
    owner: { kind: "team", id: "team-test", name: "Test Team" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ubiquitousLanguage: terms,
  } as TknBase & { ubiquitousLanguage: Array<{ term: string; definition: string }> };
}

// Builds a standalone LanguageTerm node for addLanguageTerm.
function makeLanguageTerm(
  id: string,
  term: string,
  bcId: string,
  lifecycle: Lifecycle = "ACTIVE",
): TknBase & { context: { id: string }; term: string } {
  return {
    id,
    type: "LanguageTerm",
    layer: "L2",
    name: term,
    version: "1.0.0",
    lifecycle,
    owner: { kind: "team", id: "team-test", name: "Test Team" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    term,
    definition: `Standalone definition for ${term} with enough text to meet the schema minimum.`,
    examples: [],
    antiPatterns: [],
    context: { kind: "bounded-context", id: bcId },
  } as TknBase & { context: { id: string }; term: string };
}

beforeEach(() => resetCounter());

// Build a small graph that mirrors the kap. 6.1 example:
//
//   BusinessCapability (L1)
//     └─ realizes ──> BoundedContext (L2)
//           └─ realizes ──> ArchitectureComponent (L3)
//                 └─ contains ──> Service (L4)
//                       └─ contains ──> APIEndpoint (L4)  <-- ROOT
//                             └─ depends-on ──> ExternalService (L3, lateral)
//                             └─ traces-to ──> Service  (already in chain, dedup)
//                             └─ decided-by ──> ADR (L3 cross-layer)
//                             └─ motivated-by ──> Requirement (L1, LAZY)
//
function buildExampleGraph(): {
  graph: InMemoryGraphRepository;
  endpoint: ReturnType<typeof makeNode>;
  service: ReturnType<typeof makeNode>;
  component: ReturnType<typeof makeNode>;
  context: ReturnType<typeof makeNode>;
  capability: ReturnType<typeof makeNode>;
  external: ReturnType<typeof makeNode>;
  adr: ReturnType<typeof makeNode>;
  requirement: ReturnType<typeof makeNode>;
} {
  const capability = makeNode({ id: "cap-1", type: "BusinessCapability", layer: "L1", name: "Order Processing" });
  const context = makeNode({ id: "ctx-1", type: "BoundedContext", layer: "L2", name: "Order Context" });
  const component = makeNode({ id: "cmp-1", type: "ArchitectureComponent", layer: "L3", name: "Order Management System" });
  const service = makeNode({ id: "svc-1", type: "Service", layer: "L4", name: "OrderService" });
  const endpoint = makeNode({ id: "ep-1", type: "APIEndpoint", layer: "L4", name: "POST /orders" });
  const external = makeNode({ id: "ext-1", type: "ExternalSystem", layer: "L3", name: "Stripe" });
  const adr = makeNode({ id: "adr-1", type: "ADR", layer: "L3", name: "ADR-042 REST over GraphQL" });
  const requirement = makeNode({ id: "req-1", type: "Requirement", layer: "L1", name: "Customers can place orders" });

  const graph = new InMemoryGraphRepository();
  for (const n of [capability, context, component, service, endpoint, external, adr, requirement]) {
    graph.addNode(n);
  }

  graph.addEdge(makeEdge(capability, context, "realizes"));
  graph.addEdge(makeEdge(context, component, "realizes"));
  graph.addEdge(makeEdge(component, service, "contains"));
  graph.addEdge(makeEdge(service, endpoint, "contains"));
  graph.addEdge(makeEdge(endpoint, external, "depends-on"));
  graph.addEdge(makeEdge(endpoint, adr, "decided-by"));
  graph.addEdge(makeEdge(endpoint, requirement, "motivated-by"));

  return { graph, endpoint, service, component, context, capability, external, adr, requirement };
}

describe("DefaultTraversalEngine", () => {
  it("OPERATIONAL profile keeps EAGER edges, drops LAZY ones", async () => {
    const { graph, endpoint } = buildExampleGraph();
    const engine = new DefaultTraversalEngine(graph);

    const pkg = await engine.traverse(endpoint.id, { profile: "OPERATIONAL" });

    expect(pkg.profile).toBe("OPERATIONAL");
    expect(pkg.root.id).toBe(endpoint.id);
    // The LAZY motivated-by edge is dropped at the framework level...
    expect(pkg.requirements).toBeUndefined(); // analytical bucket gated by profile
    expect(pkg.decisions).toBeUndefined();
    // ...but EAGER neighbors are present:
    const upwardNames = pkg.upward.map((c) => c.name);
    expect(upwardNames).toContain("OrderService");
    expect(upwardNames).toContain("Order Management System");
    expect(pkg.lateral.map((c) => c.name)).toContain("Stripe");
  });

  it("ANALYTICAL profile adds LAZY edges + decisions + requirements", async () => {
    const { graph, endpoint } = buildExampleGraph();
    const engine = new DefaultTraversalEngine(graph);

    const pkg = await engine.traverse(endpoint.id, { profile: "ANALYTICAL" });

    expect(pkg.decisions?.map((c) => c.name)).toContain("ADR-042 REST over GraphQL");
    expect(pkg.requirements?.map((c) => c.name)).toContain("Customers can place orders");
    expect(pkg.lateral.map((c) => c.name)).toContain("Stripe");
  });

  it("OPERATIONAL hides ARCHIVED nodes; ANALYTICAL surfaces them", async () => {
    const { graph, endpoint, component } = buildExampleGraph();
    // ArchitectureComponent sits at depth 2 from the endpoint (within the
    // default upward limit of 3), so this exercises the lifecycle filter,
    // not the depth limit.
    component.lifecycle = "ARCHIVED";

    const engine = new DefaultTraversalEngine(graph);
    const op = await engine.traverse(endpoint.id, { profile: "OPERATIONAL" });
    const an = await engine.traverse(endpoint.id, { profile: "ANALYTICAL" });

    expect(op.upward.map((c) => c.name)).not.toContain("Order Management System");
    expect(an.upward.map((c) => c.name)).toContain("Order Management System");
  });

  it("respects upward depth limit (default 3)", async () => {
    const { graph, endpoint } = buildExampleGraph();
    const engine = new DefaultTraversalEngine(graph);

    const pkg = await engine.traverse(endpoint.id, { profile: "OPERATIONAL" });

    // Upward chain from APIEndpoint:
    //   service (1) → component (2) → context (3) → capability (4)
    // Default upward depth = 3, so capability MUST be omitted.
    const upwardNames = pkg.upward.map((c) => c.name);
    expect(upwardNames).toContain("OrderService");
    expect(upwardNames).toContain("Order Management System");
    expect(upwardNames).toContain("Order Context");
    expect(upwardNames).not.toContain("Order Processing");
  });

  it("rejects traversal of a root that is invisible under the profile", async () => {
    const { graph, endpoint } = buildExampleGraph();
    endpoint.lifecycle = "ARCHIVED";
    const engine = new DefaultTraversalEngine(graph);

    await expect(engine.traverse(endpoint.id, { profile: "OPERATIONAL" })).rejects.toBeInstanceOf(
      TraversalError,
    );
  });

  it("FULL profile surfaces inherited violations", async () => {
    const { graph, endpoint, service } = buildExampleGraph();
    const detectedAt = "2026-04-29T00:00:00Z";
    graph.addViolation({
      id: "v1",
      rule_id: "GR-L4-006",
      object_id: endpoint.id,
      object_type: "APIEndpoint",
      severity: "WARNING",
      status: "OPEN",
      detectedAt,
      message: "Endpoint is DEPRECATED without sunset_date",
    });
    graph.addViolation({
      id: "v2",
      rule_id: "GR-L4-001",
      object_id: service.id,
      object_type: "Service",
      severity: "INFO",
      status: "OPEN",
      detectedAt,
      message: "inherited",
      inherited: true,
    });

    const engine = new DefaultTraversalEngine(graph);

    const op = await engine.traverse(endpoint.id, { profile: "OPERATIONAL" });
    const full = await engine.traverse(endpoint.id, { profile: "FULL" });

    expect(op.health.violations.map((v) => v.id)).toEqual(["v1"]);
    expect(full.health.violations.map((v) => v.id).sort()).toEqual(["v1", "v2"]);
  });

  it("expired SUPPRESSED violations project as OPEN (kap. 2.5)", async () => {
    // SUPPRESSED waivers are bounded to 90 days. Once `expiresAt` is in the
    // past, the read-side projection used to assemble the LLM context must
    // surface the violation as OPEN, otherwise stale rationales ride into
    // the agent's prompt as live consent.
    const { graph, endpoint } = buildExampleGraph();
    const detectedAt = "2025-12-01T00:00:00Z";
    graph.addViolation({
      id: "v-stale",
      rule_id: "GR-L4-006",
      object_id: endpoint.id,
      object_type: "APIEndpoint",
      severity: "WARNING",
      status: "SUPPRESSED",
      detectedAt,
      message: "Endpoint is DEPRECATED without sunset_date",
      suppression: {
        rationale: "tracked separately in SUNSET-42 — temporary",
        suppressedAt: "2025-12-01T00:00:00Z",
        expiresAt: "2026-02-15T00:00:00Z", // 76 days — valid window, but well in the past
        suppressedBy: "user:michal",
      },
    });
    graph.addViolation({
      id: "v-fresh",
      rule_id: "GR-L4-001",
      object_id: endpoint.id,
      object_type: "APIEndpoint",
      severity: "ERROR",
      status: "SUPPRESSED",
      detectedAt: "2026-05-01T00:00:00Z",
      message: "missing error_response — accepted risk for now",
      suppression: {
        rationale: "scheduled in next sprint via SVC-911 — confirmed",
        suppressedAt: "2026-05-01T00:00:00Z",
        expiresAt: "2030-01-01T00:00:00Z", // far future — still valid
        suppressedBy: "user:michal",
      },
    });

    const engine = new DefaultTraversalEngine(graph);
    const pkg = await engine.traverse(endpoint.id, { profile: "OPERATIONAL" });

    const stale = pkg.health.violations.find((v) => v.id === "v-stale");
    const fresh = pkg.health.violations.find((v) => v.id === "v-fresh");
    expect(stale).toBeDefined();
    expect(fresh).toBeDefined();
    // Drift guard: an expired SUPPRESSED must NOT appear as SUPPRESSED in
    // the projected ViolationSummary; it is canonically OPEN until
    // re-suppressed (canTransitionViolation already permits SUPPRESSED→OPEN).
    expect(stale!.status).toBe("OPEN");
    // Severity, ruleId, and inherited flag must be preserved verbatim.
    expect(stale!.severity).toBe("WARNING");
    expect(stale!.ruleId).toBe("GR-L4-006");
    // A still-valid SUPPRESSED waiver continues to project as SUPPRESSED.
    expect(fresh!.status).toBe("SUPPRESSED");
  });
});

describe("token-aware truncation", () => {
  // Build a wide graph so we can prove truncation drops downward first and
  // preserves upward context (kap. 6.1).
  function buildWideGraph(downwardCount: number, upwardCount: number) {
    const graph = new InMemoryGraphRepository();
    const root = makeNode({ id: "root", type: "Service", layer: "L4", name: "RootService" });
    graph.addNode(root);

    // Upward chain: root → parentN → ... → parent1
    let upward = root;
    for (let i = 1; i <= upwardCount; i++) {
      const parent = makeNode({
        id: `up-${i}`,
        type: "ArchitectureComponent",
        layer: "L3",
        name: `Parent${i}`,
      });
      graph.addNode(parent);
      // root part-of parent → semantic upward, EAGER
      graph.addEdge(makeEdge(upward, parent, "part-of"));
      upward = parent;
    }

    // Downward fan-out: root contains child_i (all siblings, depth 1)
    for (let i = 1; i <= downwardCount; i++) {
      const child = makeNode({
        id: `dn-${i}`,
        type: "APIEndpoint",
        layer: "L4",
        name: `Endpoint${i}WithEnoughTextToCostSomeTokens`,
      });
      graph.addNode(child);
      graph.addEdge(makeEdge(root, child, "contains"));
    }

    return { graph, root };
  }

  it("drops downward nodes before upward when over budget", async () => {
    const { graph, root } = buildWideGraph(50, 3);
    const engine = new DefaultTraversalEngine(graph);

    const fullPkg = await engine.traverse(root.id, {
      profile: "OPERATIONAL",
      tokenBudget: 1_000_000, // huge
    });
    const upwardBefore = fullPkg.upward.length;
    const downwardBefore = fullPkg.downward.length;
    expect(upwardBefore).toBe(3);
    expect(downwardBefore).toBe(50);

    const tightPkg = await engine.traverse(root.id, {
      profile: "OPERATIONAL",
      tokenBudget: 200,
    });

    expect(tightPkg.truncation.truncated).toBe(true);
    expect(tightPkg.truncation.notes[0]).toMatch(/Context truncated/);
    expect(tightPkg.truncation.omitted.downward).toBeGreaterThan(0);
    // Upward context is the priority — should survive untouched if possible.
    expect(tightPkg.upward.length).toBe(upwardBefore);
    expect(tightPkg.downward.length).toBeLessThan(downwardBefore);
  });

  it("falls back to dropping upward only when downward+lateral exhausted", async () => {
    const { graph, root } = buildWideGraph(0, 5);
    const engine = new DefaultTraversalEngine(graph);

    const tight = await engine.traverse(root.id, {
      profile: "OPERATIONAL",
      tokenBudget: 50,
      maxDepth: { upward: 5 },
    });

    expect(tight.truncation.truncated).toBe(true);
    expect(tight.truncation.omitted.upward).toBeGreaterThan(0);
    // Farthest parents (Parent5, Parent4, ...) are dropped first; nearest
    // (Parent1) survives the longest.
    if (tight.upward.length > 0) {
      const remainingNames = tight.upward.map((c) => c.name);
      expect(remainingNames).toContain("Parent1");
    }
  });

  it("estimateTokens is monotonic in payload size", () => {
    const small: ContextPackage = {
      profile: "OPERATIONAL",
      root: { id: "r", type: "X", layer: "L4", name: "r", lifecycle: "ACTIVE", distance: 0 },
      upward: [],
      downward: [],
      lateral: [],
      health: { violations: [] },
      truncation: {
        truncated: false,
        omitted: { upward: 0, downward: 0, lateral: 0, decisions: 0, requirements: 0, debt: 0, glossary: 0 },
        notes: [],
      },
      estimatedTokens: 0,
    };
    const large: ContextPackage = JSON.parse(JSON.stringify(small));
    for (let i = 0; i < 100; i++) {
      large.upward.push({
        id: `u${i}`,
        type: "Component",
        layer: "L3",
        name: `Parent${i}`,
        lifecycle: "ACTIVE",
        distance: 1,
      });
    }
    expect(estimateTokens(small)).toBeLessThan(estimateTokens(large));
  });

  it("truncateToBudget is a no-op when already under budget", () => {
    const pkg: ContextPackage = {
      profile: "OPERATIONAL",
      root: { id: "r", type: "X", layer: "L4", name: "r", lifecycle: "ACTIVE", distance: 0 },
      upward: [{ id: "u1", type: "C", layer: "L3", name: "P1", lifecycle: "ACTIVE", distance: 1 }],
      downward: [],
      lateral: [],
      health: { violations: [] },
      truncation: {
        truncated: false,
        omitted: { upward: 0, downward: 0, lateral: 0, decisions: 0, requirements: 0, debt: 0, glossary: 0 },
        notes: [],
      },
      estimatedTokens: 50,
    };
    truncateToBudget(pkg, 1_000_000);
    expect(pkg.truncation.truncated).toBe(false);
    expect(pkg.upward.length).toBe(1);
  });
});

describe("glossary collection (kap. 6.1)", () => {
  // Common graph: Service contained by a BoundedContext.
  // bc → contains → service (service sees incoming `contains` → follows upward to bc).
  function buildGlossaryGraph(
    terms: Array<{ term: string; definition: string }>,
    bcLifecycle: Lifecycle = "ACTIVE",
  ) {
    const bc = makeBoundedContext("bc-1", "Order Context", terms, bcLifecycle);
    const service = makeNode({ id: "svc-1", type: "Service", layer: "L4", name: "OrderService" });
    const graph = new InMemoryGraphRepository();
    graph.addNode(bc as unknown as TknBase);
    graph.addNode(service);
    graph.addEdge(makeEdge(bc as unknown as TknBase, service, "contains"));
    return { graph, service, bc };
  }

  const MIN_TERMS = [
    { term: "Order", definition: "A customer's intent to purchase one or more products from the catalogue." },
    { term: "Customer", definition: "An entity registered in the system that is allowed to place orders." },
    { term: "Fulfillment", definition: "The end-to-end process of picking, packing, and shipping an order." },
  ];

  // (a) Embedded-only path
  it("(a) populates glossary from BoundedContext.ubiquitousLanguage in ANALYTICAL profile", async () => {
    const { graph, service } = buildGlossaryGraph(MIN_TERMS);
    const engine = new DefaultTraversalEngine(graph);

    const pkg = await engine.traverse(service.id, { profile: "ANALYTICAL" });

    expect(pkg.glossary).toBeDefined();
    const names = pkg.glossary!.map((g) => g.name);
    expect(names).toContain("Order");
    expect(names).toContain("Customer");
    expect(names).toContain("Fulfillment");
    expect(pkg.glossary!.every((g) => g.type === "LanguageTerm" && g.layer === "L2")).toBe(true);
  });

  // (b) Standalone LanguageTerm path via addLanguageTerm
  it("(b) includes standalone LanguageTerm nodes and replaces synthetic entry for same term", async () => {
    const { graph, service } = buildGlossaryGraph(MIN_TERMS);
    // Standalone term that shares a name with an embedded one ("Order") → replaces synthetic.
    const standaloneOrder = makeLanguageTerm("lt-order-real", "Order", "bc-1");
    // Standalone term with a new name not in embedded list.
    const standaloneShipment = makeLanguageTerm("lt-shipment", "Shipment", "bc-1");
    graph.addLanguageTerm(standaloneOrder);
    graph.addLanguageTerm(standaloneShipment);

    const engine = new DefaultTraversalEngine(graph);
    const pkg = await engine.traverse(service.id, { profile: "ANALYTICAL" });

    expect(pkg.glossary).toBeDefined();
    const names = pkg.glossary!.map((g) => g.name);
    // "Shipment" comes from standalone only.
    expect(names).toContain("Shipment");
    // "Order" replaced by real node — id must be the real one, not synthetic.
    const orderCard = pkg.glossary!.find((g) => g.name === "Order");
    expect(orderCard).toBeDefined();
    expect(orderCard!.id).toBe("lt-order-real");
    // Embedded-only "Customer" and "Fulfillment" are still present.
    expect(names).toContain("Customer");
    expect(names).toContain("Fulfillment");
    // No duplicate for "Order".
    expect(names.filter((n) => n === "Order").length).toBe(1);
  });

  // (c) Lifecycle filtering — standalone LT with PURGE lifecycle is excluded
  it("(c) excludes standalone LanguageTerm nodes with non-visible lifecycle", async () => {
    const { graph, service } = buildGlossaryGraph(MIN_TERMS);
    const purgeLt = makeLanguageTerm("lt-purged", "ObsoleteTerm", "bc-1", "PURGE");
    graph.addLanguageTerm(purgeLt);

    const engine = new DefaultTraversalEngine(graph);
    const pkg = await engine.traverse(service.id, { profile: "ANALYTICAL" });

    const names = pkg.glossary!.map((g) => g.name);
    expect(names).not.toContain("ObsoleteTerm");
    // Embedded terms from the ACTIVE BC are still present.
    expect(names).toContain("Order");
  });

  // (d) Truncation under budget — glossary entries are dropped before decisions
  it("(d) drops glossary entries under tight token budget and records omission count", async () => {
    // Build 40 UL terms so the glossary dominates the payload.
    const manyTerms: Array<{ term: string; definition: string }> = [];
    for (let i = 0; i < 40; i++) {
      manyTerms.push({
        term: `GlossaryTerm${i}`,
        definition: `Detailed definition number ${i} with enough text to consume meaningful tokens in the context package.`,
      });
    }
    const { graph, service } = buildGlossaryGraph(manyTerms);

    const engine = new DefaultTraversalEngine(graph);
    const pkg = await engine.traverse(service.id, {
      profile: "ANALYTICAL",
      tokenBudget: 400,
    });

    expect(pkg.truncation.truncated).toBe(true);
    expect(pkg.truncation.omitted.glossary).toBeGreaterThan(0);
    expect(pkg.truncation.notes[0]).toMatch(/glossary/);
  });

  // (e) OPERATIONAL profile — glossary is undefined
  it("(e) OPERATIONAL profile returns glossary as undefined (no behavioral regression)", async () => {
    const { graph, service } = buildGlossaryGraph(MIN_TERMS);
    const engine = new DefaultTraversalEngine(graph);

    const pkg = await engine.traverse(service.id, { profile: "OPERATIONAL" });

    expect(pkg.glossary).toBeUndefined();
  });
});
