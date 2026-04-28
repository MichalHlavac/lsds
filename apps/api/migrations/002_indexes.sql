-- LSDS Core Application — indexes (kap. 8 spec)

-- nodes: GIN on JSONB attributes
CREATE INDEX IF NOT EXISTS idx_nodes_attributes_gin ON nodes USING GIN (attributes);

-- nodes: btree (tenant_id, layer, type)
CREATE INDEX IF NOT EXISTS idx_nodes_tenant_layer_type ON nodes (tenant_id, layer, type);

-- nodes: btree (tenant_id, lifecycle_status)
CREATE INDEX IF NOT EXISTS idx_nodes_tenant_lifecycle ON nodes (tenant_id, lifecycle_status);

-- nodes: btree (tenant_id, updated_at DESC) — cache invalidation queries
CREATE INDEX IF NOT EXISTS idx_nodes_tenant_updated ON nodes (tenant_id, updated_at DESC);

-- edges: source-side traversal
CREATE INDEX IF NOT EXISTS idx_edges_source_type ON edges (source_id, type);

-- edges: target-side traversal (reverse)
CREATE INDEX IF NOT EXISTS idx_edges_target_type ON edges (target_id, type);

-- edges: (tenant_id, layer, type)
CREATE INDEX IF NOT EXISTS idx_edges_tenant_layer_type ON edges (tenant_id, layer, type);

-- edges: GIN on JSONB attributes
CREATE INDEX IF NOT EXISTS idx_edges_attributes_gin ON edges USING GIN (attributes);

-- violations: (tenant_id, node_id)
CREATE INDEX IF NOT EXISTS idx_violations_tenant_node ON violations (tenant_id, node_id);

-- violations: (tenant_id, rule_key)
CREATE INDEX IF NOT EXISTS idx_violations_tenant_rule ON violations (tenant_id, rule_key);

-- violations: partial index for open violations
CREATE INDEX IF NOT EXISTS idx_violations_tenant_open ON violations (tenant_id, resolved) WHERE resolved = FALSE;

-- snapshots: latest-snapshot queries
CREATE INDEX IF NOT EXISTS idx_snapshots_tenant_created ON snapshots (tenant_id, created_at DESC);

-- users / teams
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_teams_tenant ON teams (tenant_id);

-- guardrails: (tenant_id, enabled)
CREATE INDEX IF NOT EXISTS idx_guardrails_tenant_enabled ON guardrails (tenant_id, enabled);
