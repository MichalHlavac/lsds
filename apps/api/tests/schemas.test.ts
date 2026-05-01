// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  CreateNodeSchema,
  UpdateNodeSchema,
  CreateEdgeSchema,
  UpdateEdgeSchema,
  CreateViolationSchema,
  TraverseSchema,
  CreateGuardrailSchema,
  UpdateGuardrailSchema,
  CreateUserSchema,
  CreateTeamSchema,
} from "../src/routes/schemas";
import { app } from "../src/app";

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const UUID2 = "550e8400-e29b-41d4-a716-446655440001";

// ── CreateNodeSchema ──────────────────────────────────────────────────────────

describe("CreateNodeSchema", () => {
  const valid = { type: "Service", layer: "L1", name: "auth-service" };

  it("parses a minimal valid node", () => {
    const r = CreateNodeSchema.parse(valid);
    expect(r.type).toBe("Service");
    expect(r.layer).toBe("L1");
    expect(r.name).toBe("auth-service");
  });

  it("applies default version '0.1.0'", () => {
    expect(CreateNodeSchema.parse(valid).version).toBe("0.1.0");
  });

  it("applies default lifecycleStatus 'ACTIVE'", () => {
    expect(CreateNodeSchema.parse(valid).lifecycleStatus).toBe("ACTIVE");
  });

  it("applies default empty attributes", () => {
    expect(CreateNodeSchema.parse(valid).attributes).toEqual({});
  });

  it("accepts all layer values L1–L6", () => {
    for (const layer of ["L1", "L2", "L3", "L4", "L5", "L6"]) {
      expect(() => CreateNodeSchema.parse({ ...valid, layer })).not.toThrow();
    }
  });

  it("rejects invalid layer", () => {
    expect(() => CreateNodeSchema.parse({ ...valid, layer: "L0" })).toThrow();
  });

  it("rejects empty type", () => {
    expect(() => CreateNodeSchema.parse({ ...valid, type: "" })).toThrow();
  });

  it("rejects empty name", () => {
    expect(() => CreateNodeSchema.parse({ ...valid, name: "" })).toThrow();
  });

  it("accepts DEPRECATED lifecycleStatus", () => {
    const r = CreateNodeSchema.parse({ ...valid, lifecycleStatus: "DEPRECATED" });
    expect(r.lifecycleStatus).toBe("DEPRECATED");
  });

  it("rejects unknown lifecycleStatus", () => {
    expect(() => CreateNodeSchema.parse({ ...valid, lifecycleStatus: "GONE" })).toThrow();
  });

  it("accepts custom attributes", () => {
    const r = CreateNodeSchema.parse({ ...valid, attributes: { owner: "team-a" } });
    expect(r.attributes).toEqual({ owner: "team-a" });
  });
});

// ── UpdateNodeSchema ──────────────────────────────────────────────────────────

describe("UpdateNodeSchema", () => {
  it("parses empty object (all fields optional)", () => {
    expect(() => UpdateNodeSchema.parse({})).not.toThrow();
  });

  it("accepts partial update with only name", () => {
    const r = UpdateNodeSchema.parse({ name: "new-name" });
    expect(r.name).toBe("new-name");
    expect(r.lifecycleStatus).toBeUndefined();
  });

  it("rejects empty name string", () => {
    expect(() => UpdateNodeSchema.parse({ name: "" })).toThrow();
  });

  it("rejects invalid lifecycleStatus", () => {
    expect(() => UpdateNodeSchema.parse({ lifecycleStatus: "INVALID" })).toThrow();
  });

  it("accepts all valid lifecycleStatus values", () => {
    for (const lifecycleStatus of ["ACTIVE", "DEPRECATED", "ARCHIVED", "PURGE"]) {
      expect(() => UpdateNodeSchema.parse({ lifecycleStatus })).not.toThrow();
    }
  });
});

// ── CreateEdgeSchema ──────────────────────────────────────────────────────────

