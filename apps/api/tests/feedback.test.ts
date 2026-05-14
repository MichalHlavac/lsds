// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant, createTestTenant } from "./test-helpers";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

// feedback.tenant_id FK requires an actual tenant row
beforeEach(async () => { tid = randomUUID(); await createTestTenant(sql, tid); });
afterEach(async () => { await cleanTenant(sql, tid); });

// ── POST /v1/feedback ─────────────────────────────────────────────────────────

describe("POST /v1/feedback", () => {
  it("returns 201 with feedback payload for type=bug", async () => {
    const res = await app.request("/v1/feedback", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "bug", message: "Something broke" }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.type).toBe("bug");
    expect(data.message).toBe("Something broke");
    expect(data.metadata).toBeNull();
    expect(typeof data.id).toBe("string");
    expect(typeof data.createdAt).toBe("string");
  });

  it("accepts type=feature", async () => {
    const res = await app.request("/v1/feedback", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "feature", message: "Please add dark mode" }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).data.type).toBe("feature");
  });

  it("accepts type=general and defaults to general when omitted", async () => {
    const res = await app.request("/v1/feedback", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ message: "General observation" }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).data.type).toBe("general");
  });

  it("stores and returns optional metadata", async () => {
    const meta = { browser: "Firefox", version: "125.0" };
    const res = await app.request("/v1/feedback", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "bug", message: "UI glitch", metadata: meta }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).data.metadata).toEqual(meta);
  });

  it("cross-tenant isolation: row has correct tenant_id in DB", async () => {
    await app.request("/v1/feedback", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ message: "Isolation check" }),
    });
    const rows = await sql`SELECT tenant_id FROM feedback WHERE tenant_id = ${tid}`;
    expect(rows.length).toBe(1);
    expect(rows[0].tenantId).toBe(tid);
  });

  it("returns 400 when message is empty", async () => {
    const res = await app.request("/v1/feedback", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ message: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when message exceeds 5000 characters", async () => {
    const res = await app.request("/v1/feedback", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ message: "x".repeat(5001) }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when type is not a valid enum value", async () => {
    const res = await app.request("/v1/feedback", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "invalid", message: "test" }),
    });
    expect(res.status).toBe(400);
  });

  it("accepts message of exactly 5000 characters", async () => {
    const res = await app.request("/v1/feedback", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ message: "a".repeat(5000) }),
    });
    expect(res.status).toBe(201);
  });

  it("returns 400 when message field is absent from body", async () => {
    const res = await app.request("/v1/feedback", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "bug" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when x-tenant-id header is missing", async () => {
    const res = await app.request("/v1/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "no tenant" }),
    });
    expect(res.status).toBe(400);
  });

  it("two identical submissions each return 201 with distinct IDs (no duplicate guard)", async () => {
    const body = JSON.stringify({ message: "same message" });
    const [r1, r2] = await Promise.all([
      app.request("/v1/feedback", { method: "POST", headers: h(), body }),
      app.request("/v1/feedback", { method: "POST", headers: h(), body }),
    ]);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
    expect(d1.data.id).not.toBe(d2.data.id);
  });
});
