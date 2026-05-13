// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import {
  countWebhooks,
  createWebhook,
  listWebhooks,
  getWebhook,
  updateWebhook,
  rotateWebhookSecret,
  deleteWebhook,
  listDeliveries,
} from "../webhooks/db.js";
import {
  encryptSecret,
  generateWebhookSecret,
  isWebhookEncryptionKeySet,
} from "../webhooks/crypto.js";
import { parsePaginationLimit } from "./util.js";

const MAX_WEBHOOKS = 10;

const CreateWebhookSchema = z.object({
  url: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), { message: "url must use https" }),
  eventTypes: z
    .array(z.string().min(1))
    .min(1, "at least one event type required"),
});

const UpdateWebhookSchema = z.object({
  url: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), { message: "url must use https" })
    .optional(),
  eventTypes: z.array(z.string().min(1)).min(1).optional(),
  isActive: z.boolean().optional(),
});

export function adminWebhooksRouter(sql: Sql): Hono {
  const app = new Hono();

  // POST / — register a new webhook; secret returned once in plaintext
  app.post("/", async (c) => {
    if (!isWebhookEncryptionKeySet()) {
      return c.json(
        { error: "webhook subsystem not configured: LSDS_WEBHOOK_ENCRYPTION_KEY is not set" },
        503,
      );
    }

    const tenantId = c.req.header("x-tenant-id");
    if (!tenantId) return c.json({ error: "x-tenant-id header required" }, 400);

    const body = CreateWebhookSchema.parse(await c.req.json());

    const count = await countWebhooks(sql, tenantId);
    if (count >= MAX_WEBHOOKS) {
      return c.json({ error: `per-tenant webhook limit of ${MAX_WEBHOOKS} reached` }, 422);
    }

    const secret = generateWebhookSecret();
    const secretEnc = encryptSecret(secret);
    const webhook = await createWebhook(sql, tenantId, body.url, body.eventTypes, secretEnc);

    return c.json(
      {
        data: {
          id: webhook.id,
          url: webhook.url,
          eventTypes: webhook.eventTypes,
          isActive: webhook.isActive,
          createdAt: webhook.createdAt,
          updatedAt: webhook.updatedAt,
          secret,
        },
      },
      201,
    );
  });

  // GET / — list all webhooks for the tenant (no secrets)
  app.get("/", async (c) => {
    const tenantId = c.req.header("x-tenant-id");
    if (!tenantId) return c.json({ error: "x-tenant-id header required" }, 400);

    const webhooks = await listWebhooks(sql, tenantId);
    return c.json({
      data: webhooks.map((w) => ({
        id: w.id,
        url: w.url,
        eventTypes: w.eventTypes,
        isActive: w.isActive,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      })),
    });
  });

  // GET /:id — get single webhook (no secret)
  app.get("/:id", async (c) => {
    const tenantId = c.req.header("x-tenant-id");
    if (!tenantId) return c.json({ error: "x-tenant-id header required" }, 400);

    const { id } = c.req.param();
    const webhook = await getWebhook(sql, tenantId, id);
    if (!webhook) return c.json({ error: "not found" }, 404);

    return c.json({
      data: {
        id: webhook.id,
        url: webhook.url,
        eventTypes: webhook.eventTypes,
        isActive: webhook.isActive,
        createdAt: webhook.createdAt,
        updatedAt: webhook.updatedAt,
      },
    });
  });

  // PATCH /:id — update url / eventTypes / isActive
  app.patch("/:id", async (c) => {
    const tenantId = c.req.header("x-tenant-id");
    if (!tenantId) return c.json({ error: "x-tenant-id header required" }, 400);

    const { id } = c.req.param();
    const body = UpdateWebhookSchema.parse(await c.req.json());

    const webhook = await updateWebhook(sql, tenantId, id, body);
    if (!webhook) return c.json({ error: "not found" }, 404);

    return c.json({
      data: {
        id: webhook.id,
        url: webhook.url,
        eventTypes: webhook.eventTypes,
        isActive: webhook.isActive,
        createdAt: webhook.createdAt,
        updatedAt: webhook.updatedAt,
      },
    });
  });

  // DELETE /:id — remove webhook
  app.delete("/:id", async (c) => {
    const tenantId = c.req.header("x-tenant-id");
    if (!tenantId) return c.json({ error: "x-tenant-id header required" }, 400);

    const { id } = c.req.param();
    const deleted = await deleteWebhook(sql, tenantId, id);
    if (!deleted) return c.json({ error: "not found" }, 404);

    return c.json({ data: { id } });
  });

  // POST /:id/rotate-secret — rotate the signing secret; new secret returned once
  app.post("/:id/rotate-secret", async (c) => {
    if (!isWebhookEncryptionKeySet()) {
      return c.json(
        { error: "webhook subsystem not configured: LSDS_WEBHOOK_ENCRYPTION_KEY is not set" },
        503,
      );
    }

    const tenantId = c.req.header("x-tenant-id");
    if (!tenantId) return c.json({ error: "x-tenant-id header required" }, 400);

    const { id } = c.req.param();
    const existing = await getWebhook(sql, tenantId, id);
    if (!existing) return c.json({ error: "not found" }, 404);

    const newSecret = generateWebhookSecret();
    const newSecretEnc = encryptSecret(newSecret);
    const webhook = await rotateWebhookSecret(sql, tenantId, id, newSecretEnc);
    if (!webhook) return c.json({ error: "not found" }, 404);

    return c.json({
      data: {
        id: webhook.id,
        secret: newSecret,
        updatedAt: webhook.updatedAt,
      },
    });
  });

  // GET /:id/deliveries — paginated delivery history
  app.get("/:id/deliveries", async (c) => {
    const tenantId = c.req.header("x-tenant-id");
    if (!tenantId) return c.json({ error: "x-tenant-id header required" }, 400);

    const { id } = c.req.param();
    const webhook = await getWebhook(sql, tenantId, id);
    if (!webhook) return c.json({ error: "not found" }, 404);

    const limit = parsePaginationLimit(c.req.query("limit"), 50, 200);
    const cursor = c.req.query("cursor") ?? null;

    const { rows, nextCursor } = await listDeliveries(sql, tenantId, id, limit, cursor);
    return c.json({ data: rows, nextCursor });
  });

  return app;
}
