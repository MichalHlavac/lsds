-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Michal Hlavac. All rights reserved.
-- Add partner_status column for design-partner lifecycle tracking (LSDS-1079)

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS partner_status TEXT
    CHECK (partner_status IS NULL OR partner_status IN ('active', 'churned', 'paused'));

-- Backfill: existing partner-plan tenants default to active
UPDATE tenants SET partner_status = 'active' WHERE plan = 'partner' AND partner_status IS NULL;

-- Sparse index — only covers partner rows
CREATE INDEX IF NOT EXISTS tenants_partner_status_idx
  ON tenants(plan, created_at DESC, id DESC)
  WHERE plan = 'partner';
