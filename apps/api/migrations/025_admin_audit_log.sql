CREATE TABLE admin_audit_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation         TEXT NOT NULL,
  target_tenant_id  UUID REFERENCES tenants(id) ON DELETE SET NULL,
  payload           JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admin_audit_log_tenant_idx ON admin_audit_log(target_tenant_id, created_at DESC);
CREATE INDEX admin_audit_log_created_idx ON admin_audit_log(created_at DESC);
