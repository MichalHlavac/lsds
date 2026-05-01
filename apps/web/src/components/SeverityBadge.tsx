// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { Severity } from "../lib/api";

const STYLES: Record<Severity, string> = {
  ERROR: "bg-red-900 text-red-300 border border-red-700",
  WARN: "bg-orange-900 text-orange-300 border border-orange-700",
  INFO: "bg-blue-900 text-blue-300 border border-blue-700",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STYLES[severity]}`}>
      {severity}
    </span>
  );
}
