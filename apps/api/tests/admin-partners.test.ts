// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Integration tests for GET and POST /api/admin/partners.
// All DB assertions hit real Postgres — no database mocks (ADR A6).

import { describe, it, expect, afterEach, vi } from "vitest";
import { app } from "../src/app.js";
import { sql } from "../src/db/client.js";
import { cleanTenant } from "./test-helpers.js";
import { rateLimitWindows } from "../src/middleware/admin-auth.js";

const TEST_SECRET = "test-admin-secret";

function adminHeaders(ip?: string): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${TEST_SECRET}`,
  };
  if (ip) h["x-forwarded-for"] = ip;
  return h;
}

function uniqueSlug(): string {
  return `partner-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function uniqueName(): string {
  return `Test Partner ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const createdTenantIds: string[] = [];

/** Helper: create a partner tenant via the admin tenants API and track it for cleanup. */
async function createPartner(name: string): Promise<{ id: string }> {
  const res = await app.request("/api/admin/tenants", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ name, slug: uniqueSlug(), plan: "partner" }),
  });
  expect(res.status).toBe(201);
  const { data } = (await res.json()) as { data: { tenant: { id: string } } };
  createdTenantIds.push(data.tenant.id);
  return { id: data.tenant.id };
}

afterEach(async () => {
  for (const tid of createdTenantIds.splice(0)) {
    await cleanTenant(sql, tid);
  }
  vi.unstubAllEnvs();
  rateLimitWindows.clear();
});

// ── GET — Auth guard ──────────────────────────────────────────────────────────

describe("GET /api/admin/partners — auth", () => {
  it("returns 401 when LSDS_ADMIN_SECRET is not configured", async () => {
    vi.stubEnv("LSDS_ADMIN_SECRET", "");
    const res = await app.request("/api/admin/partners", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid Bearer token", async () => {
    const res = await app.request("/api/admin/partners", {
      headers: { authorization: "Bearer wrong-token-value" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await app.request("/api/admin/partners");
    expect(res.status).toBe(401);
  });
});

// ── GET — Happy path ──────────────────────────────────────────────────────────

describe("GET /api/admin/partners — happy path", () => {
  it("returns 200 with correct response shape", async () => {
    const { id } = await createPartner("Shape Corp");

    const res = await app.request("/api/admin/partners", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      partners: Array<{
        tenantId: string;
        name: string;
        status: string | null;
        createdAt: string;
        lastActiveAt: string | null;
        nodeCount: number;
      }>;
      nextCursor: string | null;
      total: number;
    };

    expect(Array.isArray(body.partners)).toBe(true);
    expect(typeof body.total).toBe("number");
    expect(body.nextCursor === null || typeof body.nextCursor === "string").toBe(true);

    const partner = body.partners.find((p) => p.tenantId === id);
    expect(partner).toBeDefined();
    expect(partner!.name).toBe("Shape Corp");
    expect(partner!.status).toBe("active");
    expect(typeof partner!.nodeCount).toBe("number");
    expect(partner!.nodeCount).toBe(0);
    expect(partner!.lastActiveAt).toBeNull();
  });

  it("does not include non-partner tenants (plan=trial)", async () => {
    const trialRes = await app.request("/api/admin/tenants", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ name: "Trial Corp", slug: uniqueSlug(), plan: "trial" }),
    });
    expect(trialRes.status).toBe(201);
    const { data: trial } = (await trialRes.json()) as { data: { tenant: { id: string } } };
    createdTenantIds.push(trial.tenant.id);

    const { id: partnerId } = await createPartner("Partner Corp");

    const res = await app.request("/api/admin/partners", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const { partners } = (await res.json()) as { partners: Array<{ tenantId: string }> };

    expect(partners.some((p) => p.tenantId === trial.tenant.id)).toBe(false);
    expect(partners.some((p) => p.tenantId === partnerId)).toBe(true);
  });

  it("new partner tenant has status=active", async () => {
    const { id } = await createPartner("Active Partner");

    const [row] = await sql<[{ partnerStatus: string }?]>`
      SELECT partner_status FROM tenants WHERE id = ${id}
    `;
    expect(row?.partnerStatus).toBe("active");
  });
});

// ── GET — Status filter ───────────────────────────────────────────────────────

describe("GET /api/admin/partners — status filter", () => {
  it("returns only active partners when status=active", async () => {
    const { id: activeId } = await createPartner("Active Partner A");
    const { id: churnedId } = await createPartner("Churned Partner B");

    await sql`UPDATE tenants SET partner_status = 'churned' WHERE id = ${churnedId}`;

    const res = await app.request("/api/admin/partners?status=active", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const { partners } = (await res.json()) as { partners: Array<{ tenantId: string }> };

    expect(partners.some((p) => p.tenantId === activeId)).toBe(true);
    expect(partners.some((p) => p.tenantId === churnedId)).toBe(false);
  });

  it("returns only churned partners when status=churned", async () => {
    const { id: activeId } = await createPartner("Active Partner C");
    const { id: churnedId } = await createPartner("Churned Partner D");

    await sql`UPDATE tenants SET partner_status = 'churned' WHERE id = ${churnedId}`;

    const res = await app.request("/api/admin/partners?status=churned", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const { partners } = (await res.json()) as { partners: Array<{ tenantId: string }> };

    expect(partners.some((p) => p.tenantId === churnedId)).toBe(true);
    expect(partners.some((p) => p.tenantId === activeId)).toBe(false);
  });

  it("returns only paused partners when status=paused", async () => {
    const { id: pausedId } = await createPartner("Paused Partner E");
    const { id: activeId } = await createPartner("Active Partner F");

    await sql`UPDATE tenants SET partner_status = 'paused' WHERE id = ${pausedId}`;

    const res = await app.request("/api/admin/partners?status=paused", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const { partners } = (await res.json()) as { partners: Array<{ tenantId: string }> };

    expect(partners.some((p) => p.tenantId === pausedId)).toBe(true);
    expect(partners.some((p) => p.tenantId === activeId)).toBe(false);
  });

  it("returns 400 for an invalid status value", async () => {
    const res = await app.request("/api/admin/partners?status=invalid", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(400);
  });

  it("total reflects filtered count (not all partners)", async () => {
    const { id: aId } = await createPartner("Total A");
    const { id: bId } = await createPartner("Total B");

    await sql`UPDATE tenants SET partner_status = 'churned' WHERE id = ${bId}`;

    const activeRes = await app.request("/api/admin/partners?status=active", {
      headers: adminHeaders(),
    });
    const { total: activeTotal } = (await activeRes.json()) as { total: number };

    const churnedRes = await app.request("/api/admin/partners?status=churned", {
      headers: adminHeaders(),
    });
    const { total: churnedTotal } = (await churnedRes.json()) as { total: number };

    expect(activeTotal).toBeGreaterThanOrEqual(1);
    expect(churnedTotal).toBeGreaterThanOrEqual(1);

    const allRes = await app.request("/api/admin/partners", {
      headers: adminHeaders(),
    });
    const { total: allTotal } = (await allRes.json()) as { total: number };
    expect(allTotal).toBeGreaterThanOrEqual(activeTotal);
    expect(allTotal).toBeGreaterThanOrEqual(churnedTotal);

    void aId;
  });
});

// ── GET — Cursor pagination ───────────────────────────────────────────────────

describe("GET /api/admin/partners — pagination", () => {
  it("paginates with limit and nextCursor", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { id } = await createPartner(`Paginate Partner ${i}`);
      ids.push(id);
    }

    const page1Res = await app.request("/api/admin/partners?limit=2", {
      headers: adminHeaders(),
    });
    expect(page1Res.status).toBe(200);
    const page1 = (await page1Res.json()) as {
      partners: Array<{ tenantId: string }>;
      nextCursor: string | null;
      total: number;
    };

    expect(page1.partners.length).toBe(2);
    expect(page1.total).toBeGreaterThanOrEqual(3);

    if (page1.nextCursor !== null) {
      const page2Res = await app.request(
        `/api/admin/partners?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`,
        { headers: adminHeaders() }
      );
      expect(page2Res.status).toBe(200);
      const page2 = (await page2Res.json()) as {
        partners: Array<{ tenantId: string }>;
        nextCursor: string | null;
      };
      expect(Array.isArray(page2.partners)).toBe(true);
      const page1Ids = new Set(page1.partners.map((p) => p.tenantId));
      for (const p of page2.partners) {
        expect(page1Ids.has(p.tenantId)).toBe(false);
      }
    }
  });

  it("returns null nextCursor when results fit within limit", async () => {
    await createPartner("Solo Partner");

    const res = await app.request("/api/admin/partners?limit=100", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { partners: unknown[]; nextCursor: string | null };
    if (body.partners.length < 100) {
      expect(body.nextCursor).toBeNull();
    }
  });

  it("limit defaults to 20 when not provided", async () => {
    const res = await app.request("/api/admin/partners", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const { partners } = (await res.json()) as { partners: unknown[] };
    expect(partners.length).toBeLessThanOrEqual(20);
  });

  it("limit is capped at 100", async () => {
    const res = await app.request("/api/admin/partners?limit=9999", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const { partners } = (await res.json()) as { partners: unknown[] };
    expect(partners.length).toBeLessThanOrEqual(100);
  });

  it("partners are ordered by createdAt DESC", async () => {
    const { id: first } = await createPartner("Order First");
    await new Promise((r) => setTimeout(r, 10));
    const { id: second } = await createPartner("Order Second");

    const res = await app.request("/api/admin/partners?limit=100", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const { partners } = (await res.json()) as {
      partners: Array<{ tenantId: string; createdAt: string }>;
    };

    const firstIdx = partners.findIndex((p) => p.tenantId === first);
    const secondIdx = partners.findIndex((p) => p.tenantId === second);
    expect(firstIdx).toBeGreaterThan(secondIdx);
  });
});

// ── GET — nodeCount ───────────────────────────────────────────────────────────

describe("GET /api/admin/partners — nodeCount", () => {
  it("nodeCount reflects current node count for the tenant", async () => {
    const { id } = await createPartner("Node Count Partner");

    await sql`
      INSERT INTO nodes (tenant_id, type, layer, name)
      VALUES
        (${id}, 'Service', 'L3', 'node-a'),
        (${id}, 'Service', 'L3', 'node-b')
    `;

    const res = await app.request("/api/admin/partners", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const { partners } = (await res.json()) as {
      partners: Array<{ tenantId: string; nodeCount: number }>;
    };
    const partner = partners.find((p) => p.tenantId === id);
    expect(partner?.nodeCount).toBe(2);
  });
});

// ── POST — Happy path & auth ──────────────────────────────────────────────────

describe("POST /api/admin/partners", () => {
  it("creates partner tenant and returns 201 with plaintext apiKey", async () => {
    const name = uniqueName();
    const res = await app.request("/api/admin/partners", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ name, contactEmail: "admin@acme.com", tier: "design_partner" }),
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      tenantId: string;
      name: string;
      apiKey: string;
      createdAt: string;
    };
    expect(body.tenantId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.name).toBe(name);
    expect(body.apiKey).toMatch(/^lsds_[0-9a-f]{32}$/);
    expect(body.createdAt).toBeDefined();
    createdTenantIds.push(body.tenantId);

    const [row] = await sql<[{ plan: string }?]>`
      SELECT plan FROM tenants WHERE id = ${body.tenantId}
    `;
    expect(row?.plan).toBe("partner");
  });

  it("plaintext apiKey authenticates against the API", async () => {
    const res = await app.request("/api/admin/partners", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ name: uniqueName(), contactEmail: "test@example.com", tier: "design_partner" }),
    });
    expect(res.status).toBe(201);
    const { tenantId, apiKey } = (await res.json()) as { tenantId: string; apiKey: string };
    createdTenantIds.push(tenantId);

    const authed = await app.request("/v1/nodes", {
      headers: { "x-api-key": apiKey },
    });
    expect(authed.status).not.toBe(403);
  });

  it("returns 409 on duplicate name with existing tenantId", async () => {
    const name = uniqueName();
    const first = await app.request("/api/admin/partners", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ name, contactEmail: "first@example.com", tier: "design_partner" }),
    });
    expect(first.status).toBe(201);
    const { tenantId } = (await first.json()) as { tenantId: string };
    createdTenantIds.push(tenantId);

    const second = await app.request("/api/admin/partners", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ name, contactEmail: "second@example.com", tier: "design_partner" }),
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string; tenantId: string };
    expect(body.tenantId).toBe(tenantId);
  });

  it("returns 401 when LSDS_ADMIN_SECRET is not configured", async () => {
    vi.stubEnv("LSDS_ADMIN_SECRET", "");
    const res = await app.request("/api/admin/partners", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ name: uniqueName(), contactEmail: "x@x.com", tier: "design_partner" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 for invalid Bearer token", async () => {
    const res = await app.request("/api/admin/partners", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer wrong-token-value",
      },
      body: JSON.stringify({ name: uniqueName(), contactEmail: "x@x.com", tier: "design_partner" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when contactEmail is invalid", async () => {
    const res = await app.request("/api/admin/partners", {
      method: "POST",
      headers: adminHeaders(`10.1.${Math.floor(Math.random() * 256)}.1`),
      body: JSON.stringify({ name: uniqueName(), contactEmail: "not-an-email", tier: "design_partner" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: Array<{ path: string[] }> };
    expect(body.error).toBe("validation error");
    expect(body.issues.some((i) => i.path.includes("contactEmail"))).toBe(true);
  });

  it("returns 400 when tier is not design_partner", async () => {
    const res = await app.request("/api/admin/partners", {
      method: "POST",
      headers: adminHeaders(`10.2.${Math.floor(Math.random() * 256)}.1`),
      body: JSON.stringify({ name: uniqueName(), contactEmail: "ok@example.com", tier: "trial" }),
    });
    expect(res.status).toBe(400);
  });

  it("creates audit log entry with operation=partner.create", async () => {
    const name = uniqueName();
    const res = await app.request("/api/admin/partners", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ name, contactEmail: "audit@example.com", tier: "design_partner" }),
    });
    expect(res.status).toBe(201);
    const { tenantId } = (await res.json()) as { tenantId: string };
    createdTenantIds.push(tenantId);

    const [entry] = await sql<[{ operation: string }?]>`
      SELECT operation FROM admin_audit_log
      WHERE target_tenant_id = ${tenantId} AND operation = 'partner.create'
    `;
    expect(entry).toBeDefined();
    expect(entry!.operation).toBe("partner.create");
  });
});
