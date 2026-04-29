// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { ChangeKind, ChangeSeverity } from "./types";

// Structural classification rules (kap. 2.7).
// Source of truth — anything that does not match throws so callers cannot silently
// fall through to a wrong default.
const KIND_TO_SEVERITY: Record<ChangeKind, ChangeSeverity> = {
  RENAME: "MAJOR",
  TYPE_CHANGE: "MAJOR",
  RELATIONSHIP_REMOVED: "MAJOR",
  RELATIONSHIP_ADDED: "MINOR",
  ENUM_VALUE_CHANGED: "MINOR",
  DESCRIPTION_CHANGED: "PATCH",
  TAGS_CHANGED: "PATCH",
  METADATA_CHANGED: "PATCH",
};

export function classifyChange(kind: ChangeKind): ChangeSeverity {
  const severity = KIND_TO_SEVERITY[kind];
  if (!severity) {
    throw new Error(`Unknown change kind: ${kind}`);
  }
  return severity;
}

export function changeKindsBySeverity(severity: ChangeSeverity): ChangeKind[] {
  return (Object.keys(KIND_TO_SEVERITY) as ChangeKind[]).filter(
    (k) => KIND_TO_SEVERITY[k] === severity,
  );
}
