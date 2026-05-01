// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  LayerSchema,
  LifecycleStatusSchema,
  SeveritySchema,
} from "../src/index";

describe("LayerSchema", () => {
  it.each(["L1", "L2", "L3", "L4", "L5", "L6"] as const)(
    "accepts valid value %s",
    (value) => {
      expect(LayerSchema.parse(value)).toBe(value);
    },
  );

  it.each(["L0", "L7", "l1", "layer1", "", "1"])(
    "rejects invalid value %s",
    (value) => {
      expect(LayerSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("LifecycleStatusSchema", () => {
  it.each(["ACTIVE", "DEPRECATED", "ARCHIVED", "PURGE"] as const)(
    "accepts valid value %s",
    (value) => {
      expect(LifecycleStatusSchema.parse(value)).toBe(value);
    },
  );

  it.each(["active", "Active", "DELETED", "", "UNKNOWN"])(
    "rejects invalid value %s",
    (value) => {
      expect(LifecycleStatusSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("SeveritySchema", () => {
  it.each(["ERROR", "WARN", "INFO"] as const)(
    "accepts valid value %s",
    (value) => {
      expect(SeveritySchema.parse(value)).toBe(value);
    },
  );

  it.each(["error", "Warning", "DEBUG", "", "CRITICAL"])(
    "rejects invalid value %s",
    (value) => {
      expect(SeveritySchema.safeParse(value).success).toBe(false);
    },
  );
});
