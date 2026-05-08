-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Michal Hlavac. All rights reserved.
-- Append-only audit trail for graph mutations (LSDS-690)

CREATE TABLE audit_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL,
  api_key_id    UUID        REFERENCES api_keys(id) ON DELETE SET NULL,
  operation     TEXT        NOT NULL CHECK (operation IN (
    'node.create', 'node.update', 'node.delete',
    'node.deprecate', 'node.archive', 'node.purge',
    'edge.create', 'edge.update', 'edge.delete'
  )),
  entity_type   TEXT        NOT NULL,
  entity_id     UUID        NOT NULL,
  diff          JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON audit_log (tenant_id, created_at DESC);
CREATE INDEX ON audit_log (tenant_id, entity_id, created_at DESC);
