// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const LAYER_IDS = ["L1", "L2", "L3", "L4", "L5", "L6"] as const;
export const LayerSchema = z.enum(LAYER_IDS);
export type Layer = z.infer<typeof LayerSchema>;

export const LIFECYCLE_STATUSES = [
  "ACTIVE",
  "DEPRECATED",
  "ARCHIVED",
  "PURGE",
] as const;
export const LifecycleStatusSchema = z.enum(LIFECYCLE_STATUSES);
export type LifecycleStatus = z.infer<typeof LifecycleStatusSchema>;

export const SEVERITIES = ["ERROR", "WARN", "INFO"] as const;
export const SeveritySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof SeveritySchema>;
