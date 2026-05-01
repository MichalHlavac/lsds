// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant } from "./test-helpers";

let tid: string;
let sessionId: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

beforeEach(() => {
  tid = randomUUID();
  sessionId = randomUUID();
});
afterEach(async () => {
  await cleanTenant(sql, tid);
});

async function propose(overrides: Record<string, unknown> = {}) {
  const res = await app.request("/agent/v1/migration/propose", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({
      sessionId,
      sourceRef: "file:docs/arch.md",
      proposedType: "Service",
      proposedLayer: "L3",
      proposedName: "PaymentService",
      owner: "team-platform",
      ...overrides,
    }),
  });
  return res;
}

// ── POST /agent/v1/migration/propose ─────────────────────────────────────────

describe("POST /agent/v1/migration/propose", () => {
  it("returns 400 when x-tenant-id header is missing", async () => {
    const res = await app.request("/agent/v1/migration/propose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        sourceRef: "file:x.md",
        proposedType: "Service",
        proposedLayer: "L3",
        proposedName: "X",
        owner: "someone",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when owner is missing", async () => {
    const res = await propose({ owner: undefined });
    expect(res.status).toBe(400);
  });

  it("creates a draft with status pending and no review_flags when confidence is HIGH", async () => {
    const res = await propose({
      confidence: { version: "HIGH", owner: "HIGH" },
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.status).toBe("pending");
    expect(data.reviewFlags).toEqual([]);
  });

  it("computes review_flags from LOW-confidence attributes", async () => {
    const res = await propose({
      proposedAttrs: { version: "1.0.0", team: "unknown" },
      confidence: { version: "HIGH", team: "LOW" },
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.reviewFlags).toContain("team");
    expect(data.reviewFlags).not.toContain("version");
  });

  it("stores owner and sourceRef correctly", async () => {
    const res = await propose({ owner: "team-backend", sourceRef: "confluence:PAGE-999" });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.owner).toBe("team-backend");
    expect(data.sourceRef).toBe("confluence:PAGE-999");
  });
});

// ── GET /agent/v1/migration/sessions/:sessionId ───────────────────────────────

describe("GET /agent/v1/migration/sessions/:sessionId", () => {
  it("returns empty session when no drafts exist", async () => {
    const res = await app.request(`/agent/v1/migration/sessions/${sessionId}`, {
      headers: h(),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.total).toBe(0);
    expect(data.drafts).toEqual([]);
  });

  it("returns correct aggregated counts", async () => {
    // Create 3 drafts: 2 normal, 1 with LOW confidence
    await propose({ proposedName: "A" });
    await propose({ proposedName: "B", confidence: { version: "LOW" } });
    await propose({ proposedName: "C" });

    const res = await app.request(`/agent/v1/migration/sessions/${sessionId}`, {
      headers: h(),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.total).toBe(3);
    expect(data.pending).toBe(3);
    expect(data.approved).toBe(0);
    expect(data.rejected).toBe(0);
    expect(data.flaggedForReview).toBe(1);
  });
});

// ── PATCH /agent/v1/migration/drafts/:draftId ─────────────────────────────────

describe("PATCH /agent/v1/migration/drafts/:draftId", () => {
  it("returns 404 for unknown draft", async () => {
    const res = await app.request(`/agent/v1/migration/drafts/${randomUUID()}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ status: "approved" }),
    });
    expect(res.status).toBe(404);
  });

  it("approves a pending draft", async () => {
    const propRes = await propose();
    const { data: draft } = await propRes.json();

    const patchRes = await app.request(`/agent/v1/migration/drafts/${draft.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ status: "approved" }),
    });
    expect(patchRes.status).toBe(200);
    const { data } = await patchRes.json();
    expect(data.status).toBe("approved");
    expect(data.reviewedAt).not.toBeNull();
  });

  it("rejects a pending draft", async () => {
    const propRes = await propose();
    const { data: draft } = await propRes.json();

    const patchRes = await app.request(`/agent/v1/migration/drafts/${draft.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ status: "rejected" }),
    });
    expect(patchRes.status).toBe(200);
    const { data } = await patchRes.json();
    expect(data.status).toBe("rejected");
  });

  it("returns 400 when trying to re-review an already-approved draft", async () => {
    const propRes = await propose();
    const { data: draft } = await propRes.json();

    await app.request(`/agent/v1/migration/drafts/${draft.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ status: "approved" }),
    });

    const reReview = await app.request(`/agent/v1/migration/drafts/${draft.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ status: "rejected" }),
    });
    expect(reReview.status).toBe(400);
  });

  it("allows overriding proposedAttrs without changing status", async () => {
    const propRes = await propose({ proposedAttrs: { version: "1.0.0" } });
    const { data: draft } = await propRes.json();

    const patchRes = await app.request(`/agent/v1/migration/drafts/${draft.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ proposedAttrs: { version: "2.0.0" } }),
    });
    expect(patchRes.status).toBe(200);
    const { data } = await patchRes.json();
    expect(data.status).toBe("pending");
    expect(data.proposedAttrs.version).toBe("2.0.0");
  });
});

// ── POST /agent/v1/migration/sessions/:sessionId/commit ───────────────────────

describe("POST /agent/v1/migration/sessions/:sessionId/commit", () => {
  it("returns 0 committed when no approved drafts exist", async () => {
    await propose({ proposedName: "PendingService" });

    const res = await app.request(`/agent/v1/migration/sessions/${sessionId}/commit`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.committed).toBe(0);
    expect(data.nodeIds).toEqual([]);
  });

  it("commits only approved drafts and returns their node IDs", async () => {
    // Create 2 drafts, approve 1, reject 1
    const r1 = await propose({ proposedName: "ServiceA" });
    const { data: d1 } = await r1.json();
    const r2 = await propose({ proposedName: "ServiceB" });
    const { data: d2 } = await r2.json();

    await app.request(`/agent/v1/migration/drafts/${d1.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ status: "approved" }),
    });
    await app.request(`/agent/v1/migration/drafts/${d2.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ status: "rejected" }),
    });

    const commitRes = await app.request(`/agent/v1/migration/sessions/${sessionId}/commit`, {
      method: "POST",
      headers: h(),
    });
    expect(commitRes.status).toBe(200);
    const { data } = await commitRes.json();
    expect(data.committed).toBe(1);
    expect(data.nodeIds).toHaveLength(1);
    expect(data.skipped).toBe(1);

    // Verify the node was actually created in the nodes table
    const nodeRes = await app.request(`/v1/nodes/${data.nodeIds[0]}`, { headers: h() });
    expect(nodeRes.status).toBe(200);
    const { data: node } = await nodeRes.json();
    expect(node.name).toBe("ServiceA");
    expect(node.attributes.owner).toBe("team-platform");
    expect(node.attributes.migratedFrom).toBe("file:docs/arch.md");
  });

  it("returns 0 committed and correct skipped for an empty session", async () => {
    const res = await app.request(`/agent/v1/migration/sessions/${sessionId}/commit`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.committed).toBe(0);
    expect(data.skipped).toBe(0);
  });
});
