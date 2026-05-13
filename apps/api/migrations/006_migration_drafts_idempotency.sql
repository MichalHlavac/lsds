-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Michal Hlavac. All rights reserved.
--
-- Migration 005: add committed_node_id to migration_drafts for double-commit idempotency.
-- After a successful commit, the commit handler sets committed_node_id to the created
-- node's UUID inside the same transaction. A second commit call skips drafts where
-- committed_node_id IS NOT NULL, so the live nodes table is never double-written.
-- This implements the retry-safe path required by ADR-017 §3.

ALTER TABLE migration_drafts
  ADD COLUMN IF NOT EXISTS committed_node_id UUID REFERENCES nodes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS migration_drafts_committed_node
  ON migration_drafts(tenant_id, committed_node_id)
  WHERE committed_node_id IS NOT NULL;
