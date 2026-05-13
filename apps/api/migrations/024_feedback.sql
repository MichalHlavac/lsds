-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Michal Hlavac. All rights reserved.
-- Feedback intake table (LSDS-959)

DO $$ BEGIN
  CREATE TYPE feedback_type AS ENUM ('bug', 'feature', 'general');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  api_key_id  UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  type        feedback_type NOT NULL DEFAULT 'general',
  message     TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 5000),
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_tenant_idx ON feedback(tenant_id, created_at DESC);
