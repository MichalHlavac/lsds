-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Michal Hlavac. All rights reserved.
-- Fix node_history / edge_history to use clock_timestamp() instead of now()
-- so changed_at advances within a single transaction, eliminating timestamp
-- collisions in fast-running tests (LSDS-625).

ALTER TABLE node_history ALTER COLUMN changed_at SET DEFAULT clock_timestamp();
ALTER TABLE edge_history ALTER COLUMN changed_at SET DEFAULT clock_timestamp();
