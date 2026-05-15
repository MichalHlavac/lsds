-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Michal Hlavac. All rights reserved.
-- Usage telemetry events table (LSDS-1060)

DO $$ BEGIN
  CREATE TYPE usage_event_type AS ENUM (
    'NODE_CREATED',
    'EDGE_CREATED',
    'REQUIREMENT_ADDED',
    'VIOLATION_CHECKED',
    'GRAPH_TRAVERSED',
    'MCP_QUERY'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS usage_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type  usage_event_type NOT NULL,
  entity_id   UUID,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_events_tenant_created_idx ON usage_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_tenant_type_idx ON usage_events(tenant_id, event_type);
