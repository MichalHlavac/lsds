-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Michal Hlavac. All rights reserved.
--
-- Migration 004: migration_drafts table for the Migration Agent (kap. 6.4)
-- Stores proposed TKN objects in a staging/review state before they are
-- committed to the live nodes table. Each draft has per-attribute confidence
-- levels and must always carry an owner.

CREATE TABLE IF NOT EXISTS migration_drafts (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL,
  session_id     UUID        NOT NULL,
  source_ref     TEXT        NOT NULL,
  proposed_type  TEXT        NOT NULL,
  proposed_layer TEXT        NOT NULL,
  proposed_name  TEXT        NOT NULL,
  proposed_attrs JSONB       NOT NULL DEFAULT '{}',
  confidence     JSONB       NOT NULL DEFAULT '{}',
  owner          TEXT        NOT NULL,
  review_flags   TEXT[]      NOT NULL DEFAULT '{}',
  status         TEXT        NOT NULL DEFAULT 'pending',
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS migration_drafts_tenant_session
  ON migration_drafts(tenant_id, session_id);

CREATE INDEX IF NOT EXISTS migration_drafts_status
  ON migration_drafts(tenant_id, status);
