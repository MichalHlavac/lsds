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

async function createNode(name = "test-node") {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ type: "Service", layer: "L4", name }),
  });
  return (await res.json()).data;
}

async function createEdge(sourceId: string, targetId: string) {
  // "contains" is registered for ALL_LAYERS → ALL_LAYERS with SOURCE_LTE_TARGET; L4→L4 satisfies 4≤4
  const res = await app.request("/v1/edges", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ sourceId, targetId, type: "contains", layer: "L4" }),
  });
  const body = await res.json();
  if (!body.data) throw new Error(`createEdge failed: ${JSON.stringify(body)}`);
  return body.data;
}

// ── full lifecycle flow ───────────────────────────────────────────────────────

describe("full ACTIVE → DEPRECATED → ARCHIVED → PURGE → deleted flow", () => {
  it("transitions a node through all lifecycle stages", async () => {
    const node = await createNode("lifecycle-node");

    // 1. Deprecate (ACTIVE → DEPRECATED)
    let res = await app.request(`/v1/lifecycle/nodes/${node.id}/deprecate`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.lifecycleStatus).toBe("DEPRECATED");

    // 2. Archive (DEPRECATED → ARCHIVED)
    res = await app.request(`/v1/lifecycle/nodes/${node.id}/archive`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.lifecycleStatus).toBe("ARCHIVED");

    // 3. Mark for purge with -1 days → purge_after is in the past
    res = await app.request(`/v1/lifecycle/nodes/${node.id}/mark-purge`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ purgeAfterDays: -1 }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.lifecycleStatus).toBe("PURGE");

    // 4. Purge (DELETE from DB)
    res = await app.request(`/v1/lifecycle/nodes/${node.id}/purge`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.purged).toBe(true);

    // 5. Verify the node is gone
    res = await app.request(`/v1/nodes/${node.id}`, { headers: h() });
    expect(res.status).toBe(404);
  });
});

// ── POST .../deprecate ────────────────────────────────────────────────────────

