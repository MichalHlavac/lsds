// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { createHash } from "node:crypto";

export function sha256hex(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}
