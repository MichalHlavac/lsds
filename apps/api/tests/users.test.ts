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

async function createUser(externalId = "ext-001", displayName = "Alice") {
  const res = await app.request("/v1/users", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ externalId, displayName, email: `${externalId}@example.com` }),
  });
  return (await res.json()).data;
}

async function createTeam(name = "platform") {
  const res = await app.request("/v1/teams", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ name }),
  });
  return (await res.json()).data;
}

// ── Users ─────────────────────────────────────────────────────────────────────

describe("POST /v1/users", () => {
  it("creates a user and returns 201", async () => {
    const res = await app.request("/v1/users", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ externalId: "ext-001", displayName: "Alice", email: "alice@x.com" }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.externalId).toBe("ext-001");
    expect(data.displayName).toBe("Alice");
    expect(data.role).toBe("viewer");
  });

  it("upserts on duplicate externalId (same tenant)", async () => {
    await createUser("ext-001", "Alice");
    const res = await app.request("/v1/users", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ externalId: "ext-001", displayName: "Alice Updated" }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).data.displayName).toBe("Alice Updated");
  });

  it("returns 400 for an invalid email", async () => {
    const res = await app.request("/v1/users", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ externalId: "x", displayName: "A", email: "not-email" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("validation error");
  });

  it("returns 400 when externalId is missing", async () => {
    const res = await app.request("/v1/users", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ displayName: "Alice" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/users", () => {
  it("returns 200 and lists users for the tenant", async () => {
    await createUser();
    const res = await app.request("/v1/users", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty array for a tenant with no users", async () => {
    const res = await app.request("/v1/users", { headers: h() });
    expect((await res.json()).data).toEqual([]);
  });
});

describe("GET /v1/users/:id", () => {
  it("returns 200 and the user when found", async () => {
    const user = await createUser();
    const res = await app.request(`/v1/users/${user.id}`, { headers: h() });
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe(user.id);
  });

  it("returns 404 for a nonexistent user ID", async () => {
    const res = await app.request(`/v1/users/${randomUUID()}`, { headers: h() });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /v1/users/:id", () => {
  it("deletes the user and returns its id", async () => {
    const user = await createUser();
    const res = await app.request(`/v1/users/${user.id}`, { method: "DELETE", headers: h() });
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe(user.id);
  });

  it("returns 404 for a nonexistent user ID", async () => {
    const res = await app.request(`/v1/users/${randomUUID()}`, { method: "DELETE", headers: h() });
    expect(res.status).toBe(404);
  });
});

// ── Teams ─────────────────────────────────────────────────────────────────────

describe("POST /v1/teams", () => {
  it("creates a team and returns 201", async () => {
    const res = await app.request("/v1/teams", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "backend" }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).data.name).toBe("backend");
  });

  it("upserts on duplicate name (same tenant)", async () => {
    await createTeam("alpha");
    const res = await app.request("/v1/teams", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "alpha", attributes: { region: "eu" } }),
    });
    expect(res.status).toBe(201);
  });

  it("returns 400 when name is missing", async () => {
    const res = await app.request("/v1/teams", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("validation error");
  });
});

describe("GET /v1/teams", () => {
  it("returns 200 with teams for the tenant", async () => {
    await createTeam();
    const res = await app.request("/v1/teams", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /v1/teams/:id", () => {
  it("returns 200 and the team when found", async () => {
    const team = await createTeam();
    const res = await app.request(`/v1/teams/${team.id}`, { headers: h() });
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe(team.id);
  });

  it("returns 404 for a nonexistent team ID", async () => {
    const res = await app.request(`/v1/teams/${randomUUID()}`, { headers: h() });
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/teams/:id/members", () => {
  it("adds a user to a team and returns the membership", async () => {
    const team = await createTeam();
    const user = await createUser();

    const res = await app.request(`/v1/teams/${team.id}/members`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ userId: user.id }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.teamId).toBe(team.id);
    expect(data.userId).toBe(user.id);
  });

  it("returns 404 when the team does not exist", async () => {
    const user = await createUser();
    const res = await app.request(`/v1/teams/${randomUUID()}/members`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ userId: user.id }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/team/);
  });

  it("returns 404 when the user does not exist", async () => {
    const team = await createTeam();
    const res = await app.request(`/v1/teams/${team.id}/members`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ userId: randomUUID() }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/user/);
  });
});

describe("DELETE /v1/teams/:id/members/:userId", () => {
  it("removes a member and returns the membership identifiers", async () => {
    const team = await createTeam();
    const user = await createUser();
    await app.request(`/v1/teams/${team.id}/members`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ userId: user.id }),
    });

    const res = await app.request(`/v1/teams/${team.id}/members/${user.id}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.teamId).toBe(team.id);
    expect(data.userId).toBe(user.id);
  });

  it("returns 404 when the team does not exist", async () => {
    const res = await app.request(`/v1/teams/${randomUUID()}/members/${randomUUID()}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /v1/teams/:id", () => {
  it("deletes the team and returns its id", async () => {
    const team = await createTeam("disposable");
    const res = await app.request(`/v1/teams/${team.id}`, { method: "DELETE", headers: h() });
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe(team.id);
  });

  it("returns 404 for a nonexistent team ID", async () => {
    const res = await app.request(`/v1/teams/${randomUUID()}`, { method: "DELETE", headers: h() });
    expect(res.status).toBe(404);
  });
});
