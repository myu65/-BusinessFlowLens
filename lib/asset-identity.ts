import type { LensGraph } from "./graph";

export function normalizeAssetName(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\s_-]+/g, "");
}
export function findConfirmedAsset(graph: LensGraph, kind: "system" | "data", name: string) {
  const matches = graph.nodes.filter(node => node.kind === kind && [node.label, ...(node.aliases ?? [])].some(label => normalizeAssetName(label) === normalizeAssetName(name)));
  return matches.length === 1 ? matches[0] : undefined;
}