describe("CreateEdgeSchema", () => {
  const valid = { sourceId: UUID, targetId: UUID2, type: "DEPENDS_ON", layer: "L3" };

  it("parses valid edge", () => {
    const r = CreateEdgeSchema.parse(valid);
    expect(r.sourceId).toBe(UUID);
    expect(r.targetId).toBe(UUID2);
    expect(r.type).toBe("DEPENDS_ON");
  });

  it("applies default traversalWeight of 1.0", () => {
    expect(CreateEdgeSchema.parse(valid).traversalWeight).toBe(1.0);
  });

  it("applies default empty attributes", () => {
    expect(CreateEdgeSchema.parse(valid).attributes).toEqual({});
  });

  it("rejects non-UUID sourceId", () => {
    expect(() => CreateEdgeSchema.parse({ ...valid, sourceId: "not-uuid" })).toThrow();
  });

  it("rejects non-UUID targetId", () => {
    expect(() => CreateEdgeSchema.parse({ ...valid, targetId: "not-uuid" })).toThrow();
  });

  it("rejects empty type", () => {
    expect(() => CreateEdgeSchema.parse({ ...valid, type: "" })).toThrow();
  });

  it("rejects zero traversalWeight", () => {
    expect(() => CreateEdgeSchema.parse({ ...valid, traversalWeight: 0 })).toThrow();
  });

  it("rejects negative traversalWeight", () => {
    expect(() => CreateEdgeSchema.parse({ ...valid, traversalWeight: -1 })).toThrow();
  });

  it("accepts positive non-integer traversalWeight", () => {
    const r = CreateEdgeSchema.parse({ ...valid, traversalWeight: 2.5 });
    expect(r.traversalWeight).toBe(2.5);
  });

  it("rejects invalid layer", () => {
    expect(() => CreateEdgeSchema.parse({ ...valid, layer: "L7" })).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => CreateEdgeSchema.parse({})).toThrow();
  });
});

// ── UpdateEdgeSchema ──────────────────────────────────────────────────────────

describe("UpdateEdgeSchema", () => {
  it("parses empty object (all fields optional)", () => {
    expect(() => UpdateEdgeSchema.parse({})).not.toThrow();
  });

  it("accepts traversalWeight update", () => {
    const r = UpdateEdgeSchema.parse({ traversalWeight: 2.5 });
    expect(r.traversalWeight).toBe(2.5);
  });

  it("rejects empty type string", () => {
    expect(() => UpdateEdgeSchema.parse({ type: "" })).toThrow();
  });

  it("rejects non-positive traversalWeight", () => {
    expect(() => UpdateEdgeSchema.parse({ traversalWeight: -0.5 })).toThrow();
  });
});

// ── CreateViolationSchema ─────────────────────────────────────────────────────

describe("CreateViolationSchema", () => {
  const valid = { ruleKey: "naming.node.min_length", severity: "WARN", message: "too short" };

  it("parses valid violation without node/edge id", () => {
    const r = CreateViolationSchema.parse(valid);
    expect(r.ruleKey).toBe("naming.node.min_length");
    expect(r.severity).toBe("WARN");
    expect(r.nodeId).toBeUndefined();
    expect(r.edgeId).toBeUndefined();
  });

  it("accepts nodeId as valid UUID", () => {
    const r = CreateViolationSchema.parse({ ...valid, nodeId: UUID });
    expect(r.nodeId).toBe(UUID);
  });

  it("accepts edgeId as valid UUID", () => {
    const r = CreateViolationSchema.parse({ ...valid, edgeId: UUID });
    expect(r.edgeId).toBe(UUID);
  });

  it("rejects non-UUID nodeId", () => {
    expect(() => CreateViolationSchema.parse({ ...valid, nodeId: "not-uuid" })).toThrow();
  });

  it("rejects non-UUID edgeId", () => {
    expect(() => CreateViolationSchema.parse({ ...valid, edgeId: "bad-id" })).toThrow();
  });

  it("rejects invalid severity", () => {
    expect(() => CreateViolationSchema.parse({ ...valid, severity: "CRITICAL" })).toThrow();
  });

  it("accepts all severity values", () => {
    for (const severity of ["ERROR", "WARN", "INFO"]) {
      expect(() => CreateViolationSchema.parse({ ...valid, severity })).not.toThrow();
    }
  });

  it("coerces lowercase severity to uppercase", () => {
    expect(CreateViolationSchema.parse({ ...valid, severity: "error" }).severity).toBe("ERROR");
    expect(CreateViolationSchema.parse({ ...valid, severity: "warn" }).severity).toBe("WARN");
    expect(CreateViolationSchema.parse({ ...valid, severity: "info" }).severity).toBe("INFO");
  });

  it("coerces mixed-case severity to uppercase", () => {
    expect(CreateViolationSchema.parse({ ...valid, severity: "Error" }).severity).toBe("ERROR");
    expect(CreateViolationSchema.parse({ ...valid, severity: "Warn" }).severity).toBe("WARN");
  });

  it("rejects empty ruleKey", () => {
    expect(() => CreateViolationSchema.parse({ ...valid, ruleKey: "" })).toThrow();
  });

  it("rejects empty message", () => {
    expect(() => CreateViolationSchema.parse({ ...valid, message: "" })).toThrow();
  });

  it("applies default empty attributes", () => {
    expect(CreateViolationSchema.parse(valid).attributes).toEqual({});
  });

  it("accepts sourceNodeId and targetNodeId as valid UUIDs", () => {
    const r = CreateViolationSchema.parse({
      ...valid,
      edgeId: UUID,
      sourceNodeId: UUID,
      targetNodeId: UUID2,
    });
    expect(r.sourceNodeId).toBe(UUID);
    expect(r.targetNodeId).toBe(UUID2);
  });

  it("rejects non-UUID sourceNodeId", () => {
    expect(() =>
      CreateViolationSchema.parse({ ...valid, sourceNodeId: "bad" }),
    ).toThrow();
  });

  it("rejects non-UUID targetNodeId", () => {
    expect(() =>
      CreateViolationSchema.parse({ ...valid, targetNodeId: "bad" }),
    ).toThrow();
  });
});

