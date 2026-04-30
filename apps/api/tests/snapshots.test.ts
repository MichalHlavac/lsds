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

// ── POST /v1/snapshots ────────────────────────────────────────────────────────

describe("POST /v1/snapshots", () => {
  it("creates a snapshot and returns 201 with the persisted row", async () => {
    const res = await app.request("/v1/snapshots", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ label: "backup-2026", nodeCount: 42, edgeCount: 100 }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(typeof data.id).toBe("string");
    expect(data.label).toBe("backup-2026");
    expect(data.nodeCount).toBe(42);
    expect(data.edgeCount).toBe(100);
    expect(data.snapshotData).toEqual({});
  });

  it("applies defaults when body is empty", async () => {
    const res = await app.request("/v1/snapshots", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.label).toBe("");
    expect(data.nodeCount).toBe(0);
    expect(data.edgeCount).toBe(0);
    expect(data.snapshotData).toEqual({});
  });

  it("persists snapshotData payload", async () => {
    const payload = { nodes: ["a", "b"], edges: ["e1"] };
    const res = await app.request("/v1/snapshots", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ snapshotData: payload }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).data.snapshotData).toEqual(payload);
  });

  it("returns 400 when x-tenant-id header is absent", async () => {
    const res = await app.request("/v1/snapshots", {
      method: "POST",
      body: JSON.stringify({ label: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when nodeCount is negative", async () => {
    const res = await app.request("/v1/snapshots", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ nodeCount: -1 }),
    });
    expect(res.status).toBe(400);
  });
});

// ── GET /v1/snapshots ─────────────────────────────────────────────────────────

describe("GET /v1/snapshots", () => {
  it("returns 200 and lists all snapshots for the tenant", async () => {
    await app.request("/v1/snapshots", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ label: "snap-1" }),
    });
    const res = await app.request("/v1/snapshots", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0].label).toBe("snap-1");
  });

  it("returns empty array for a tenant with no snapshots", async () => {
    const res = await app.request("/v1/snapshots", { headers: h() });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);
  });

  it("returns 400 when x-tenant-id header is absent", async () => {
    const res = await app.request("/v1/snapshots");
    expect(res.status).toBe(400);
  });

  it("does not return snapshots belonging to a different tenant", async () => {
    await app.request("/v1/snapshots", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ label: "other-tenant-snap" }),
    });
    const otherTid = randomUUID();
    const res = await app.request("/v1/snapshots", {
      headers: { "content-type": "application/json", "x-tenant-id": otherTid },
    });
    expect((await res.json()).data).toEqual([]);
  });
});

// ── GET /v1/snapshots/:id ─────────────────────────────────────────────────────

describe("GET /v1/snapshots/:id", () => {
  it("returns 200 and the snapshot when it exists", async () => {
    const createRes = await app.request("/v1/snapshots", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ label: "my-snap" }),
    });
    const { data: created } = await createRes.json();

    const res = await app.request(`/v1/snapshots/${created.id}`, { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.id).toBe(created.id);
    expect(data.label).toBe("my-snap");
  });

  it("returns 404 for a nonexistent snapshot ID", async () => {
    const res = await app.request(`/v1/snapshots/${randomUUID()}`, { headers: h() });
    expect(res.status).toBe(404);
  });

  it("returns 404 when snapshot belongs to a different tenant", async () => {
    const createRes = await app.request("/v1/snapshots", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ label: "owned-snap" }),
    });
    const { data: created } = await createRes.json();

    const otherHeaders = { "content-type": "application/json", "x-tenant-id": randomUUID() };
    const res = await app.request(`/v1/snapshots/${created.id}`, { headers: otherHeaders });
    expect(res.status).toBe(404);
  });
});
