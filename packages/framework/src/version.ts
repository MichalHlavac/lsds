// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

// Version of the LSDS framework's own type system (Zod schemas + relationship /
// guardrail registry + traversal/change/lifecycle contracts exported from
// `@lsds/framework`). Per research kap. 2.8, this is one of three orthogonal
// version axes; it is NOT the npm package version and NOT the DB migration
// version — those evolve independently.
//
// Bump policy:
//   MAJOR — breaking change to public framework types or wire shape
//           (removed/renamed Zod field, narrowed enum, relationship deleted,
//           guardrail id retired, traversal profile semantics changed).
//   MINOR — additive change to public types
//           (new optional Zod field, new relationship/guardrail/profile, new
//           exported helper).
//   PATCH — non-semantic edits
//           (doc tweaks, internal refactor, error-message wording,
//           performance-only changes).
export const FRAMEWORK_SCHEMA_VERSION = "1.0.0";
