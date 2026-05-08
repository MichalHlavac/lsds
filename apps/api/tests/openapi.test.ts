// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import { app } from "../src/app";

// Priority routes from LSDS-664 that must appear in the spec.
const REQUIRED_PATHS = [
  "/health/live",
  "/health/ready",
  "/api/openapi.json",
  "/api/admin/tenants",
  "/api/admin/tenants/{tenantId}/api-keys",
  "/v1/nodes",
  "/v1/nodes/{id}",
  "/v1/nodes/search",
  "/v1/nodes/similar",
  "/v1/edges",
  "/v1/edges/{id}",
  "/v1/violations",
  "/v1/lifecycle/nodes/{id}/deprecate",
  "/v1/lifecycle/nodes/{id}/archive",
  "/v1/lifecycle/nodes/{id}/mark-purge",
  "/v1/lifecycle/nodes/{id}/purge",
];

describe("GET /api/openapi.json", () => {
  it("returns 200 without auth", async () => {
    const res = await app.request("/api/openapi.json");
    expect(res.status).toBe(200);
  });

  it("returns application/json content-type", async () => {
    const res = await app.request("/api/openapi.json");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("is a valid OpenAPI 3.1 document", async () => {
    const res = await app.request("/api/openapi.json");
    const spec = await res.json() as Record<string, unknown>;

    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info).toBeDefined();
    expect((spec.info as Record<string, unknown>).title).toBeTruthy();
    expect((spec.info as Record<string, unknown>).version).toBeTruthy();
    expect(spec.paths).toBeDefined();
    expect(typeof spec.paths).toBe("object");
    expect(spec.components).toBeDefined();
  });

  it("contains all priority routes", async () => {
    const res = await app.request("/api/openapi.json");
    const spec = await res.json() as { paths: Record<string, unknown> };
    const paths = Object.keys(spec.paths);

    for (const required of REQUIRED_PATHS) {
      expect(paths, `missing path: ${required}`).toContain(required);
    }
  });

  it("declares securitySchemes for TenantApiKey, TenantId, AdminBearer", async () => {
    const res = await app.request("/api/openapi.json");
    const spec = await res.json() as { components: { securitySchemes: Record<string, unknown> } };
    const schemes = Object.keys(spec.components.securitySchemes);
    expect(schemes).toContain("TenantApiKey");
    expect(schemes).toContain("TenantId");
    expect(schemes).toContain("AdminBearer");
  });

  it("declares reusable component schemas", async () => {
    const res = await app.request("/api/openapi.json");
    const spec = await res.json() as { components: { schemas: Record<string, unknown> } };
    const schemas = Object.keys(spec.components.schemas);
    expect(schemas).toContain("Layer");
    expect(schemas).toContain("LifecycleStatus");
    expect(schemas).toContain("RelationshipType");
    expect(schemas).toContain("Node");
    expect(schemas).toContain("Edge");
    expect(schemas).toContain("Violation");
  });

  it("health/live declares security: []", async () => {
    const res = await app.request("/api/openapi.json");
    const spec = await res.json() as {
      paths: { "/health/live": { get: { security: unknown[] } } }
    };
    expect(spec.paths["/health/live"].get.security).toEqual([]);
  });

  it("POST /v1/nodes declares tenant security requirement", async () => {
    const res = await app.request("/api/openapi.json");
    const spec = await res.json() as {
      paths: { "/v1/nodes": { post: { security: Array<Record<string, unknown>> } } }
    };
    const security = spec.paths["/v1/nodes"].post.security;
    expect(security.length).toBeGreaterThan(0);
    const req = security[0] as Record<string, unknown>;
    expect(req).toHaveProperty("TenantApiKey");
    expect(req).toHaveProperty("TenantId");
  });

  it("POST /api/admin/tenants declares admin security requirement", async () => {
    const res = await app.request("/api/openapi.json");
    const spec = await res.json() as {
      paths: { "/api/admin/tenants": { post: { security: Array<Record<string, unknown>> } } }
    };
    const security = spec.paths["/api/admin/tenants"].post.security;
    expect(security.length).toBeGreaterThan(0);
    const req = security[0] as Record<string, unknown>;
    expect(req).toHaveProperty("AdminBearer");
  });
});
