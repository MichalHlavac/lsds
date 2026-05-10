-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Michal Hlavac. All rights reserved.
-- Drop the tenant FK on stale_flags — all other tables keep tenant_id as a bare
-- UUID (no FK) for performance and simplicity. Removing the constraint makes
-- stale_flags consistent with the rest of the schema and avoids FK violations
-- in test environments that seed nodes without a matching tenants row.

ALTER TABLE stale_flags DROP CONSTRAINT IF EXISTS stale_flags_tenant_id_fkey;
