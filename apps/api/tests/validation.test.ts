import { describe, expect, it } from "vitest";
import {
  QueryNodesSchema,
  AgentSearchSchema,
  BatchIdsSchema,
} from "../src/routes/schemas";
import { app } from "../src/app";

// ── Schema unit tests ─────────────────────────────────────────────────────────

describe("QueryNodesSchema", () => {
  it("applies defaults for empty body", () => {
    const result = QueryNodesSchema.parse({});
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
  });

  it("accepts valid filters", () => {
    const result = QueryNodesSchema.parse({
      type: "Service",
      layer: "L4",
      lifecycleStatus: "ACTIVE",
      text: "auth",
      limit: 10,
      offset: 5,
    });
    expect(result.type).toBe("Service");
    expect(result.layer).toBe("L4");
    expect(result.limit).toBe(10);
    expect(result.offset).toBe(5);
  });

  it("rejects unknown layer value", () => {
    expect(() => QueryNodesSchema.parse({ layer: "L99" })).toThrow();
  });

  it("rejects unknown lifecycleStatus value", () => {
    expect(() => QueryNodesSchema.parse({ lifecycleStatus: "UNKNOWN" })).toThrow();
  });

  it("rejects limit above 500", () => {
    expect(() => QueryNodesSchema.parse({ limit: 501 })).toThrow();
  });

  it("rejects negative offset", () => {
    expect(() => QueryNodesSchema.parse({ offset: -1 })).toThrow();
  });

  it("rejects empty type string", () => {
    expect(() => QueryNodesSchema.parse({ type: "" })).toThrow();
  });
});

describe("AgentSearchSchema", () => {
  it("applies default limit for empty body", () => {
    const result = AgentSearchSchema.parse({});
    expect(result.limit).toBe(20);
  });

  it("accepts valid search body", () => {
    const result = AgentSearchSchema.parse({
      query: "payment",
      type: "Service",
      layer: "L3",
      lifecycleStatus: "DEPRECATED",
      limit: 5,
    });
    expect(result.query).toBe("payment");
    expect(result.limit).toBe(5);
  });

  it("rejects limit above 100", () => {
    expect(() => AgentSearchSchema.parse({ limit: 101 })).toThrow();
  });

  it("rejects unknown layer value", () => {
    expect(() => AgentSearchSchema.parse({ layer: "L0" })).toThrow();
  });

  it("rejects unknown lifecycleStatus value", () => {
    expect(() => AgentSearchSchema.parse({ lifecycleStatus: "DELETED" })).toThrow();
  });
});

describe("BatchIdsSchema", () => {
  it("accepts a list of UUIDs", () => {
    const ids = ["550e8400-e29b-41d4-a716-446655440000"];
    expect(BatchIdsSchema.parse({ ids }).ids).toEqual(ids);
  });

  it("rejects empty array", () => {
    expect(() => BatchIdsSchema.parse({ ids: [] })).toThrow();
  });

  it("rejects non-UUID strings", () => {
    expect(() => BatchIdsSchema.parse({ ids: ["not-a-uuid"] })).toThrow();
  });
});

// ── HTTP validation layer tests ───────────────────────────────────────────────
// Zod throws before any SQL call, so these work without a running database.

describe("POST /v1/query/nodes validation", () => {
  it("returns 400 for invalid layer", async () => {
    const res = await app.request("/v1/query/nodes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "test" },
      body: JSON.stringify({ layer: "INVALID" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("validation error");
  });

  it("returns 400 for limit above 500", async () => {
    const res = await app.request("/v1/query/nodes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "test" },
      body: JSON.stringify({ limit: 9999 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for negative offset", async () => {
    const res = await app.request("/v1/query/nodes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "test" },
      body: JSON.stringify({ offset: -5 }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /agent/v1/search validation", () => {
  it("returns 400 for invalid layer", async () => {
    const res = await app.request("/agent/v1/search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "test" },
      body: JSON.stringify({ layer: "L99" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("validation error");
  });

  it("returns 400 for limit above 100", async () => {
    const res = await app.request("/agent/v1/search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "test" },
      body: JSON.stringify({ limit: 200 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid lifecycleStatus", async () => {
    const res = await app.request("/agent/v1/search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "test" },
      body: JSON.stringify({ lifecycleStatus: "GONE" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /agent/v1/nodes/batch validation", () => {
  it("returns 400 for non-UUID ids", async () => {
    const res = await app.request("/agent/v1/nodes/batch", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "test" },
      body: JSON.stringify({ ids: ["not-a-uuid"] }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty ids array", async () => {
    const res = await app.request("/agent/v1/nodes/batch", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "test" },
      body: JSON.stringify({ ids: [] }),
    });
    expect(res.status).toBe(400);
  });
});