// ── TraverseSchema ────────────────────────────────────────────────────────────

describe("TraverseSchema", () => {
  it("applies default depth of 3", () => {
    expect(TraverseSchema.parse({}).depth).toBe(3);
  });

  it("applies default direction 'both'", () => {
    expect(TraverseSchema.parse({}).direction).toBe("both");
  });

  it("accepts valid depth and direction", () => {
    const r = TraverseSchema.parse({ depth: 5, direction: "inbound" });
    expect(r.depth).toBe(5);
    expect(r.direction).toBe("inbound");
  });

  it("rejects depth below 1", () => {
    expect(() => TraverseSchema.parse({ depth: 0 })).toThrow();
  });

  it("rejects depth above 20", () => {
    expect(() => TraverseSchema.parse({ depth: 21 })).toThrow();
  });

  it("accepts boundary depths 1 and 20", () => {
    expect(() => TraverseSchema.parse({ depth: 1 })).not.toThrow();
    expect(() => TraverseSchema.parse({ depth: 20 })).not.toThrow();
  });

  it("rejects invalid direction", () => {
    expect(() => TraverseSchema.parse({ direction: "sideways" })).toThrow();
  });

  it("accepts all valid directions", () => {
    for (const direction of ["outbound", "inbound", "both"]) {
      expect(() => TraverseSchema.parse({ direction })).not.toThrow();
    }
  });

  it("accepts edgeTypes array", () => {
    const r = TraverseSchema.parse({ edgeTypes: ["DEPENDS_ON", "CALLS"] });
    expect(r.edgeTypes).toEqual(["DEPENDS_ON", "CALLS"]);
  });

  it("rejects non-integer depth", () => {
    expect(() => TraverseSchema.parse({ depth: 2.5 })).toThrow();
  });
});

// ── CreateGuardrailSchema ─────────────────────────────────────────────────────

