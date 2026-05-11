-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Michal Hlavac. All rights reserved.

CREATE TABLE tenants (
  id             UUID        PRIMARY KEY,
  name           TEXT        NOT NULL,
  plan           TEXT        NOT NULL DEFAULT 'standard',
  retention_days INTEGER     NOT NULL DEFAULT 730 CHECK (retention_days > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
