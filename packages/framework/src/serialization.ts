// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

// Canonical NDJSON wire format for graph export/import.
//
// The application/persistence layer MUST use the helpers in this module
// when serializing or parsing NDJSON. Hand-rolling the JSON shape inside
// route handlers (as `apps/api/src/routes/export.ts` did before LSDS-761)
// silently drifts from the framework's TknBaseSchema / RelationshipEdge
// definitions: fields added to the framework are dropped on the wire and
// malformed payloads pass import validation.
//
// The wire shape is published once here and locked by:
//   * `NdjsonNodeSchema` / `NdjsonEdgeSchema` — strict Zod definitions of the
//     record shape (one record per NDJSON line).
//   * `serializeNode` / `serializeEdge` — projection helpers that take a
//     framework-shaped input and produce a canonical wire record.
//   * `parseNodeRecord` / `parseEdgeRecord` — re-validate a single line.
//   * Drift-guard tests in `tests/serialization.test.ts` that fail when a
//     new TknBase or RelationshipEdge field is added without a matching
//     wire-format update.
//
// Discriminator field is `kind` ("node" | "edge"). The record's `type`
// field carries the framework type name (e.g. "BusinessGoal", "realizes")
// — it is intentionally NOT renamed to `nodeType` / `edgeType` so the wire
// shape mirrors the framework Zod schemas one-to-one.

import { z } from "zod";
import { LayerIdSchema } from "./layer/index.js";
import { LifecycleSchema } from "./lifecycle.js";
import { RelationshipTypeSchema } from "./relationship/types.js";
import { TknBaseSchema, type TknBase } from "./shared/base.js";
import { SemverSchema, TeamRefSchema, UuidSchema } from "./shared/refs.js";

// ──────────────────────────────────────────────────────────────────────────────
// Wire schemas — strict, append-only. Adding a field is a MINOR change;
// removing or renaming a field is MAJOR and requires a migration plan.
// ──────────────────────────────────────────────────────────────────────────────

const IsoDatetimeSchema = z.string().datetime({ offset: true });

export const NdjsonNodeSchema = z
  .object({
    kind: z.literal("node"),
    id: UuidSchema,
    type: z.string().min(1),
    layer: LayerIdSchema,
    name: z.string().min(1),
    version: SemverSchema,
    lifecycle: LifecycleSchema,
    owner: TeamRefSchema,
    createdAt: IsoDatetimeSchema,
    updatedAt: IsoDatetimeSchema,
    attributes: z.record(z.unknown()),
  })
  .strict();
export type NdjsonNodeRecord = z.infer<typeof NdjsonNodeSchema>;

export const NdjsonEdgeSchema = z
  .object({
    kind: z.literal("edge"),
    id: UuidSchema,
    type: RelationshipTypeSchema,
    sourceId: UuidSchema,
    targetId: UuidSchema,
    sourceLayer: LayerIdSchema,
    targetLayer: LayerIdSchema,
    traversalWeight: z.number().positive(),
    lifecycle: LifecycleSchema,
    attributes: z.record(z.unknown()),
    createdAt: IsoDatetimeSchema,
    updatedAt: IsoDatetimeSchema,
  })
  .strict();
export type NdjsonEdgeRecord = z.infer<typeof NdjsonEdgeSchema>;

export const NdjsonRecordSchema = z.discriminatedUnion("kind", [
  NdjsonNodeSchema,
  NdjsonEdgeSchema,
]);
export type NdjsonRecord = z.infer<typeof NdjsonRecordSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// Drift-guard surfaces — kept in source so the test can assert coverage
// without re-encoding the framework schema. Add a key here with a short
// reason if a base field is intentionally dropped from the wire format.
// ──────────────────────────────────────────────────────────────────────────────

// TknBaseSchema fields that the wire format intentionally does NOT surface
// at the top level. Should normally be empty — every base field belongs on
// the wire. Whitelisting requires a documented reason in the comment.
export const WIRE_OMITTED_NODE_BASE_FIELDS: ReadonlySet<string> = new Set<string>([]);

