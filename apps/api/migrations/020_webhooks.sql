-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Michal Hlavac. All rights reserved.
-- Webhook notification tables (LSDS-700)

-- Extend audit_log operation check to include webhook events
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_operation_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_operation_check CHECK (operation IN (
  'node.create', 'node.update', 'node.delete',
  'node.deprecate', 'node.archive', 'node.purge',
  'edge.create', 'edge.update', 'edge.delete',
  'rate_limit_hit',
  'webhook.attempt', 'webhook.delivered', 'webhook.exhausted'
));

-- Registered webhook endpoints per tenant
CREATE TABLE webhooks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL,
  url          TEXT        NOT NULL,
  event_types  TEXT[]      NOT NULL,
  secret_enc   BYTEA       NOT NULL,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON webhooks (tenant_id, is_active);

-- Delivery queue: one row per (webhook, audit_log_entry)
CREATE TABLE webhook_deliveries (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id           UUID        NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  tenant_id            UUID        NOT NULL,
  audit_log_id         UUID        NOT NULL REFERENCES audit_log(id),
  event_type           TEXT        NOT NULL,
  payload              JSONB       NOT NULL,
  status               TEXT        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'delivered', 'failed')),
  attempt_count        INTEGER     NOT NULL DEFAULT 0,
  next_attempt         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_response_status INTEGER,
  last_error           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dispatcher poll index: pending rows due for delivery
CREATE INDEX ON webhook_deliveries (next_attempt) WHERE status = 'pending';
-- Deliveries list per webhook
CREATE INDEX ON webhook_deliveries (webhook_id, created_at DESC);
-- Tenant-scoped delivery queries
CREATE INDEX ON webhook_deliveries (tenant_id, created_at DESC);
