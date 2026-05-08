-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Michal Hlavac. All rights reserved.
-- Changelog tables for node and edge audit history (LSDS-254)

CREATE TABLE node_history (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id     UUID        NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  tenant_id   UUID        NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  changed_by  TEXT,
  op          TEXT        NOT NULL CHECK (op IN ('CREATE', 'UPDATE', 'LIFECYCLE_TRANSITION')),
  previous    JSONB,
  current     JSONB       NOT NULL
);

CREATE INDEX ON node_history (node_id, changed_at DESC);
CREATE INDEX ON node_history (tenant_id, changed_at DESC);

CREATE TABLE edge_history (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  edge_id     UUID        NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
  tenant_id   UUID        NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  changed_by  TEXT,
  op          TEXT        NOT NULL CHECK (op IN ('CREATE', 'UPDATE', 'LIFECYCLE_TRANSITION')),
  previous    JSONB,
  current     JSONB       NOT NULL
);

CREATE INDEX ON edge_history (edge_id, changed_at DESC);
CREATE INDEX ON edge_history (tenant_id, changed_at DESC);
