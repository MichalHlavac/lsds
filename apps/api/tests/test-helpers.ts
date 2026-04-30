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
  // edges cascade from nodes — deleting nodes deletes edges automatically
  await sql`DELETE FROM nodes WHERE tenant_id = ${tid}`;
  // team_members cascade from both teams and users
  await sql`DELETE FROM team_members WHERE team_id IN (SELECT id FROM teams WHERE tenant_id = ${tid})`;
  await sql`DELETE FROM users WHERE tenant_id = ${tid}`;
  await sql`DELETE FROM teams WHERE tenant_id = ${tid}`;
  await sql`DELETE FROM guardrails WHERE tenant_id = ${tid}`;
}
