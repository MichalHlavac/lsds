// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { LifecycleStatus } from "../lib/api";

const STYLES: Record<LifecycleStatus, string> = {
  ACTIVE: "bg-green-900/50 text-green-300 ring-1 ring-green-700",
  DEPRECATED: "bg-yellow-900/50 text-yellow-300 ring-1 ring-yellow-700",
  ARCHIVED: "bg-gray-800 text-gray-300 ring-1 ring-gray-600",
  PURGE: "bg-red-900/50 text-red-300 ring-1 ring-red-700",
};

export function LifecycleBadge({ status }: { status: LifecycleStatus }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STYLES[status]}`}
    >
      {status}
    </span>
  );
}
