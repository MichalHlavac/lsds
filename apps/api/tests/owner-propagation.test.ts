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

const OWNER = { kind: "team" as const, id: "team-abc", name: "Platform Team" };

// ── POST /v1/nodes — owner persisted ─────────────────────────────────────────

describe("POST /v1/nodes — owner field propagation", () => {
  it("persists owner fields and returns them in the response", async () => {
    const res = await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        type: "Service",
        layer: "L4",
        name: "auth-service",
        owner: OWNER,
      }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.ownerId).toBe("team-abc");
    expect(data.ownerName).toBe("Platform Team");
    expect(data.ownerKind).toBe("team");
  });

  it("defaults owner fields to empty strings when owner is omitted", async () => {
    const res = await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        type: "Service",
        layer: "L4",
        name: "no-owner-service",
      }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.ownerId).toBe("");
    expect(data.ownerName).toBe("");
  });

  it("rejects an invalid owner shape (missing kind)", async () => {
    const res = await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        type: "Service",
        layer: "L4",
        name: "bad-owner-service",
        owner: { id: "team-x", name: "X Team" },
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ── PUT /v1/nodes — owner upsert ─────────────────────────────────────────────

describe("PUT /v1/nodes — owner field propagation on upsert", () => {
  it("creates a node with owner on first upsert", async () => {
    const res = await app.request("/v1/nodes", {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({
        type: "Service",
        layer: "L4",
        name: "upsert-service",
        owner: OWNER,
      }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.ownerId).toBe("team-abc");
    expect(data.ownerName).toBe("Platform Team");
  });

  it("updates owner fields on subsequent upsert", async () => {
    // First upsert — create with initial owner
    await app.request("/v1/nodes", {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({
        type: "Service",
        layer: "L4",
        name: "upsert-service",
        owner: OWNER,
      }),
    });

    const updatedOwner = { kind: "team" as const, id: "team-xyz", name: "SRE Team" };
    const res = await app.request("/v1/nodes", {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({
        type: "Service",
        layer: "L4",
        name: "upsert-service",
        owner: updatedOwner,
      }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.ownerId).toBe("team-xyz");
    expect(data.ownerName).toBe("SRE Team");
  });
});

// ── POST /v1/nodes/preview-violations — owner used in draft ──────────────────

describe("POST /v1/nodes/preview-violations — owner field in draft", () => {
  it("accepts owner and returns violations shape without error", async () => {
    const res = await app.request("/v1/nodes/preview-violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        type: "Service",
        layer: "L4",
        name: "preview-svc",
        owner: OWNER,
      }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toHaveProperty("violations");
    expect(data).toHaveProperty("suggestions");
  });
});

// ── POST /agent/v1/architect/impact-predict — owner in simulate ──────────────

describe("POST /agent/v1/architect/impact-predict — owner in proposedNode", () => {
  it("accepts owner in proposedNode and returns predictedAt", async () => {
    const res = await app.request("/agent/v1/architect/impact-predict", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        changeType: "create",
        proposedNode: {
          type: "Service",
          layer: "L4",
          name: "new-service",
          owner: OWNER,
        },
      }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toHaveProperty("predictedAt");
    expect(data.changeType).toBe("create");
  });

  it("accepts proposedNode without owner (owner defaults to empty strings)", async () => {
    const res = await app.request("/agent/v1/architect/impact-predict", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        changeType: "create",
        proposedNode: {
          type: "Service",
          layer: "L4",
          name: "new-service-no-owner",
        },
      }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toHaveProperty("predictedAt");
  });
});
