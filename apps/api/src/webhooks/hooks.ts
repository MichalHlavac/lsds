// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { AnySql } from "../db/client.js";
import type { AuditDiff, AuditOperation } from "../db/types.js";
import { insertAuditLog } from "../db/audit.js";
import { enqueueDeliveries } from "./db.js";

// Inserts an audit log entry and enqueues webhook deliveries atomically.
// Must be called inside the caller's sql.begin() transaction — callers in
// nodes.ts / edges.ts already open an outer transaction, so no nested
// savepoint is needed (and postgres.js tx objects don't expose .begin()).
export async function insertAuditLogAndEnqueue(
  sql: AnySql,
  tenantId: string,
  apiKeyId: string | null,
  operation: AuditOperation,
  entityType: string,
  entityId: string,
  diff: AuditDiff | null,
): Promise<string> {
  const auditLogId = await insertAuditLog(sql, tenantId, apiKeyId, operation, entityType, entityId, diff);
  const payload: Record<string, unknown> = {
    id: auditLogId,
    event: operation,
    timestamp: new Date().toISOString(),
    data: { entityType, entityId, diff },
  };
  await enqueueDeliveries(sql, tenantId, auditLogId, operation, payload);
  return auditLogId;
}
