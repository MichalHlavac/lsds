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

async function createNode(layer: string, name: string) {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ type: "Service", layer, name }),
  });
  return (await res.json()).data;
}

async function createEdge(sourceId: string, targetId: string, type: string, layer: string) {
  return app.request("/v1/edges", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ sourceId, targetId, type, layer }),
  });
}

/**
 * Cardinality enforcement tests for POST /v1/edges.
 *
 * `validateGraphCardinality` exists in the framework but is NOT yet wired into
 * the API edge-creation path. The two negative tests below are acceptance targets
 * for the companion enforcement issue: they are skipped until enforcement lands.
 *
 * To activate: remove `.skip` from the two negative-path tests once the
 * enforcement feature is merged into the API edge-creation path.
 */
describe("cardinality enforcement — POST /v1/edges", () => {
  // ── Positive path ─────────────────────────────────────────────────────────
  // Validates that the first edge of a cardinality-constrained type is accepted.

  it("accepts the first supersedes edge from a source (1:1 — no prior edge)", async () => {
    // supersedes: cardinality=1:1, EQUAL layer constraint.
    // The first outgoing edge is always within cardinality — must return 201.
    const src = await createNode("L3", "new-adr");
    const tgt = await createNode("L3", "old-adr");

    const res = await createEdge(src.id, tgt.id, "supersedes", "L3");
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.type).toBe("supersedes");
    expect(data.sourceId).toBe(src.id);
    expect(data.targetId).toBe(tgt.id);
  });

  // ── Negative paths (skipped until cardinality enforcement is wired in) ────
  // Remove `.skip` once the enforcement feature lands in the API edge-creation path.

  it.skip("1:1 violation — supersedes: second outgoing edge from the same source → 422", async () => {
    // supersedes is 1:1: a source node may supersede at most one target.
    // The first edge succeeds; the second must be rejected with 422.
    // Currently returns 201 because cardinality is not enforced at the API layer.
    const src = await createNode("L3", "new-adr");
    const tgt1 = await createNode("L3", "old-adr-v1");
    const tgt2 = await createNode("L3", "old-adr-v2");

    const first = await createEdge(src.id, tgt1.id, "supersedes", "L3");
    expect(first.status).toBe(201);

    const second = await createEdge(src.id, tgt2.id, "supersedes", "L3");
    expect(second.status).toBe(422);
    const body = await second.json();
    expect(body.error).toMatch(/cardinality/i);
  });

  it.skip("N:1 violation — part-of: second outgoing edge from the same source → 422", async () => {
    // part-of is N:1: a source node may belong to at most one parent.
    // The first edge succeeds; the second (different target) must be rejected with 422.
    // Currently returns 201 because cardinality is not enforced at the API layer.
    const src = await createNode("L4", "child-service");
    const parent1 = await createNode("L4", "parent-a");
    const parent2 = await createNode("L4", "parent-b");

    const first = await createEdge(src.id, parent1.id, "part-of", "L4");
    expect(first.status).toBe(201);

    const second = await createEdge(src.id, parent2.id, "part-of", "L4");
    expect(second.status).toBe(422);
    const body = await second.json();
    expect(body.error).toMatch(/cardinality/i);
  });
});