// RelationshipEdgeSchema fields renamed/dropped on the wire.
// `sourceTknId` / `targetTknId` map to wire `sourceId` / `targetId`.
export const WIRE_OMITTED_EDGE_FIELDS: ReadonlySet<string> = new Set<string>([
  "sourceTknId",
  "targetTknId",
]);

// ──────────────────────────────────────────────────────────────────────────────
// Serializer input shapes — accept framework Node/Edge values plus a few
// pragmatic concessions (Date objects for timestamps, .passthrough() so
// type-specific extension fields are preserved into `attributes`).
// ──────────────────────────────────────────────────────────────────────────────

const DateLikeSchema = z
  .union([z.string(), z.date()])
  .transform((v) => (typeof v === "string" ? v : v.toISOString()));

export const SerializableNodeInputSchema = TknBaseSchema.extend({
  attributes: z.record(z.unknown()).optional().default({}),
  createdAt: DateLikeSchema,
  updatedAt: DateLikeSchema,
}).passthrough();
export type SerializableNodeInput = z.input<typeof SerializableNodeInputSchema>;

export const SerializableEdgeInputSchema = z
  .object({
    id: UuidSchema,
    type: RelationshipTypeSchema,
    sourceId: UuidSchema,
    targetId: UuidSchema,
    sourceLayer: LayerIdSchema,
    targetLayer: LayerIdSchema,
    traversalWeight: z.number().positive(),
    lifecycle: LifecycleSchema,
    attributes: z.record(z.unknown()).optional().default({}),
    createdAt: DateLikeSchema,
    updatedAt: DateLikeSchema,
  })
  .strict();
export type SerializableEdgeInput = z.input<typeof SerializableEdgeInputSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// Serializers — project framework input → canonical wire record.
// ──────────────────────────────────────────────────────────────────────────────

const NODE_BASE_KEYS = new Set<keyof TknBase | "attributes">([
  "id",
  "type",
  "layer",
  "name",
  "version",
  "lifecycle",
  "owner",
  "createdAt",
  "updatedAt",
  "attributes",
]);

export function serializeNode(input: SerializableNodeInput): NdjsonNodeRecord {
  const parsed = SerializableNodeInputSchema.parse(input);
  // `attributes` already defaulted to {} by Zod; merge type-specific
  // extension fields (anything beyond TknBase) on top so the wire record
  // never loses them silently.
  const merged: Record<string, unknown> = { ...(parsed.attributes ?? {}) };
  for (const [key, value] of Object.entries(parsed)) {
    if (NODE_BASE_KEYS.has(key as keyof TknBase | "attributes")) continue;
    merged[key] = value;
  }
  return NdjsonNodeSchema.parse({
    kind: "node",
    id: parsed.id,
    type: parsed.type,
    layer: parsed.layer,
    name: parsed.name,
    version: parsed.version,
    lifecycle: parsed.lifecycle,
    owner: parsed.owner,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    attributes: merged,
  });
}

export function serializeEdge(input: SerializableEdgeInput): NdjsonEdgeRecord {
  const parsed = SerializableEdgeInputSchema.parse(input);
  return NdjsonEdgeSchema.parse({
    kind: "edge",
    id: parsed.id,
    type: parsed.type,
    sourceId: parsed.sourceId,
    targetId: parsed.targetId,
    sourceLayer: parsed.sourceLayer,
    targetLayer: parsed.targetLayer,
    traversalWeight: parsed.traversalWeight,
    lifecycle: parsed.lifecycle,
    attributes: parsed.attributes,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Parsers — re-validate a single NDJSON line.
// ──────────────────────────────────────────────────────────────────────────────

export class NdjsonParseError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "NdjsonParseError";
    this.cause = cause;
  }
}

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch (err) {
    throw new NdjsonParseError(
      `failed to parse NDJSON line as JSON: ${(err as Error).message}`,
      err,
    );
  }
}

export function parseNodeRecord(line: string): NdjsonNodeRecord {
  return NdjsonNodeSchema.parse(parseJsonLine(line));
}

export function parseEdgeRecord(line: string): NdjsonEdgeRecord {
  return NdjsonEdgeSchema.parse(parseJsonLine(line));
}

export function parseRecord(line: string): NdjsonRecord {
  return NdjsonRecordSchema.parse(parseJsonLine(line));
}
