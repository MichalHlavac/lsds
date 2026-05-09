// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { Sql } from "../db/client.js";

export interface WebhookRow {
  id: string;
  tenantId: string;
  url: string;
  eventTypes: string[];
  secretEnc: Buffer;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookDeliveryRow {
  id: string;
  webhookId: string;
  tenantId: string;
  auditLogId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: "pending" | "delivered" | "failed";
  attemptCount: number;
  nextAttempt: Date;
  lastResponseStatus: number | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const MAX_WEBHOOKS_PER_TENANT = 10;
const MAX_ATTEMPTS = 4;
const BACKOFF_SECONDS = [0, 1, 4, 16] as const;

export async function countWebhooks(sql: Sql, tenantId: string): Promise<number> {
  const [{ count }] = await sql<[{ count: string }]>`
    SELECT count(*)::text AS count FROM webhooks WHERE tenant_id = ${tenantId}
  `;
  return Number(count);
}

export async function createWebhook(
  sql: Sql,
  tenantId: string,
  url: string,
  eventTypes: string[],
  secretEnc: Buffer,
): Promise<WebhookRow> {
  const [row] = await sql<WebhookRow[]>`
    INSERT INTO webhooks (tenant_id, url, event_types, secret_enc)
    VALUES (${tenantId}, ${url}, ${sql.array(eventTypes)}, ${sql`decode(${secretEnc.toString("hex")}, 'hex')`})
    RETURNING *
  `;
  return row!;
}

export async function listWebhooks(sql: Sql, tenantId: string): Promise<WebhookRow[]> {
  return sql<WebhookRow[]>`
    SELECT * FROM webhooks WHERE tenant_id = ${tenantId} ORDER BY created_at ASC
  `;
}

export async function getWebhook(
  sql: Sql,
  tenantId: string,
  id: string,
): Promise<WebhookRow | undefined> {
  const [row] = await sql<WebhookRow[]>`
    SELECT * FROM webhooks WHERE id = ${id} AND tenant_id = ${tenantId}
  `;
  return row;
}

export async function updateWebhook(
  sql: Sql,
  tenantId: string,
  id: string,
  updates: { url?: string; eventTypes?: string[]; isActive?: boolean },
): Promise<WebhookRow | undefined> {
  const hasUrl = updates.url !== undefined;
  const hasTypes = updates.eventTypes !== undefined;
  const hasActive = updates.isActive !== undefined;
  if (!hasUrl && !hasTypes && !hasActive) return getWebhook(sql, tenantId, id);

  const [row] = await sql<WebhookRow[]>`
    UPDATE webhooks SET
      ${hasUrl ? sql`url = ${updates.url!},` : sql``}
      ${hasTypes ? sql`event_types = ${sql.array(updates.eventTypes!)},` : sql``}
      ${hasActive ? sql`is_active = ${updates.isActive!},` : sql``}
      updated_at = now()
    WHERE id = ${id} AND tenant_id = ${tenantId}
    RETURNING *
  `;
  return row;
}

export async function rotateWebhookSecret(
  sql: Sql,
  tenantId: string,
  id: string,
  newSecretEnc: Buffer,
): Promise<WebhookRow | undefined> {
  const [row] = await sql<WebhookRow[]>`
    UPDATE webhooks
    SET secret_enc = decode(${newSecretEnc.toString("hex")}, 'hex'), updated_at = now()
    WHERE id = ${id} AND tenant_id = ${tenantId}
    RETURNING *
  `;
  return row;
}

export async function deleteWebhook(
  sql: Sql,
  tenantId: string,
  id: string,
): Promise<boolean> {
  const result = await sql`
    DELETE FROM webhooks WHERE id = ${id} AND tenant_id = ${tenantId}
  `;
  return result.count > 0;
}

export async function enqueueDeliveries(
  sql: Sql,
  tenantId: string,
  auditLogId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const webhooks = await sql<{ id: string }[]>`
    SELECT id FROM webhooks
    WHERE tenant_id = ${tenantId}
      AND is_active = true
      AND event_types @> ARRAY[${eventType}]::text[]
  `;
  if (webhooks.length === 0) return;

  await sql`
    INSERT INTO webhook_deliveries (webhook_id, tenant_id, audit_log_id, event_type, payload)
    SELECT w.id, ${tenantId}, ${auditLogId}, ${eventType}, ${sql.json(payload as Parameters<Sql["json"]>[0])}
    FROM unnest(${sql.array(webhooks.map((w) => w.id))}::uuid[]) AS w(id)
  `;
}

export async function pollPendingDeliveries(
  sql: Sql,
  limit = 50,
): Promise<WebhookDeliveryRow[]> {
  return sql<WebhookDeliveryRow[]>`
    SELECT d.* FROM webhook_deliveries d
    WHERE d.status = 'pending' AND d.next_attempt <= now()
    ORDER BY d.next_attempt ASC
    LIMIT ${limit}
    FOR UPDATE SKIP LOCKED
  `;
}

export async function recordDeliveryAttempt(
  sql: Sql,
  id: string,
  responseStatus: number | null,
  error: string | null,
  succeeded: boolean,
): Promise<void> {
  if (succeeded) {
    await sql`
      UPDATE webhook_deliveries
      SET status = 'delivered',
          attempt_count = attempt_count + 1,
          last_response_status = ${responseStatus},
          last_error = null,
          updated_at = now()
      WHERE id = ${id}
    `;
    return;
  }

  // Increment attempt count first, then decide based on new count
  const [row] = await sql<[{ attemptCount: number }]>`
    UPDATE webhook_deliveries
    SET attempt_count = attempt_count + 1,
        last_response_status = ${responseStatus},
        last_error = ${error},
        updated_at = now()
    WHERE id = ${id}
    RETURNING attempt_count
  `;

  const newCount = row!.attemptCount;
  if (newCount >= MAX_ATTEMPTS) {
    await sql`
      UPDATE webhook_deliveries SET status = 'failed', updated_at = now() WHERE id = ${id}
    `;
  } else {
    const delaySecs = BACKOFF_SECONDS[newCount] ?? 16;
    await sql`
      UPDATE webhook_deliveries
      SET next_attempt = now() + ${`${delaySecs} seconds`}::interval,
          updated_at = now()
      WHERE id = ${id}
    `;
  }
}

export async function applyRetryAfter(
  sql: Sql,
  id: string,
  retryAfterSecs: number,
  backoffSecs: number,
): Promise<void> {
  if (retryAfterSecs <= backoffSecs) return;
  await sql`
    UPDATE webhook_deliveries
    SET next_attempt = now() + ${`${retryAfterSecs} seconds`}::interval,
        updated_at = now()
    WHERE id = ${id} AND status = 'pending'
  `;
}

export async function listDeliveries(
  sql: Sql,
  tenantId: string,
  webhookId: string,
  limit: number,
  cursor: string | null,
): Promise<{ rows: WebhookDeliveryRow[]; nextCursor: string | null }> {
  const rows = await sql<WebhookDeliveryRow[]>`
    SELECT d.* FROM webhook_deliveries d
    JOIN webhooks w ON w.id = d.webhook_id
    WHERE d.webhook_id = ${webhookId}
      AND w.tenant_id = ${tenantId}
      ${cursor ? sql`AND d.created_at < ${new Date(cursor)}` : sql``}
    ORDER BY d.created_at DESC
    LIMIT ${limit + 1}
  `;

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && page.length > 0
    ? page[page.length - 1]!.createdAt.toISOString()
    : null;
  return { rows: page, nextCursor };
}
