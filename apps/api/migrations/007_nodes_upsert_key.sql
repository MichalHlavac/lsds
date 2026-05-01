-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Michal Hlavac. All rights reserved.
-- Natural-key unique indexes enabling idempotent upsert seeding (LSDS-273)
-- Uses CREATE UNIQUE INDEX IF NOT EXISTS (idempotent) rather than ADD CONSTRAINT
-- so the migration is safe to apply even if the index already exists from a
-- previous run under a different migration filename.

-- Nodes: (tenant_id, type, layer, name) uniquely identifies a node within a tenant.
CREATE UNIQUE INDEX IF NOT EXISTS nodes_tenant_type_layer_name_key
  ON nodes (tenant_id, type, layer, name);

-- Edges: (tenant_id, source_id, target_id, type) uniquely identifies an edge.
CREATE UNIQUE INDEX IF NOT EXISTS edges_tenant_source_target_type_key
  ON edges (tenant_id, source_id, target_id, type);
