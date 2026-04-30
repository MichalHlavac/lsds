// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { lifecycleRouter } from "../src/routes/lifecycle";
import type { LifecycleService } from "../src/lifecycle/index";
import { T, ID1, h, withErrorHandler, fakeNode } from "./test-helpers";

function makeSvc(overrides: Partial<LifecycleService> = {}): LifecycleService {
  return {
    deprecate: vi.fn().mockResolvedValue(fakeNode()),
    archive: vi.fn().mockResolvedValue(fakeNode()),
    markForPurge: vi.fn().mockResolvedValue(fakeNode()),
    purge: vi.fn().mockResolvedValue(undefined),
    applyRetentionPolicy: vi.fn().mockResolvedValue({ deprecated: 0, archived: 0, purged: 0 }),
    ...overrides,
  } as unknown as LifecycleService;
}

function makeApp(svc: LifecycleService) {
  const app = new Hono();
  app.route("/v1/lifecycle", lifecycleRouter(svc));
  return withErrorHandler(app);
}

describe("POST /v1/lifecycle/nodes/:id/deprecate", () => {
  it("returns 200 with node data on success", async () => {
    const svc = makeSvc();
    const app = makeApp(svc);
    const res = await app.request(`/v1/lifecycle/nodes/${ID1}/deprecate`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(svc.deprecate).toHaveBeenCalledWith(T, ID1);
  });

  it("returns 400 when service throws", async () => {
    const svc = makeSvc({
      deprecate: vi.fn().mockRejectedValue(new Error("node not found or not ACTIVE")),
    });
    const app = makeApp(svc);
    const res = await app.request(`/v1/lifecycle/nodes/${ID1}/deprecate`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("not ACTIVE");
  });
});

describe("POST /v1/lifecycle/nodes/:id/archive", () => {
  it("returns 200 with node data on success", async () => {
    const svc = makeSvc();
    const app = makeApp(svc);
    const res = await app.request(`/v1/lifecycle/nodes/${ID1}/archive`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(svc.archive).toHaveBeenCalledWith(T, ID1);
  });

  it("returns 400 when service throws", async () => {
    const svc = makeSvc({
      archive: vi.fn().mockRejectedValue(new Error("already archived")),
    });
    const app = makeApp(svc);
    const res = await app.request(`/v1/lifecycle/nodes/${ID1}/archive`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/lifecycle/nodes/:id/mark-purge", () => {
  it("returns 200 on success with no body", async () => {
    const svc = makeSvc();
    const app = makeApp(svc);
    const res = await app.request(`/v1/lifecycle/nodes/${ID1}/mark-purge`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(200);
    expect(svc.markForPurge).toHaveBeenCalledWith(T, ID1, undefined);
  });

  it("forwards purgeAfterDays to service", async () => {
    const svc = makeSvc();
    const app = makeApp(svc);
    const res = await app.request(`/v1/lifecycle/nodes/${ID1}/mark-purge`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ purgeAfterDays: 30 }),
    });
    expect(res.status).toBe(200);
    expect(svc.markForPurge).toHaveBeenCalledWith(T, ID1, 30);
  });
});

describe("DELETE /v1/lifecycle/nodes/:id/purge", () => {
  it("returns 200 with purged: true on success", async () => {
    const svc = makeSvc();
    const app = makeApp(svc);
    const res = await app.request(`/v1/lifecycle/nodes/${ID1}/purge`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.purged).toBe(true);
    expect(body.data.id).toBe(ID1);
  });

  it("returns 400 when service throws", async () => {
    const svc = makeSvc({
      purge: vi.fn().mockRejectedValue(new Error("node not ready for purge")),
    });
    const app = makeApp(svc);
    const res = await app.request(`/v1/lifecycle/nodes/${ID1}/purge`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/lifecycle/apply-retention", () => {
  it("returns 200 with retention result", async () => {
    const svc = makeSvc();
    const app = makeApp(svc);
    const res = await app.request("/v1/lifecycle/apply-retention", {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(svc.applyRetentionPolicy).toHaveBeenCalledWith(T);
  });
});
