// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { Sql } from "../db/client.js";
import type { AuditDiff, AuditOperation } from "../db/types.js";
import { insertAuditLog } from "../db/audit.js";
import { enqueueDeliveries } from "./db.js";

// Wraps audit_log INSERT + webhook_deliveries enqueue in a single transaction.
// If delivery enqueue fails, the audit log entry also rolls back.
export async function insertAuditLogAndEnqueue(
  sql: Sql,
  tenantId: string,
  apiKeyId: string | null,
  operation: AuditOperation,
  entityType: string,
  entityId: string,
  diff: AuditDiff | null,
): Promise<void> {
  await sql.begin(async (tx) => {
    const txSql = tx as unknown as Sql;
    const auditLogId = await insertAuditLog(txSql, tenantId, apiKeyId, operation, entityType, entityId, diff);
    const payload: Record<string, unknown> = {
      id: auditLogId,
      event: operation,
      timestamp: new Date().toISOString(),
      data: { entityType, entityId, diff },
    };
    await enqueueDeliveries(txSql, tenantId, auditLogId, operation, payload);
  });
}
