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

async function createNode(layer = "L4") {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ type: "Service", layer, name: randomUUID() }),
  });
  return (await res.json()).data;
}

async function postEdge(sourceId: string, targetId: string, type: string, layer = "L4") {
  return app.request("/v1/edges", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ sourceId, targetId, type, layer }),
  });
}

// ── 1:1 — supersedes ─────────────────────────────────────────────────────────

describe("cardinality 1:1 (supersedes)", () => {
  it("allows the first supersedes edge", async () => {
    const src = await createNode("L3");
    const tgt = await createNode("L3");
    const res = await postEdge(src.id, tgt.id, "supersedes", "L3");
    expect(res.status).toBe(201);
  });

  it("returns 422 CARDINALITY_VIOLATED when source already has an outgoing supersedes edge", async () => {
    const src = await createNode("L3");
    const tgt1 = await createNode("L3");
    const tgt2 = await createNode("L3");

    const first = await postEdge(src.id, tgt1.id, "supersedes", "L3");
    expect(first.status).toBe(201);

    const second = await postEdge(src.id, tgt2.id, "supersedes", "L3");
    expect(second.status).toBe(422);
    const body = await second.json();
    expect(body.error).toBe("cardinality violation");
    expect(body.violations[0].code).toBe("CARDINALITY_VIOLATED");
  });

  it("returns 422 CARDINALITY_VIOLATED when target already has an incoming supersedes edge", async () => {
    const src1 = await createNode("L3");
    const src2 = await createNode("L3");
    const tgt = await createNode("L3");

    const first = await postEdge(src1.id, tgt.id, "supersedes", "L3");
    expect(first.status).toBe(201);

    const second = await postEdge(src2.id, tgt.id, "supersedes", "L3");
    expect(second.status).toBe(422);
    const body = await second.json();
    expect(body.error).toBe("cardinality violation");
    expect(body.violations[0].code).toBe("CARDINALITY_VIOLATED");
  });
});

// ── 1:N — contains ───────────────────────────────────────────────────────────
// contains: SOURCE_LTE_TARGET ordinal — L4 → L4 satisfies 4 ≤ 4.

describe("cardinality 1:N (contains)", () => {
  it("allows multiple outgoing contains edges from one source (unrestricted source side)", async () => {
    const src = await createNode();
    const tgt1 = await createNode();
    const tgt2 = await createNode();

    const r1 = await postEdge(src.id, tgt1.id, "contains");
    const r2 = await postEdge(src.id, tgt2.id, "contains");
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
  });

  it("returns 422 CARDINALITY_VIOLATED when a second source tries to contain the same target", async () => {
    const src1 = await createNode();
    const src2 = await createNode();
    const tgt = await createNode();

    const first = await postEdge(src1.id, tgt.id, "contains");
    expect(first.status).toBe(201);

    const second = await postEdge(src2.id, tgt.id, "contains");
    expect(second.status).toBe(422);
    const body = await second.json();
    expect(body.error).toBe("cardinality violation");
    expect(body.violations[0].code).toBe("CARDINALITY_VIOLATED");
  });
});

// ── N:1 — part-of ────────────────────────────────────────────────────────────
// part-of: SOURCE_GTE_TARGET ordinal — L4 → L4 satisfies 4 ≥ 4.

describe("cardinality N:1 (part-of)", () => {
  it("allows multiple sources to be part-of the same target (unrestricted target side)", async () => {
    const src1 = await createNode();
    const src2 = await createNode();
    const tgt = await createNode();

    const r1 = await postEdge(src1.id, tgt.id, "part-of");
    const r2 = await postEdge(src2.id, tgt.id, "part-of");
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
  });

  it("returns 422 CARDINALITY_VIOLATED when source already has an outgoing part-of edge", async () => {
    const src = await createNode();
    const tgt1 = await createNode();
    const tgt2 = await createNode();

    const first = await postEdge(src.id, tgt1.id, "part-of");
    expect(first.status).toBe(201);

    const second = await postEdge(src.id, tgt2.id, "part-of");
    expect(second.status).toBe(422);
    const body = await second.json();
    expect(body.error).toBe("cardinality violation");
    expect(body.violations[0].code).toBe("CARDINALITY_VIOLATED");
  });
});

// ── M:N — depends-on ─────────────────────────────────────────────────────────
// depends-on: SOURCE_LTE_TARGET ordinal — L4 → L4 satisfies 4 ≤ 4.

describe("cardinality M:N (depends-on) remains unrestricted", () => {
  it("allows multiple outgoing depends-on edges from one source", async () => {
    const src = await createNode();
    const tgt1 = await createNode();
    const tgt2 = await createNode();

    const r1 = await postEdge(src.id, tgt1.id, "depends-on");
    const r2 = await postEdge(src.id, tgt2.id, "depends-on");
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
  });

  it("allows multiple sources to depends-on the same target", async () => {
    const src1 = await createNode();
    const src2 = await createNode();
    const tgt = await createNode();

    const r1 = await postEdge(src1.id, tgt.id, "depends-on");
    const r2 = await postEdge(src2.id, tgt.id, "depends-on");
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
  });
});
