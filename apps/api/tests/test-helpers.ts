// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { Sql } from "../src/db/client";

// Fixed UUIDs used in Zod schema unit tests (schemas.test.ts)
export const ID1 = "00000000-0000-0000-0000-000000000001";
export const ID2 = "00000000-0000-0000-0000-000000000002";

/** Delete all rows belonging to a test tenant in dependency order. */
export async function cleanTenant(sql: Sql, tid: string): Promise<void> {
  // violations reference nodes/edges but use SET NULL — delete first to avoid dangling refs
  await sql`DELETE FROM violations WHERE tenant_id = ${tid}`;
  await sql`DELETE FROM stale_flags WHERE tenant_id = ${tid}`;
  // edges cascade from nodes — deleting nodes deletes edges automatically
  await sql`DELETE FROM nodes WHERE tenant_id = ${tid}`;
  // team_members cascade from both teams and users
  await sql`DELETE FROM team_members WHERE team_id IN (SELECT id FROM teams WHERE tenant_id = ${tid})`;
  await sql`DELETE FROM users WHERE tenant_id = ${tid}`;
  await sql`DELETE FROM teams WHERE tenant_id = ${tid}`;
  await sql`DELETE FROM guardrails WHERE tenant_id = ${tid}`;
  await sql`DELETE FROM snapshots WHERE tenant_id = ${tid}`;
  await sql`DELETE FROM migration_drafts WHERE tenant_id = ${tid}`;
  await sql`DELETE FROM feedback WHERE tenant_id = ${tid}`;
  await sql`DELETE FROM api_keys WHERE tenant_id = ${tid}`;
  await sql`DELETE FROM webhook_deliveries WHERE tenant_id = ${tid}`;
  await sql`DELETE FROM webhooks WHERE tenant_id = ${tid}`;
  await sql`DELETE FROM audit_log WHERE tenant_id = ${tid}`;
  await sql`DELETE FROM admin_audit_log WHERE target_tenant_id = ${tid}`;
  // tenant row last — stale_flags has FK to tenants; other tables do not
  await sql`DELETE FROM tenants WHERE id = ${tid}`;
}

/** Seed a minimal tenant row needed by tables that FK to tenants (e.g. stale_flags). */
export async function createTestTenant(sql: Sql, id: string, name = "test-tenant"): Promise<void> {
  await sql`INSERT INTO tenants (id, name) VALUES (${id}, ${name}) ON CONFLICT DO NOTHING`;
}
