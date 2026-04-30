// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant } from "./test-helpers";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

beforeEach(() => {
  tid = randomUUID();
});
afterEach(async () => {
  await cleanTenant(sql, tid);
});

async function createGuardrail(body: {
  ruleKey: string;
  severity: "ERROR" | "WARN" | "INFO";
  description?: string;
  enabled?: boolean;
  config: Record<string, unknown>;
}) {
  const res = await app.request("/v1/guardrails", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({
      ruleKey: body.ruleKey,
      severity: body.severity,
      description: body.description ?? "",
      enabled: body.enabled ?? true,
      config: body.config,
    }),
  });
  if (res.status !== 201) {
    throw new Error(`createGuardrail failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()).data;
}

// ── GET /agent/v1/write-guidance/:nodeType ────────────────────────────────────

describe("GET /agent/v1/write-guidance/:nodeType", () => {
  it("returns guardrails scoped to the exact node type", async () => {
    await createGuardrail({
      ruleKey: "service.naming.kebab",
      severity: "ERROR",
      description: "Service names must be kebab-case",
      config: {
        object_type: "Service",
        condition: "name matches /^[a-z][a-z0-9-]*$/",
        rationale: "kebab-case keeps service identifiers DNS-safe and consistent across the catalog",
        remediation: "rename the service to kebab-case (lowercase, dashes between words)",
      },
    });
    await createGuardrail({
      ruleKey: "endpoint.method.uppercase",
      severity: "WARN",
      config: {
        object_type: "APIEndpoint",
        condition: "method in ['GET','POST','PUT','PATCH','DELETE']",
        rationale: "HTTP methods are uppercase by convention; lowercase methods break tooling",
        remediation: "uppercase the HTTP method",
      },
    });

    const res = await app.request("/agent/v1/write-guidance/Service", { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.nodeType).toBe("Service");
    expect(body.data.instruction).toMatch(/self_assessment/);
    expect(body.data.guardrails).toHaveLength(1);
    expect(body.data.guardrails[0]).toMatchObject({
      ruleKey: "service.naming.kebab",
      severity: "ERROR",
      condition: "name matches /^[a-z][a-z0-9-]*$/",
      rationale: expect.stringContaining("kebab-case"),
      remediation: expect.stringContaining("rename"),
    });
  });

  it("includes wildcard '*' rules alongside typed rules", async () => {
    await createGuardrail({
      ruleKey: "service.naming.kebab",
      severity: "ERROR",
      config: {
        object_type: "Service",
        condition: "name matches /^[a-z][a-z0-9-]*$/",
        rationale: "kebab-case keeps service identifiers DNS-safe",
        remediation: "rename to kebab-case",
      },
    });
    await createGuardrail({
      ruleKey: "all.naming.min_length",
      severity: "WARN",
      config: {
        object_type: "*",
        condition: "name.length >= 3",
        rationale: "single- and two-character names are ambiguous in dashboards and logs",
        remediation: "use a name with at least 3 characters",
      },
    });

    const res = await app.request("/agent/v1/write-guidance/Service", { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    const ruleKeys = body.data.guardrails.map((g: { ruleKey: string }) => g.ruleKey);
    expect(ruleKeys).toContain("service.naming.kebab");
    expect(ruleKeys).toContain("all.naming.min_length");
    expect(body.data.guardrails).toHaveLength(2);
  });

  it("omits disabled and unrelated-type rules", async () => {
    await createGuardrail({
      ruleKey: "service.disabled",
      severity: "ERROR",
      enabled: false,
      config: {
        object_type: "Service",
        condition: "always fails",
        rationale: "this rule is disabled; it must not appear in guidance",
        remediation: "n/a",
      },
    });
    await createGuardrail({
      ruleKey: "endpoint.unrelated",
      severity: "ERROR",
      config: {
        object_type: "APIEndpoint",
        condition: "wrong type",
        rationale: "applies only to APIEndpoint, not Service",
        remediation: "n/a",
      },
    });

    const res = await app.request("/agent/v1/write-guidance/Service", { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.guardrails).toEqual([]);
    expect(body.data.instruction).toMatch(/self_assessment/);
  });

  it("returns an empty guardrails list and instruction when no rules match", async () => {
    const res = await app.request("/agent/v1/write-guidance/UnknownType", { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.nodeType).toBe("UnknownType");
    expect(body.data.guardrails).toEqual([]);
    expect(body.data.instruction).toBeTypeOf("string");
    expect(body.data.instruction.length).toBeGreaterThan(0);
  });

  it("falls back to row description when config.rationale is missing", async () => {
    await createGuardrail({
      ruleKey: "service.legacy",
      severity: "INFO",
      description: "legacy fallback rationale stored on the row",
      config: { object_type: "Service" },
    });
    const res = await app.request("/agent/v1/write-guidance/Service", { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.guardrails).toHaveLength(1);
    expect(body.data.guardrails[0].rationale).toBe("legacy fallback rationale stored on the row");
    expect(body.data.guardrails[0].condition).toBe("");
    expect(body.data.guardrails[0].remediation).toBe("");
  });
});
