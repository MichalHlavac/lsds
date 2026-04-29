# LSDS — Layered Software Documentation System

A typed knowledge graph SSOT for software knowledge across six layers (L1 Business → L6 Operations). On-prem, single-tenant.

## Status

Pre-product. v1 design locked in LSDS-research. 60-day demo target.

> **Experimental:** This project is being developed experimentally using [Paperclip](https://paperclip.ing) — an AI agent orchestration platform. Development is driven by a team of autonomous AI agents working 24/7.

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

## Running with Docker

```bash
cp .env.example .env          # adjust credentials if needed
docker compose up --build
```

The API is available at `http://localhost:3000`. Postgres data is persisted in a named volume (`db_data`). Migrations run automatically before the API starts.

To run migrations manually:

```bash
docker compose run --rm migrate
```

## Development (without Docker)

```bash
pnpm install
# requires a local Postgres; set DATABASE_URL or use defaults: postgres://lsds:lsds@localhost:5432/lsds
pnpm --filter @lsds/api run migrate
pnpm dev
```

## License

Business Source License 1.1. Change date 2030-04-26 → Apache 2.0. See [`LICENSE`](./LICENSE).
