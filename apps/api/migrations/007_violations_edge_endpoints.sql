-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Michal Hlavac. All rights reserved.
-- Violations are missing the source/target node pair for edge-targeted rules.
-- Without these columns architects can't navigate from a violation row back to
-- the offending edge endpoints.

ALTER TABLE violations
  ADD COLUMN IF NOT EXISTS source_node_id UUID REFERENCES nodes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_node_id UUID REFERENCES nodes(id) ON DELETE SET NULL;

-- Backfill: every existing violation row that points to an edge gets its endpoints.
UPDATE violations v
SET source_node_id = e.source_id,
    target_node_id = e.target_id
FROM edges e
WHERE v.edge_id = e.id
  AND v.tenant_id = e.tenant_id
  AND (v.source_node_id IS NULL OR v.target_node_id IS NULL);

CREATE INDEX IF NOT EXISTS idx_violations_tenant_source ON violations (tenant_id, source_node_id);
CREATE INDEX IF NOT EXISTS idx_violations_tenant_target ON violations (tenant_id, target_node_id);
