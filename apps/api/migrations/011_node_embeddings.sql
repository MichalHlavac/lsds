-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Michal Hlavac. All rights reserved.
--
-- Migration 010: node_embeddings table — per-node, per-model vector storage.
-- Tracks which model produced each embedding so multiple providers can coexist.
-- The embedding column added to nodes in migration 008 remains for legacy paths.
-- ON DELETE CASCADE: removing a node automatically removes its embeddings.

CREATE TABLE IF NOT EXISTS node_embeddings (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id     UUID        NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  tenant_id   TEXT        NOT NULL,
  model       TEXT        NOT NULL,
  embedding   vector(1536) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (node_id, model)
);

CREATE INDEX IF NOT EXISTS idx_node_embeddings_tenant
  ON node_embeddings (tenant_id);

-- ivfflat index for approximate nearest-neighbour cosine similarity.
-- Tune `lists` to sqrt(row_count) once the table has meaningful data.
CREATE INDEX IF NOT EXISTS idx_node_embeddings_embedding
  ON node_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