describe("CreateGuardrailSchema", () => {
  const valid = { ruleKey: "naming.node.min_length", severity: "WARN" };

  it("parses minimal valid guardrail", () => {
    const r = CreateGuardrailSchema.parse(valid);
    expect(r.ruleKey).toBe("naming.node.min_length");
    expect(r.severity).toBe("WARN");
  });

  it("applies default description of empty string", () => {
    expect(CreateGuardrailSchema.parse(valid).description).toBe("");
  });

  it("applies default enabled=true", () => {
    expect(CreateGuardrailSchema.parse(valid).enabled).toBe(true);
  });

  it("applies default empty config", () => {
    expect(CreateGuardrailSchema.parse(valid).config).toEqual({});
  });

  it("accepts config with values", () => {
    const r = CreateGuardrailSchema.parse({ ...valid, config: { min: 5 } });
    expect(r.config).toEqual({ min: 5 });
  });

  it("accepts enabled=false", () => {
    expect(CreateGuardrailSchema.parse({ ...valid, enabled: false }).enabled).toBe(false);
  });

  it("rejects empty ruleKey", () => {
    expect(() => CreateGuardrailSchema.parse({ ...valid, ruleKey: "" })).toThrow();
  });

  it("rejects invalid severity", () => {
    expect(() => CreateGuardrailSchema.parse({ ...valid, severity: "FATAL" })).toThrow();
  });

  it("accepts all severity values", () => {
    for (const severity of ["ERROR", "WARN", "INFO"]) {
      expect(() => CreateGuardrailSchema.parse({ ...valid, severity })).not.toThrow();
    }
  });

  it("coerces lowercase severity to uppercase", () => {
    expect(CreateGuardrailSchema.parse({ ...valid, severity: "error" }).severity).toBe("ERROR");
    expect(CreateGuardrailSchema.parse({ ...valid, severity: "warn" }).severity).toBe("WARN");
    expect(CreateGuardrailSchema.parse({ ...valid, severity: "info" }).severity).toBe("INFO");
  });

  it("coerces mixed-case severity to uppercase", () => {
    expect(CreateGuardrailSchema.parse({ ...valid, severity: "Error" }).severity).toBe("ERROR");
    expect(CreateGuardrailSchema.parse({ ...valid, severity: "Warn" }).severity).toBe("WARN");
  });
});

// ── UpdateGuardrailSchema ─────────────────────────────────────────────────────

describe("UpdateGuardrailSchema", () => {
  it("parses empty object (all fields optional)", () => {
    expect(() => UpdateGuardrailSchema.parse({})).not.toThrow();
  });

  it("accepts enabled=false", () => {
    const r = UpdateGuardrailSchema.parse({ enabled: false });
    expect(r.enabled).toBe(false);
  });

  it("accepts description update", () => {
    const r = UpdateGuardrailSchema.parse({ description: "updated" });
    expect(r.description).toBe("updated");
  });

  it("rejects invalid severity", () => {
    expect(() => UpdateGuardrailSchema.parse({ severity: "DEBUG" })).toThrow();
  });

  it("coerces lowercase severity to uppercase", () => {
    expect(UpdateGuardrailSchema.parse({ severity: "error" }).severity).toBe("ERROR");
    expect(UpdateGuardrailSchema.parse({ severity: "warn" }).severity).toBe("WARN");
    expect(UpdateGuardrailSchema.parse({ severity: "info" }).severity).toBe("INFO");
  });
});

// ── CreateUserSchema ──────────────────────────────────────────────────────────

describe("CreateUserSchema", () => {
  const valid = { externalId: "ext-123", displayName: "Alice" };

  it("parses minimal valid user", () => {
    const r = CreateUserSchema.parse(valid);
    expect(r.externalId).toBe("ext-123");
    expect(r.displayName).toBe("Alice");
  });

  it("applies default role 'viewer'", () => {
    expect(CreateUserSchema.parse(valid).role).toBe("viewer");
  });

  it("applies default empty attributes", () => {
    expect(CreateUserSchema.parse(valid).attributes).toEqual({});
  });

  it("accepts valid email", () => {
    const r = CreateUserSchema.parse({ ...valid, email: "alice@example.com" });
    expect(r.email).toBe("alice@example.com");
  });

  it("rejects invalid email format", () => {
    expect(() => CreateUserSchema.parse({ ...valid, email: "not-an-email" })).toThrow();
  });

  it("accepts all valid roles", () => {
    for (const role of ["admin", "editor", "viewer"]) {
      expect(() => CreateUserSchema.parse({ ...valid, role })).not.toThrow();
    }
  });

  it("rejects invalid role", () => {
    expect(() => CreateUserSchema.parse({ ...valid, role: "superadmin" })).toThrow();
  });

  it("rejects empty externalId", () => {
    expect(() => CreateUserSchema.parse({ ...valid, externalId: "" })).toThrow();
  });

  it("rejects empty displayName", () => {
    expect(() => CreateUserSchema.parse({ ...valid, displayName: "" })).toThrow();
  });
});

