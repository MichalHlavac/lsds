// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { Sql } from "../db/client.js";
import { logger } from "../logger.js";

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  readonly dimensions: number;
}

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1536;

  constructor(private readonly apiKey: string) {}

  async embed(text: string): Promise<number[]> {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI embeddings API ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { data: [{ embedding: number[] }] };
    return data.data[0].embedding;
  }
}

class StubEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1536;

  async embed(_text: string): Promise<number[]> {
    // pgvector returns NULL for cosine distance between zero vectors → use 1 instead
    return new Array(1536).fill(1) as number[];
  }
}

export function createEmbeddingProvider(): EmbeddingProvider | null {
  const provider = process.env["EMBEDDING_PROVIDER"];
  if (!provider || provider === "disabled") return null;
  if (provider === "stub") return new StubEmbeddingProvider();
  if (provider === "openai") {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) throw new Error("OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai");
    return new OpenAIEmbeddingProvider(apiKey);
  }
  throw new Error(`Unknown EMBEDDING_PROVIDER: ${provider}`);
}

export class EmbeddingService {
  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly sql: Sql
  ) {}

  nodeText(node: {
    type: string;
    layer: string;
    name: string;
    attributes: Record<string, unknown>;
  }): string {
    const attrs = Object.entries(node.attributes);
    const attrsStr =
      attrs.length > 0
        ? ". " + attrs.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")
        : "";
    return `${node.type} ${node.layer} ${node.name}${attrsStr}`;
  }

  // Fire-and-forget — does not block the HTTP response.
  embedNodeAsync(tenantId: string, nodeId: string, text: string): void {
    this._storeEmbedding(tenantId, nodeId, text).catch((err) => {
      logger.error({ nodeId, err }, "failed to embed node");
    });
  }

  private async _storeEmbedding(tenantId: string, nodeId: string, text: string): Promise<void> {
    const vector = await this.provider.embed(text);
    const literal = `[${vector.join(",")}]`;
    await this.sql`
      UPDATE nodes SET embedding = ${literal}::vector
      WHERE id = ${nodeId} AND tenant_id = ${tenantId}
    `;
  }

  async embedQuery(text: string): Promise<string> {
    const vector = await this.provider.embed(text);
    return `[${vector.join(",")}]`;
  }
}
