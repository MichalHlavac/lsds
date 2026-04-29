// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };
