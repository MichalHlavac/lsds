// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

// Persistence adapters — concrete implementations of the framework's
// persistence contracts (currently `GraphRepository`). The framework owns the
// interface; this folder exports the adapters that ship with the framework.

export {
  InMemoryGraphRepository,
  type InMemoryGraphSeed,
} from "./in-memory-graph-repository.js";
