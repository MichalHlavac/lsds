-- LSDS Core Application — initial schema (kap. 8)
-- nodes / edges / violations / snapshots / users / teams / guardrails
-- tenant_id on every table (A6)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── nodes ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nodes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL,
  type             TEXT        NOT NULL CHECK (char_length(type) > 0),
  layer            TEXT        NOT NULL CHECK (layer IN ('L1','L2','L3','L4','L5','L6')),
  name             TEXT        NOT NULL CHECK (char_length(name) > 0),
  version          TEXT        NOT NULL DEFAULT '0.1.0',
  lifecycle_status TEXT        NOT NULL DEFAULT 'ACTIVE'
                               CHECK (lifecycle_status IN ('ACTIVE','DEPRECATED','ARCHIVED','PURGE')),
  attributes       JSONB       NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deprecated_at    TIMESTAMPTZ,
  archived_at      TIMESTAMPTZ,
  purge_after      TIMESTAMPTZ
);

-- ── edges ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edges (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL,
  source_id        UUID        NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_id        UUID        NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  type             TEXT        NOT NULL CHECK (char_length(type) > 0),
  layer            TEXT        NOT NULL CHECK (layer IN ('L1','L2','L3','L4','L5','L6')),
  traversal_weight FLOAT       NOT NULL DEFAULT 1.0 CHECK (traversal_weight > 0),
  attributes       JSONB       NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── violations ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS violations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL,
  node_id     UUID        REFERENCES nodes(id) ON DELETE SET NULL,
  edge_id     UUID        REFERENCES edges(id) ON DELETE SET NULL,
  rule_key    TEXT        NOT NULL CHECK (char_length(rule_key) > 0),
  severity    TEXT        NOT NULL CHECK (severity IN ('ERROR','WARN','INFO')),
  message     TEXT        NOT NULL,
  attributes  JSONB       NOT NULL DEFAULT '{}',
  resolved    BOOLEAN     NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── snapshots ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS snapshots (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL,
  label         TEXT        NOT NULL DEFAULT '',
  node_count    INTEGER     NOT NULL DEFAULT 0,
  edge_count    INTEGER     NOT NULL DEFAULT 0,
  snapshot_data JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── users ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL,
  external_id  TEXT        NOT NULL,
  display_name TEXT        NOT NULL,
  email        TEXT,
  role         TEXT        NOT NULL DEFAULT 'viewer'
                           CHECK (role IN ('admin','editor','viewer')),
  attributes   JSONB       NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_id)
);

-- ── teams ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID        NOT NULL,
  name       TEXT        NOT NULL,
  attributes JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id)
);

-- ── guardrails ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guardrails (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL,
  rule_key    TEXT        NOT NULL CHECK (char_length(rule_key) > 0),
  description TEXT        NOT NULL DEFAULT '',
  severity    TEXT        NOT NULL CHECK (severity IN ('ERROR','WARN','INFO')),
  enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
  config      JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, rule_key)
);

-- ── updated_at triggers ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER nodes_updated_at BEFORE UPDATE ON nodes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER edges_updated_at BEFORE UPDATE ON edges FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER violations_updated_at BEFORE UPDATE ON violations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER teams_updated_at BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER guardrails_updated_at BEFORE UPDATE ON guardrails FOR EACH ROW EXECUTE FUNCTION set_updated_at();
