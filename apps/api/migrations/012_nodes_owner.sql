-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Michal Hlavac. All rights reserved.
--
-- LSDS-592: Add owner columns to nodes table.
-- Every TKN must carry an owning team reference (kap. 2.6).
-- owner_kind is always 'team'; stored for schema completeness.
ALTER TABLE nodes
  ADD COLUMN IF NOT EXISTS owner_id   TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS owner_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS owner_kind TEXT NOT NULL DEFAULT 'team'
    CHECK (owner_kind = 'team');
