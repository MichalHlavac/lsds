-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Michal Hlavac. All rights reserved.
--
-- Migration 008: pgvector extension + embedding column + ivfflat index.
-- Requires: postgres image with the vector extension available (pgvector/pgvector:pg16).

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE nodes ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- ivfflat index for approximate nearest-neighbour cosine similarity.
-- Tune `lists` to sqrt(row_count) once the table has data.
CREATE INDEX IF NOT EXISTS idx_nodes_embedding
  ON nodes USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
