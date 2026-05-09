// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { Sql } from "../db/client.js";
import { logger } from "../logger.js";
import { insertAuditLog } from "../db/audit.js";
import {
  pollPendingDeliveries,
  recordDeliveryAttempt,
  applyRetryAfter,
  getWebhook,
  type WebhookDeliveryRow,
} from "./db.js";
import { decryptSecret, signPayload } from "./crypto.js";

const POLL_INTERVAL_MS = 5000;
const ATTEMPT_TIMEOUT_MS = 5000;
const BACKOFF_SECONDS = [0, 1, 4, 16] as const;

export interface WebhookDispatcher {
  start(): void;
  stop(): void;
  poll(): Promise<void>;
}

export function createWebhookDispatcher(sql: Sql): WebhookDispatcher {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function dispatch(delivery: WebhookDeliveryRow): Promise<void> {
    const webhook = await getWebhook(sql, delivery.tenantId, delivery.webhookId);
    if (!webhook) return;

    let plaintextSecret: string;
    try {
      plaintextSecret = decryptSecret(webhook.secretEnc);
    } catch (err) {
      logger.error({ err, webhookId: webhook.id }, "failed to decrypt webhook secret");
      await recordDeliveryAttempt(sql, delivery.id, null, "secret decryption failed", false);
      return;
    }

    const rawBody = JSON.stringify(delivery.payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signPayload(plaintextSecret, timestamp, rawBody);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);

    let responseStatus: number | null = null;
    let errorMsg: string | null = null;
    let succeeded = false;

    try {
      const res = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-LSDS-Webhook-Id": webhook.id,
          "X-LSDS-Delivery-Id": delivery.id,
          "X-LSDS-Event-Type": delivery.eventType,
          "X-LSDS-Timestamp": timestamp,
          "X-LSDS-Signature": signature,
        },
        body: rawBody,
        signal: controller.signal,
      });

      responseStatus = res.status;
      succeeded = res.status >= 200 && res.status < 300;

      if (!succeeded) {
        errorMsg = `HTTP ${res.status}`;
        // Honor Retry-After if larger than backoff
        const retryAfterHeader = res.headers.get("Retry-After");
        if (retryAfterHeader) {
          const retryAfterSecs = parseRetryAfter(retryAfterHeader);
          if (retryAfterSecs !== null) {
            const currentAttempt = delivery.attemptCount;
            const backoffSecs = BACKOFF_SECONDS[currentAttempt + 1] ?? 16;
            await applyRetryAfter(sql, delivery.id, retryAfterSecs, backoffSecs);
          }
        }
      }
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timeout);
    }

    await recordDeliveryAttempt(sql, delivery.id, responseStatus, errorMsg, succeeded);

    // Emit audit log
    try {
      const [fresh] = await sql<[{ status: string; attemptCount: number }]>`
        SELECT status, attempt_count FROM webhook_deliveries WHERE id = ${delivery.id}
      `;
      if (fresh) {
        if (succeeded) {
          await insertAuditLog(
            sql, delivery.tenantId, null,
            "webhook.delivered", "webhook_delivery", delivery.id, null,
          );
        } else if (fresh.status === "failed") {
          await insertAuditLog(
            sql, delivery.tenantId, null,
            "webhook.exhausted", "webhook_delivery", delivery.id, null,
          );
        } else {
          await insertAuditLog(
            sql, delivery.tenantId, null,
            "webhook.attempt", "webhook_delivery", delivery.id, null,
          );
        }
      }
    } catch (err) {
      logger.warn({ err, deliveryId: delivery.id }, "failed to write webhook audit log");
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        if (!running) {
          running = true;
          this.poll().finally(() => { running = false; });
        }
      }, POLL_INTERVAL_MS);
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },

    async poll() {
      let deliveries: WebhookDeliveryRow[];
      try {
        deliveries = await sql.begin((tx) => pollPendingDeliveries(tx as unknown as Sql));
      } catch (err) {
        logger.error({ err }, "webhook dispatcher poll failed");
        return;
      }

      await Promise.allSettled(deliveries.map((d) => dispatch(d)));
    },
  };
}

function parseRetryAfter(header: string): number | null {
  const n = Number(header);
  if (Number.isFinite(n) && n > 0) return n;
  const date = Date.parse(header);
  if (!isNaN(date)) {
    const secs = Math.ceil((date - Date.now()) / 1000);
    return secs > 0 ? secs : null;
  }
  return null;
}
