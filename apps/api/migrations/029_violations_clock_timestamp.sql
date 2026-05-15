-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Michal Hlavac. All rights reserved.
-- Fix violations to use clock_timestamp() instead of now() so created_at
-- advances in real time between fast sequential inserts, eliminating timestamp
-- collisions that make cursor pagination flaky in CI (LSDS-1086).

ALTER TABLE violations ALTER COLUMN created_at SET DEFAULT clock_timestamp();
