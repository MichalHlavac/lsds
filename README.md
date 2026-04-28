# LSDS — Layered Software Documentation System

A typed knowledge graph SSOT for software knowledge across six layers (L1 Business → L6 Operations). On-prem, single-tenant.

## Status

Pre-product. v1 design locked in LSDS-research. 60-day demo target.

## Architecture

```
┌──────────────────────────────────────────┐
│  GUI / Agent API                         │
├──────────────────────────────────────────┤
│  Core Application                        │
│  persistence, search, versioning,        │
│  agent orchestration, user management    │
├──────────────────────────────────────────┤
│  Framework                               │
│  type registry, layer model,             │
│  relationship rules, guardrail engine,   │
│  traversal algebra, change propagation   │
└──────────────────────────────────────────┘
```

## License

Business Source License 1.1. Change date 2030-04-26 → Apache 2.0. See [`LICENSE`](./LICENSE).
