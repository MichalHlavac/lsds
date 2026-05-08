-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Michal Hlavac. All rights reserved.

ALTER TABLE api_keys ADD COLUMN expires_at TIMESTAMPTZ;
