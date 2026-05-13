-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Michal Hlavac. All rights reserved.
-- Per-API-key + per-tenant token bucket rate limiting (LSDS-697)

-- Nullable per-key overrides; NULL means "use tenant default"
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS rate_limit_rpm   INT,
  ADD COLUMN IF NOT EXISTS rate_limit_burst INT;

-- Tenant-level defaults (non-nullable with safe defaults)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS rate_limit_rpm   INT NOT NULL DEFAULT 600,
  ADD COLUMN IF NOT EXISTS rate_limit_burst INT NOT NULL DEFAULT 60;

-- Extend audit_log to allow rate_limit_hit events
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_operation_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_operation_check
  CHECK (operation IN (
    'node.create', 'node.update', 'node.delete',
    'node.deprecate', 'node.archive', 'node.purge',
    'edge.create', 'edge.update', 'edge.delete',
    'rate_limit_hit'
  ));
