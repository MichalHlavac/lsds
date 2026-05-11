// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { Severity } from "@lsds/framework";

// DB stores "WARN"; the framework Severity type uses "WARNING".
// This mapping is the single canonical bridge between the two representations.
// If a new severity is added on either side this function will throw at
// runtime on first use, making the gap visible immediately.
const DB_SEVERITY_TO_FRAMEWORK: Readonly<Record<string, Severity>> = {
  ERROR: "ERROR",
  WARN: "WARNING",
  INFO: "INFO",
};

export function dbSeverityToFramework(dbSeverity: string): Severity {
  const mapped = DB_SEVERITY_TO_FRAMEWORK[dbSeverity];
  if (mapped === undefined) {
    throw new Error(`Unmapped DB severity value: "${dbSeverity}"`);
  }
  return mapped;
}
