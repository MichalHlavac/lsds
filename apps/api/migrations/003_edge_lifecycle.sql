-- Add lifecycle columns to edges (LSDS-142)

ALTER TABLE edges
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (lifecycle_status IN ('ACTIVE','DEPRECATED','ARCHIVED','PURGE')),
  ADD COLUMN IF NOT EXISTS deprecated_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS purge_after      TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_edges_tenant_lifecycle
  ON edges (tenant_id, lifecycle_status);