// ── CreateTeamSchema ──────────────────────────────────────────────────────────

describe("CreateTeamSchema", () => {
  it("parses minimal valid team", () => {
    const r = CreateTeamSchema.parse({ name: "platform" });
    expect(r.name).toBe("platform");
  });

  it("applies default empty attributes", () => {
    expect(CreateTeamSchema.parse({ name: "infra" }).attributes).toEqual({});
  });

  it("accepts attributes object", () => {
    const r = CreateTeamSchema.parse({ name: "security", attributes: { tier: 1 } });
    expect(r.attributes).toEqual({ tier: 1 });
  });

  it("rejects empty name", () => {
    expect(() => CreateTeamSchema.parse({ name: "" })).toThrow();
  });
});

// ── HTTP: x-tenant-id header requirement ─────────────────────────────────────

describe("x-tenant-id header requirement", () => {
  const cases: Array<{ method: string; path: string }> = [
    { method: "GET", path: "/v1/nodes" },
    { method: "GET", path: "/v1/edges" },
    { method: "GET", path: "/v1/violations" },
    { method: "GET", path: "/v1/guardrails" },
    { method: "GET", path: "/v1/users" },
    { method: "GET", path: "/v1/teams" },
  ];

  for (const { method, path } of cases) {
    it(`${method} ${path} returns 400 without x-tenant-id`, async () => {
      const res = await app.request(path, { method });
      expect(res.status).toBe(400);
    });
  }
});

// ── HTTP: CreateNode validation ───────────────────────────────────────────────

describe("POST /v1/nodes schema validation", () => {
  it("returns 400 for missing required fields", async () => {
    const res = await app.request("/v1/nodes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "t1" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid layer", async () => {
    const res = await app.request("/v1/nodes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "t1" },
      body: JSON.stringify({ type: "Svc", layer: "L0", name: "svc" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty type", async () => {
    const res = await app.request("/v1/nodes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "t1" },
      body: JSON.stringify({ type: "", layer: "L1", name: "svc" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid lifecycleStatus", async () => {
    const res = await app.request("/v1/nodes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "t1" },
      body: JSON.stringify({ type: "Svc", layer: "L1", name: "svc", lifecycleStatus: "GONE" }),
    });
    expect(res.status).toBe(400);
  });

  it("error body contains 'validation error'", async () => {
    const res = await app.request("/v1/nodes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "t1" },
      body: JSON.stringify({ layer: "INVALID" }),
    });
    const body = await res.json();
    expect(body.error).toBe("validation error");
  });
});

// ── HTTP: CreateEdge validation ───────────────────────────────────────────────

describe("POST /v1/edges schema validation", () => {
  it("returns 400 for non-UUID sourceId", async () => {
    const res = await app.request("/v1/edges", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "t1" },
      body: JSON.stringify({ sourceId: "bad", targetId: UUID2, type: "CALLS", layer: "L2" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing required fields", async () => {
    const res = await app.request("/v1/edges", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "t1" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-positive traversalWeight", async () => {
    const res = await app.request("/v1/edges", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "t1" },
      body: JSON.stringify({ sourceId: UUID, targetId: UUID2, type: "CALLS", layer: "L2", traversalWeight: 0 }),
    });
    expect(res.status).toBe(400);
  });
});

// ── HTTP: CreateViolation validation ─────────────────────────────────────────

describe("POST /v1/violations schema validation", () => {
  it("returns 400 for missing ruleKey", async () => {
    const res = await app.request("/v1/violations", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "t1" },
      body: JSON.stringify({ severity: "WARN", message: "oops" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid severity", async () => {
    const res = await app.request("/v1/violations", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "t1" },
      body: JSON.stringify({ ruleKey: "x", severity: "CRITICAL", message: "oops" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-UUID nodeId", async () => {
    const res = await app.request("/v1/violations", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "t1" },
      body: JSON.stringify({ ruleKey: "x", severity: "WARN", message: "m", nodeId: "bad" }),
    });
    expect(res.status).toBe(400);
  });
});
