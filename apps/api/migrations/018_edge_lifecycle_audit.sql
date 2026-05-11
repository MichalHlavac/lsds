-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Michal Hlavac. All rights reserved.
-- Extend audit_log to allow edge lifecycle transition events (LSDS-867)

ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_operation_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_operation_check CHECK (operation IN (
  'node.create', 'node.update', 'node.delete',
  'node.deprecate', 'node.archive', 'node.purge',
  'edge.create', 'edge.update', 'edge.delete',
  'edge.deprecate', 'edge.archive', 'edge.purge',
  'rate_limit_hit',
  'webhook.attempt', 'webhook.delivered', 'webhook.exhausted'
));
