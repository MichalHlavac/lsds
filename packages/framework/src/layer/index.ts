import { z } from "zod";

export const LAYER_IDS = ["L1", "L2", "L3", "L4", "L5", "L6"] as const;
export const LayerIdSchema = z.enum(LAYER_IDS);
export type LayerId = z.infer<typeof LayerIdSchema>;

export const CHANGE_POLICIES = [
  "REQUIRE_CONFIRMATION",
  "AUTO_WITH_OVERRIDE",
  "AUTO",
] as const;
export const ChangePolicySchema = z.enum(CHANGE_POLICIES);
export type ChangePolicy = z.infer<typeof ChangePolicySchema>;

export interface Layer {
  readonly id: LayerId;
  readonly ordinal: number;
  readonly name: string;
  readonly changePolicy: ChangePolicy;
}

export const LAYERS: ReadonlyArray<Layer> = [
  { id: "L1", ordinal: 1, name: "Business", changePolicy: "REQUIRE_CONFIRMATION" },
  { id: "L2", ordinal: 2, name: "Domain", changePolicy: "REQUIRE_CONFIRMATION" },
  { id: "L3", ordinal: 3, name: "Architecture", changePolicy: "AUTO_WITH_OVERRIDE" },
  { id: "L4", ordinal: 4, name: "Application", changePolicy: "AUTO_WITH_OVERRIDE" },
  { id: "L5", ordinal: 5, name: "Implementation", changePolicy: "AUTO" },
  { id: "L6", ordinal: 6, name: "Operations", changePolicy: "AUTO" },
];

const LAYERS_BY_ID = new Map<LayerId, Layer>(LAYERS.map((l) => [l.id, l]));

export function getLayer(id: LayerId): Layer {
  const layer = LAYERS_BY_ID.get(id);
  if (!layer) throw new Error(`unknown layer id: ${id}`);
  return layer;
}

export function getLayerOrdinal(id: LayerId): number {
  return getLayer(id).ordinal;
}

export function getChangePolicy(id: LayerId): ChangePolicy {
  return getLayer(id).changePolicy;
}
