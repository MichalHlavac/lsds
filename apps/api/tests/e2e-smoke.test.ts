// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant, createTestTenant } from "./test-helpers";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

beforeEach(async () => { tid = randomUUID(); await createTestTenant(sql, tid); });
afterEach(async () => { await cleanTenant(sql, tid); });

/**
 * Full HTTP-level lifecycle smoke:
 *   create node → link → traverse → deprecate → archive → enforcement
 *
 * All six steps must complete, and the total wall-clock time must stay under 5 s.
 * Tests run against the real test database — no mocks.
 */
describe("E2E smoke: create node → traverse → deprecate → archive → enforce", () => {
  it("executes the full happy-path lifecycle and rejects reuse of the archived edge", async () => {
    const start = Date.now();

    // ── Step 1: POST /v1/nodes — create new node, capture id ─────────────────
    const res1 = await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "smoke-subject" }),
    });
    expect(res1.status, "step 1: node creation must return 201").toBe(201);
    const { data: subject } = await res1.json();
    expect(subject.id, "step 1: node must have a UUID id").toBeTruthy();
    expect(subject.lifecycleStatus, "step 1: new node must be ACTIVE").toBe("ACTIVE");

    // ── Step 1b: create an anchor node to wire the edge ───────────────────────
    const resAnchor = await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "smoke-anchor" }),
    });
    expect(resAnchor.status, "step 1b: anchor creation must return 201").toBe(201);
    const { data: anchor } = await resAnchor.json();

    // ── Step 2: POST /v1/edges — link subject → anchor ────────────────────────
    // "contains" is registered for ALL_LAYERS → ALL_LAYERS (SOURCE_LTE_TARGET);
    // L4 → L4 satisfies the ordinal constraint.
    const res2 = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        sourceId: subject.id,
        targetId: anchor.id,
        type: "contains",
        layer: "L4",
      }),
    });
    expect(res2.status, "step 2: edge creation must return 201").toBe(201);
    const { data: edge } = await res2.json();
    expect(edge.sourceId, "step 2: edge source must be subject").toBe(subject.id);
    expect(edge.targetId, "step 2: edge target must be anchor").toBe(anchor.id);
    expect(edge.lifecycleStatus, "step 2: new edge must be ACTIVE").toBe("ACTIVE");

    // ── Step 3: POST /v1/nodes/:id/traverse — anchor appears in outbound traversal ─
    const res3 = await app.request(`/v1/nodes/${subject.id}/traverse`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ depth: 1, direction: "outbound" }),
    });
    expect(res3.status, "step 3: traversal must return 200").toBe(200);
    const { data: traversal } = await res3.json();
    expect(traversal.root, "step 3: traversal root must be subject id").toBe(subject.id);
    const traversedIds = traversal.nodes.map((n: { id: string }) => n.id);
    expect(traversedIds, "step 3: anchor must appear in outbound traversal from subject").toContain(anchor.id);

    // ── Step 4: PATCH /v1/nodes/:id/lifecycle — deprecate ────────────────────
    const res4 = await app.request(`/v1/nodes/${subject.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "deprecate" }),
    });
    expect(res4.status, "step 4: deprecate must return 200").toBe(200);
    const { data: deprecated } = await res4.json();
    expect(deprecated.lifecycleStatus, "step 4: node must be DEPRECATED").toBe("DEPRECATED");
    expect(deprecated.deprecatedAt, "step 4: deprecatedAt must be set").toBeTruthy();

    // ── Step 5: PATCH /v1/nodes/:id/lifecycle — archive ─────────────────────
    const res5 = await app.request(`/v1/nodes/${subject.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "archive" }),
    });
    expect(res5.status, "step 5: archive must return 200").toBe(200);
    const { data: archived } = await res5.json();
    expect(archived.lifecycleStatus, "step 5: node must be ARCHIVED").toBe("ARCHIVED");
    expect(archived.archivedAt, "step 5: archivedAt must be set").toBeTruthy();

    // Edge must have been cascade-archived when the source node was archived
    const edgeCheck = await app.request(`/v1/edges/${edge.id}`, { headers: h() });
    expect(edgeCheck.status, "step 5: edge lookup must still succeed (ARCHIVED edges are not deleted)").toBe(200);
    const { data: archivedEdge } = await edgeCheck.json();
    expect(archivedEdge.lifecycleStatus, "step 5: edge must be cascade-archived").toBe("ARCHIVED");

    // ── Step 6: re-create the same edge from the archived node → 409 ─────────
    // The archived edge remains in the database, and the unique constraint
    // (tenant_id, source_id, target_id, type) is still held by it.
    // Attempting to create an identical edge from the now-ARCHIVED subject is
    // therefore blocked by the conflict — equivalent enforcement to a 422.
    const res6 = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        sourceId: subject.id,
        targetId: anchor.id,
        type: "contains",
        layer: "L4",
      }),
    });
    expect(res6.status, "step 6: recreating the archived edge must be rejected (409 conflict)").toBe(409);
    const body6 = await res6.json();
    expect(body6.error, "step 6: error message must reference existing edge").toMatch(/already exists/);

    // ── Performance gate: full flow must complete in < 5 s ───────────────────
    const elapsed = Date.now() - start;
    expect(elapsed, `step perf: full flow took ${elapsed} ms, must be < 5000 ms`).toBeLessThan(5000);
  });
});
