-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Michal Hlavac. All rights reserved.

CREATE TABLE api_keys (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID        NOT NULL,
  name       TEXT        NOT NULL,
  key_hash   TEXT        NOT NULL UNIQUE,
  key_prefix TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_tenant_id ON api_keys(tenant_id);
-- Partial index on hash for active keys only (hot path on every authenticated request)
CREATE INDEX idx_api_keys_active_hash ON api_keys(key_hash) WHERE revoked_at IS NULL;
