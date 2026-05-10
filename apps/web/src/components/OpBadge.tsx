// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { HistoryOp } from "../lib/api";

const LABELS: Record<HistoryOp, string> = {
  CREATE: "Created",
  UPDATE: "Updated",
  LIFECYCLE_TRANSITION: "Lifecycle",
};

const STYLES: Record<HistoryOp, string> = {
  CREATE: "bg-green-900/50 text-green-300 ring-1 ring-green-700",
  UPDATE: "bg-blue-900/50 text-blue-300 ring-1 ring-blue-700",
  LIFECYCLE_TRANSITION: "bg-yellow-900/50 text-yellow-300 ring-1 ring-yellow-700",
};

export function OpBadge({ op }: { op: HistoryOp }) {
  return (
    <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded ${STYLES[op]}`}>
      {LABELS[op]}
    </span>
  );
}
