-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Michal Hlavac. All rights reserved.
-- Persist propagateChange() output: stale flag records per affected object (LSDS-816)

CREATE TABLE stale_flags (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID        NOT NULL REFERENCES tenants(id),
  source_change_id       UUID        NOT NULL,
  object_id              UUID        NOT NULL,
  object_type            TEXT        NOT NULL CHECK (object_type IN ('node', 'edge')),
  severity               TEXT        NOT NULL CHECK (severity IN ('ERROR', 'WARNING', 'INFO')),
  raised_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  message                TEXT        NOT NULL,
  via_relationship_type  TEXT        NOT NULL,
  depth                  INTEGER     NOT NULL CHECK (depth > 0),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookup by tenant + flagged object (clear on object mutation)
CREATE INDEX ON stale_flags (tenant_id, object_id, object_type);
-- Lookup by tenant + originating change decision (bulk clear on reversal)
CREATE INDEX ON stale_flags (tenant_id, source_change_id);
