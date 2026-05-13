// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { Sql } from "./client.js";
import type { AdminOperation } from "./types.js";
import { jsonb } from "../routes/util.js";
import { logger } from "../logger.js";

export type { AdminOperation };

export async function logAdminOperation(
  sql: Sql,
  operation: AdminOperation,
  targetTenantId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await sql`
      INSERT INTO admin_audit_log (operation, target_tenant_id, payload)
      VALUES (${operation}, ${targetTenantId}, ${jsonb(sql, payload)})
    `;
  } catch (err) {
    logger.error({ err, operation, targetTenantId }, "admin audit log insert failed");
  }
}
