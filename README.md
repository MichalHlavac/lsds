# LSDS — Layered Software Documentation System

A typed knowledge graph SSOT for software knowledge across six layers (L1 Business → L6 Operations). On-prem, single-tenant.

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

## Backup and restore

Back up and restore the complete LSDS state (graph nodes, edges, lifecycle states, violations, snapshots, users, teams, guardrails).

```bash
# Backup — writes lsds-backup-<timestamp>.tar.gz to <out-dir>
DATABASE_URL=postgres://lsds:lsds@localhost:5432/lsds lsds backup /var/backups/lsds

# Restore — target database must have migrations applied; existing data will be truncated
DATABASE_URL=postgres://lsds:lsds@localhost:5432/lsds_restore lsds restore /var/backups/lsds/lsds-backup-2026-05-01T00-00-00.tar.gz
```

**Bundle contents:**

| File | Description |
|------|-------------|
| `manifest.json` | Schema version, timestamp, row counts, SHA-256 hashes |
| `dump.json` | Full table export (all rows, all columns) |

**Restore guards:**

- Aborts with a clear error if the target schema version does not match the bundle.
- Aborts with a clear error if the `dump.json` SHA-256 hash does not match the manifest.

## Diagnostics bundle

For support troubleshooting, generate a redacted diagnostics bundle:

```bash
# via pnpm (dev/local)
pnpm --filter @lsds/cli run dev diagnostics bundle --out /tmp

# via compiled binary
lsds diagnostics bundle --out /tmp
```

Options:

| Flag | Default | Description |
|------|---------|-------------|
| `-o, --out <dir>` | `.` | Output directory for the `.tar.gz` |
| `-d, --days <n>` | `7` | Include log files modified within the last N days |
| `--log-dir <dir>` | `/var/log/lsds` | Directory containing app `*.log` files |

The bundle contains:

- `system-info.json` — OS, Node.js version, CPU/memory
- `config.json` — process environment with secrets **redacted**: values for `*_KEY`, `*_SECRET`, `*_TOKEN`, `PASSWORD`, `DSN` keys are replaced with `<REDACTED>`; passwords embedded in `*_URL` connection strings are also stripped (e.g. `postgres://user:<REDACTED>@host/db`)
- `db-version.txt` + `schema-snapshot.json` — PostgreSQL version and public schema (requires `DATABASE_URL`)
- `logs/` — `*.log` files from `--log-dir` within the requested time window

No API keys, tokens, passwords, or DSN credentials are included. You can verify this by inspecting `config.json` inside the bundle before sharing it.

## License

Business Source License 1.1. Change date 2030-04-26 → Apache 2.0. See [`LICENSE`](./LICENSE).