describe("POST /v1/lifecycle/nodes/:id/deprecate", () => {
  it("transitions ACTIVE → DEPRECATED and returns the node", async () => {
    const node = await createNode();
    const res = await app.request(`/v1/lifecycle/nodes/${node.id}/deprecate`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.lifecycleStatus).toBe("DEPRECATED");
    expect(data.deprecatedAt).toBeTruthy();
  });

  it("returns 400 when the node is already DEPRECATED (not ACTIVE)", async () => {
    const node = await createNode();
    // First deprecate: OK
    await app.request(`/v1/lifecycle/nodes/${node.id}/deprecate`, { method: "POST", headers: h() });
    // Second deprecate: error — no longer ACTIVE
    const res = await app.request(`/v1/lifecycle/nodes/${node.id}/deprecate`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(400);
  });
});

// ── POST .../archive ──────────────────────────────────────────────────────────

describe("POST /v1/lifecycle/nodes/:id/archive", () => {
  it("transitions DEPRECATED → ARCHIVED", async () => {
    const node = await createNode();
    await app.request(`/v1/lifecycle/nodes/${node.id}/deprecate`, { method: "POST", headers: h() });
    const res = await app.request(`/v1/lifecycle/nodes/${node.id}/archive`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.lifecycleStatus).toBe("ARCHIVED");
  });

  it("returns 400 when trying to skip from ACTIVE directly to ARCHIVED", async () => {
    const node = await createNode();
    const res = await app.request(`/v1/lifecycle/nodes/${node.id}/archive`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for an already ARCHIVED node", async () => {
    const node = await createNode();
    await app.request(`/v1/lifecycle/nodes/${node.id}/deprecate`, { method: "POST", headers: h() });
    await app.request(`/v1/lifecycle/nodes/${node.id}/archive`, { method: "POST", headers: h() });
    const res = await app.request(`/v1/lifecycle/nodes/${node.id}/archive`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(400);
  });
});

// ── POST .../mark-purge ───────────────────────────────────────────────────────

describe("POST /v1/lifecycle/nodes/:id/mark-purge", () => {
  it("transitions ARCHIVED → PURGE and sets purge_after", async () => {
    const node = await createNode();
    await app.request(`/v1/lifecycle/nodes/${node.id}/deprecate`, { method: "POST", headers: h() });
    await app.request(`/v1/lifecycle/nodes/${node.id}/archive`, { method: "POST", headers: h() });

    const res = await app.request(`/v1/lifecycle/nodes/${node.id}/mark-purge`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ purgeAfterDays: 30 }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.lifecycleStatus).toBe("PURGE");
    expect(data.purgeAfter).toBeTruthy();
  });

  it("returns 400 when the node is not ARCHIVED", async () => {
    const node = await createNode();  // ACTIVE state
    const res = await app.request(`/v1/lifecycle/nodes/${node.id}/mark-purge`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(400);
  });
});

// ── DELETE .../purge ──────────────────────────────────────────────────────────

describe("DELETE /v1/lifecycle/nodes/:id/purge", () => {
  it("returns 400 when node is not in PURGE state", async () => {
    const node = await createNode();  // ACTIVE
    const res = await app.request(`/v1/lifecycle/nodes/${node.id}/purge`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not eligible/);
  });
});

// ── POST /v1/lifecycle/apply-retention ───────────────────────────────────────

describe("POST /v1/lifecycle/apply-retention", () => {
  it("returns 200 with deprecated and archived counts", async () => {
    const res = await app.request("/v1/lifecycle/apply-retention", {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(typeof data.deprecated).toBe("number");
    expect(typeof data.archived).toBe("number");
  });
});

// ── PATCH /v1/nodes/:id/lifecycle ────────────────────────────────────────────

describe("PATCH /v1/nodes/:id/lifecycle — positive paths", () => {
  it("deprecate: ACTIVE → DEPRECATED", async () => {
    const node = await createNode("lc-deprecate");
    const res = await app.request(`/v1/nodes/${node.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "deprecate" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.lifecycleStatus).toBe("DEPRECATED");
    expect(data.deprecatedAt).toBeTruthy();
  });

  it("archive: DEPRECATED → ARCHIVED (with edge cascade)", async () => {
    const source = await createNode("lc-source");
    const target = await createNode("lc-target");
    const edge = await createEdge(source.id, target.id);

    // Deprecate source first
    await app.request(`/v1/nodes/${source.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "deprecate" }),
    });

    // Archive source → should cascade to edge
    const res = await app.request(`/v1/nodes/${source.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "archive" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.lifecycleStatus).toBe("ARCHIVED");
    expect(data.archivedAt).toBeTruthy();

    // Verify edge was cascaded
    const edgeRes = await app.request(`/v1/edges/${edge.id}`, { headers: h() });
    expect((await edgeRes.json()).data.lifecycleStatus).toBe("ARCHIVED");
  });

  it("archive: cascades to incoming edges (target_id = archived node)", async () => {
    const upstream = await createNode("lc-upstream");
    const archived = await createNode("lc-archived");
    // incoming edge: upstream → archived (archived is the target)
    const incomingEdge = await createEdge(upstream.id, archived.id);

    await app.request(`/v1/nodes/${archived.id}/lifecycle`, {
      method: "PATCH", headers: h(), body: JSON.stringify({ transition: "deprecate" }),
    });
    const res = await app.request(`/v1/nodes/${archived.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "archive" }),
    });
    expect(res.status).toBe(200);

    // Incoming edge must also be ARCHIVED (not left ACTIVE)
    const edgeRes = await app.request(`/v1/edges/${incomingEdge.id}`, { headers: h() });
    expect((await edgeRes.json()).data.lifecycleStatus).toBe("ARCHIVED");
  });

  it("deprecate does not cascade incoming edges — edge stays ACTIVE", async () => {
    const upstream = await createNode("lc-no-cascade-up");
    const target = await createNode("lc-no-cascade-tgt");
    // incoming edge: upstream → target
    const incomingEdge = await createEdge(upstream.id, target.id);

    // Deprecate target — must NOT touch the edge
    const res = await app.request(`/v1/nodes/${target.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "deprecate" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.lifecycleStatus).toBe("DEPRECATED");

    // Incoming edge must remain ACTIVE
    const edgeRes = await app.request(`/v1/edges/${incomingEdge.id}`, { headers: h() });
    expect((await edgeRes.json()).data.lifecycleStatus).toBe("ACTIVE");
  });

  it("purge: ARCHIVED → PURGE", async () => {
    const node = await createNode("lc-purge");
    await app.request(`/v1/nodes/${node.id}/lifecycle`, {
      method: "PATCH", headers: h(), body: JSON.stringify({ transition: "deprecate" }),
    });
    await app.request(`/v1/nodes/${node.id}/lifecycle`, {
      method: "PATCH", headers: h(), body: JSON.stringify({ transition: "archive" }),
    });
    const res = await app.request(`/v1/nodes/${node.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "purge" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.lifecycleStatus).toBe("PURGE");
    expect(data.purgeAfter).toBeTruthy();
  });
});

describe("PATCH /v1/nodes/:id/lifecycle — invalid transitions (422)", () => {
  it("returns 422 for skip: ACTIVE → ARCHIVED", async () => {
    const node = await createNode("lc-skip");
    const res = await app.request(`/v1/nodes/${node.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "archive" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.currentStatus).toBe("ACTIVE");
    expect(body.requestedTransition).toBe("archive");
    expect(body.allowed).toEqual(["deprecate"]);
  });

  it("returns 422 for skip: ACTIVE → PURGE", async () => {
    const node = await createNode("lc-skip2");
    const res = await app.request(`/v1/nodes/${node.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "purge" }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).currentStatus).toBe("ACTIVE");
  });

  it("returns 422 for reverse: DEPRECATED → DEPRECATED (re-deprecate)", async () => {
    const node = await createNode("lc-reverse");
    await app.request(`/v1/nodes/${node.id}/lifecycle`, {
      method: "PATCH", headers: h(), body: JSON.stringify({ transition: "deprecate" }),
    });
    const res = await app.request(`/v1/nodes/${node.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "deprecate" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.currentStatus).toBe("DEPRECATED");
    expect(body.allowed).toEqual(["archive"]);
  });

  it("returns 404 for a non-existent node", async () => {
    const res = await app.request(`/v1/nodes/${randomUUID()}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "deprecate" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 for an invalid transition value", async () => {
    const node = await createNode("lc-bad");
    const res = await app.request(`/v1/nodes/${node.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "explode" }),
    });
    expect(res.status).toBe(400);
  });
});

// ── PATCH /v1/edges/:id/lifecycle ────────────────────────────────────────────

describe("PATCH /v1/edges/:id/lifecycle — positive paths", () => {
  it("deprecate: ACTIVE → DEPRECATED", async () => {
    const src = await createNode("e-src");
    const tgt = await createNode("e-tgt");
    const edge = await createEdge(src.id, tgt.id);

    const res = await app.request(`/v1/edges/${edge.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "deprecate" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.lifecycleStatus).toBe("DEPRECATED");
    expect(data.deprecatedAt).toBeTruthy();
  });

  it("archive: DEPRECATED → ARCHIVED", async () => {
    const src = await createNode("e-src2");
    const tgt = await createNode("e-tgt2");
    const edge = await createEdge(src.id, tgt.id);

    await app.request(`/v1/edges/${edge.id}/lifecycle`, {
      method: "PATCH", headers: h(), body: JSON.stringify({ transition: "deprecate" }),
    });
    const res = await app.request(`/v1/edges/${edge.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "archive" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.lifecycleStatus).toBe("ARCHIVED");
  });

  it("purge: ARCHIVED → PURGE", async () => {
    const src = await createNode("e-src3");
    const tgt = await createNode("e-tgt3");
    const edge = await createEdge(src.id, tgt.id);

    for (const t of ["deprecate", "archive"] as const) {
      await app.request(`/v1/edges/${edge.id}/lifecycle`, {
        method: "PATCH", headers: h(), body: JSON.stringify({ transition: t }),
      });
    }
    const res = await app.request(`/v1/edges/${edge.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "purge" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.lifecycleStatus).toBe("PURGE");
    expect(data.purgeAfter).toBeTruthy();
  });
});

describe("PATCH /v1/edges/:id/lifecycle — invalid transitions (422)", () => {
  it("returns 422 for skip: ACTIVE → ARCHIVED", async () => {
    const src = await createNode("es-src");
    const tgt = await createNode("es-tgt");
    const edge = await createEdge(src.id, tgt.id);

    const res = await app.request(`/v1/edges/${edge.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "archive" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.currentStatus).toBe("ACTIVE");
    expect(body.requestedTransition).toBe("archive");
    expect(body.allowed).toEqual(["deprecate"]);
  });

  it("returns 422 for reverse: ARCHIVED → DEPRECATED", async () => {
    const src = await createNode("es-src2");
    const tgt = await createNode("es-tgt2");
    const edge = await createEdge(src.id, tgt.id);

    for (const t of ["deprecate", "archive"] as const) {
      await app.request(`/v1/edges/${edge.id}/lifecycle`, {
        method: "PATCH", headers: h(), body: JSON.stringify({ transition: t }),
      });
    }
    const res = await app.request(`/v1/edges/${edge.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "deprecate" }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).currentStatus).toBe("ARCHIVED");
  });

  it("returns 404 for a non-existent edge", async () => {
    const res = await app.request(`/v1/edges/${randomUUID()}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "deprecate" }),
    });
    expect(res.status).toBe(404);
  });
});

// ── POST /v1/nodes/batch-lifecycle ───────────────────────────────────────────

describe("POST /v1/nodes/batch-lifecycle", () => {
  it("transitions all nodes and returns 200 when all succeed", async () => {
    const n1 = await createNode("bl-1");
    const n2 = await createNode("bl-2");

    const res = await app.request("/v1/nodes/batch-lifecycle", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ ids: [n1.id, n2.id], transition: "deprecate" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.succeeded).toHaveLength(2);
    expect(data.failed).toHaveLength(0);
    expect(data.succeeded.every((n: any) => n.lifecycleStatus === "DEPRECATED")).toBe(true);
  });

  it("returns 207 for partial success (one valid, one invalid transition)", async () => {
    const active = await createNode("bl-active");
    const deprecated = await createNode("bl-deprecated");
    // pre-deprecate so it's already DEPRECATED — trying to deprecate again will fail
    await app.request(`/v1/nodes/${deprecated.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "deprecate" }),
    });

    const res = await app.request("/v1/nodes/batch-lifecycle", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ ids: [active.id, deprecated.id], transition: "deprecate" }),
    });
    expect(res.status).toBe(207);
    const { data } = await res.json();
    expect(data.succeeded).toHaveLength(1);
    expect(data.succeeded[0].id).toBe(active.id);
    expect(data.failed).toHaveLength(1);
    expect(data.failed[0].id).toBe(deprecated.id);
    expect(data.failed[0].currentStatus).toBe("DEPRECATED");
  });

  it("returns 422 when all nodes fail the transition", async () => {
    const n1 = await createNode("bl-fail-1");
    const n2 = await createNode("bl-fail-2");
    // both are ACTIVE; trying to archive (requires DEPRECATED) will fail
    const res = await app.request("/v1/nodes/batch-lifecycle", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ ids: [n1.id, n2.id], transition: "archive" }),
    });
    expect(res.status).toBe(422);
    const { data } = await res.json();
    expect(data.succeeded).toHaveLength(0);
    expect(data.failed).toHaveLength(2);
  });

  it("includes not-found nodes in failed with error 'not found'", async () => {
    const { randomUUID } = await import("node:crypto");
    const existing = await createNode("bl-exists");
    const missingId = randomUUID();

    const res = await app.request("/v1/nodes/batch-lifecycle", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ ids: [existing.id, missingId], transition: "deprecate" }),
    });
    expect(res.status).toBe(207);
    const { data } = await res.json();
    expect(data.succeeded).toHaveLength(1);
    expect(data.failed[0].id).toBe(missingId);
    expect(data.failed[0].error).toMatch(/not found/);
  });

  it("returns 400 for an invalid transition value", async () => {
    const node = await createNode("bl-bad-transition");
    const res = await app.request("/v1/nodes/batch-lifecycle", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ ids: [node.id], transition: "explode" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for an empty ids array", async () => {
    const res = await app.request("/v1/nodes/batch-lifecycle", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ ids: [], transition: "deprecate" }),
    });
    expect(res.status).toBe(400);
  });
});

// ── GET /v1/nodes/:id includes lifecycle fields ───────────────────────────────

describe("GET /v1/nodes/:id lifecycle fields", () => {
  it("includes lifecycleStatus, deprecatedAt, archivedAt in response", async () => {
    const node = await createNode("lc-get");
    const res = await app.request(`/v1/nodes/${node.id}`, { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.lifecycleStatus).toBe("ACTIVE");
    expect("deprecatedAt" in data).toBe(true);
    expect("archivedAt" in data).toBe(true);
  });

  it("deprecatedAt is set after deprecation", async () => {
    const node = await createNode("lc-get2");
    await app.request(`/v1/nodes/${node.id}/lifecycle`, {
      method: "PATCH", headers: h(), body: JSON.stringify({ transition: "deprecate" }),
    });
    const res = await app.request(`/v1/nodes/${node.id}`, { headers: h() });
    const { data } = await res.json();
    expect(data.lifecycleStatus).toBe("DEPRECATED");
    expect(data.deprecatedAt).toBeTruthy();
    expect(data.archivedAt).toBeFalsy();
  });
});
