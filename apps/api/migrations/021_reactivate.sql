-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Michal Hlavac. All rights reserved.
-- Add node.reactivate to audit_log operation allowlist (LSDS-762)

ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_operation_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_operation_check CHECK (operation IN (
  'node.create', 'node.update', 'node.delete',
  'node.deprecate', 'node.archive', 'node.purge', 'node.reactivate',
  'edge.create', 'edge.update', 'edge.delete',
  'rate_limit_hit',
  'webhook.attempt', 'webhook.delivered', 'webhook.exhausted'
));
