// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { usersRouter, teamsRouter } from "../src/routes/users";
import { T, ID1, ID2, h, makeSql, makeSeqSql, withErrorHandler, fakeUser, fakeTeam } from "./test-helpers";

function makeUsersApp(rows: unknown[] = []) {
  const app = new Hono();
  app.route("/v1/users", usersRouter(makeSql(rows)));
  return withErrorHandler(app);
}

function makeTeamsApp(rows: unknown[] = []) {
  const app = new Hono();
  app.route("/v1/teams", teamsRouter(makeSql(rows)));
  return withErrorHandler(app);
}

function makeTeamsSeqApp(...responses: unknown[][]) {
  const app = new Hono();
  app.route("/v1/teams", teamsRouter(makeSeqSql(...responses)));
  return withErrorHandler(app);
}

// ── Users ────────────────────────────────────────────────────────────────────

describe("GET /v1/users", () => {
  it("returns 200 with data array", async () => {
    const app = makeUsersApp([fakeUser()]);
    const res = await app.request("/v1/users", { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("returns 400 when x-tenant-id header is missing", async () => {
    const app = makeUsersApp();
    const res = await app.request("/v1/users");
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/users", () => {
  it("returns 201 for a valid user", async () => {
    const app = makeUsersApp([fakeUser()]);
    const res = await app.request("/v1/users", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        externalId: "ext-001",
        displayName: "Alice",
        email: "alice@example.com",
        role: "editor",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toBeDefined();
  });

  it("returns 400 for invalid email", async () => {
    const app = makeUsersApp();
    const res = await app.request("/v1/users", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        externalId: "ext-001",
        displayName: "Alice",
        email: "not-an-email",
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("validation error");
  });

  it("returns 400 when externalId is missing", async () => {
    const app = makeUsersApp();
    const res = await app.request("/v1/users", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ displayName: "Alice" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid role", async () => {
    const app = makeUsersApp();
    const res = await app.request("/v1/users", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ externalId: "x", displayName: "A", role: "superuser" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/users/:id", () => {
  it("returns 200 when user exists", async () => {
    const app = makeUsersApp([fakeUser()]);
    const res = await app.request(`/v1/users/${ID1}`, { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(ID1);
  });

  it("returns 404 when user does not exist", async () => {
    const app = makeUsersApp([]);
    const res = await app.request(`/v1/users/${ID1}`, { headers: h() });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /v1/users/:id", () => {
  it("returns 200 when user is deleted", async () => {
    const app = makeUsersApp([{ id: ID1 }]);
    const res = await app.request(`/v1/users/${ID1}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(ID1);
  });

  it("returns 404 when user does not exist", async () => {
    const app = makeUsersApp([]);
    const res = await app.request(`/v1/users/${ID1}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(404);
  });
});

// ── Teams ────────────────────────────────────────────────────────────────────

describe("GET /v1/teams", () => {
  it("returns 200 with data array", async () => {
    const app = makeTeamsApp([fakeTeam()]);
    const res = await app.request("/v1/teams", { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe("POST /v1/teams", () => {
  it("returns 201 for a valid team", async () => {
    const app = makeTeamsApp([fakeTeam()]);
    const res = await app.request("/v1/teams", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "platform" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toBeDefined();
  });

  it("returns 400 when name is missing", async () => {
    const app = makeTeamsApp();
    const res = await app.request("/v1/teams", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("validation error");
  });

  it("returns 400 when name is empty", async () => {
    const app = makeTeamsApp();
    const res = await app.request("/v1/teams", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/teams/:id", () => {
  it("returns 200 when team exists", async () => {
    const app = makeTeamsApp([fakeTeam()]);
    const res = await app.request(`/v1/teams/${ID1}`, { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(ID1);
  });

  it("returns 404 when team does not exist", async () => {
    const app = makeTeamsApp([]);
    const res = await app.request(`/v1/teams/${ID1}`, { headers: h() });
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/teams/:id/members", () => {
  it("returns 200 when team and user both exist", async () => {
    const team = fakeTeam();
    const user = fakeUser();
    // team lookup → [team], user lookup → [user]
    const app = makeTeamsSeqApp([team], [user]);
    const res = await app.request(`/v1/teams/${ID1}/members`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ userId: ID2 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.teamId).toBe(ID1);
    expect(body.data.userId).toBe(ID2);
  });

  it("returns 404 when team does not exist", async () => {
    const app = makeTeamsSeqApp([], [fakeUser()]);
    const res = await app.request(`/v1/teams/${ID1}/members`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ userId: ID2 }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/team/);
  });

  it("returns 404 when user does not exist", async () => {
    const app = makeTeamsSeqApp([fakeTeam()], []);
    const res = await app.request(`/v1/teams/${ID1}/members`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ userId: ID2 }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/user/);
  });
});

describe("DELETE /v1/teams/:id/members/:userId", () => {
  it("returns 200 when team exists", async () => {
    const app = makeTeamsSeqApp([fakeTeam()]);
    const res = await app.request(`/v1/teams/${ID1}/members/${ID2}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.teamId).toBe(ID1);
    expect(body.data.userId).toBe(ID2);
  });

  it("returns 404 when team does not exist", async () => {
    const app = makeTeamsSeqApp([]);
    const res = await app.request(`/v1/teams/${ID1}/members/${ID2}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /v1/teams/:id", () => {
  it("returns 200 when team is deleted", async () => {
    const app = makeTeamsApp([{ id: ID1 }]);
    const res = await app.request(`/v1/teams/${ID1}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(ID1);
  });

  it("returns 404 when team does not exist", async () => {
    const app = makeTeamsApp([]);
    const res = await app.request(`/v1/teams/${ID1}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(404);
  });
});
