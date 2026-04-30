// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { Lifecycle } from "./lifecycle.js";

export interface Entity {
  id: string;
  lifecycle: Lifecycle;
  tenantId: string;
}
