import type { LensGraph, LensNode, Workflow } from "../graph";
import { normalizeAssetName } from "../refinement";

export type AssetMention = {
  candidateId: string;
  kind: "system" | "data";
  name: string;
  evidence: string[];
};
const LIMIT = 60;
const PER_MENTION = 6;
const compact = (value: string, length = 180) => value.slice(0, length);
const pairs = (value: string) => {
  const normalized = normalizeAssetName(value);
  return new Set(
    Array.from({ length: Math.max(0, normalized.length - 1) }, (_, i) =>
      normalized.slice(i, i + 2),
    ),
  );
};

// Shared assets with no recorded use remain available. Future-only uses do not
// become evidence for a current input; an explicit baseline may be consulted.
export function scopedAssetNodes(graph: LensGraph, workflow: Workflow) {
  const scope = new Set(
    graph.workflows
      .filter(w =>
        (w.scenario ?? "current") === (workflow.scenario ?? "current") ||
        w.id === workflow.basedOnWorkflowId,
      )
      .map(w => w.id),
  );
  scope.add(workflow.id);
  const usage = new Map<string, Set<string>>();
  const use = (id: string, workflows: string[]) => {
    const ids = usage.get(id) ?? new Set<string>();
    workflows.forEach(w => ids.add(w));
    usage.set(id, ids);
  };
  graph.edges.forEach(e => {
    use(e.source, e.workflowIds);
    use(e.target, e.workflowIds);
  });
  graph.dataFlows.forEach(f =>
    [f.sourceSystemId, f.targetSystemId, ...f.dataIds].forEach(id => use(id, f.workflowIds)),
  );
  graph.knowledge?.handoffs?.forEach(h =>
    h.dataIds.forEach(id => use(id, [h.sourceWorkflowId, h.targetWorkflowId])),
  );
  return graph.nodes.filter(n =>
    n.kind !== "process" &&
    (!usage.get(n.id)?.size || [...usage.get(n.id)!].some(id => scope.has(id))),
  );
}

// Retrieval only narrows the comparison. It never confirms identity. Matching
// labels and ambiguous aliases are ranked before similar descriptions, even
// when the relevant asset was added late in a large company.
export function buildAssetResolutionContext(
  nodes: LensNode[],
  mentions: AssetMention[],
) {
  const prepared = nodes.map((node, index) => ({
    node, index,
    pairs: pairs(`${node.label} ${(node.aliases ?? []).join(" ")} ${node.description}`),
  }));
  const ranked = mentions.map(mention => {
    const name = normalizeAssetName(mention.name);
    const query = pairs(`${mention.name} ${mention.evidence.join(" ")}`);
    return prepared
      .filter(p => p.node.kind === mention.kind)
      .map(p => {
        const names = [p.node.label, ...(p.node.aliases ?? [])].map(normalizeAssetName);
        const exact = names.includes(name);
        let overlap = 0;
        p.pairs.forEach(pair => { if (query.has(pair)) overlap++; });
        const partial = names.some(n =>
          n.length > 1 && (name.includes(n) || n.includes(name)),
        );
        return {
          ...p,
          score: (exact ? 1000 : 0) + (partial ? 100 : 0) +
            overlap / Math.max(1, p.pairs.size),
        };
      })
      .filter(p => p.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, PER_MENTION);
  });
  const chosen = new Map<string, LensNode>();
  // Round-robin selection gives each mention a comparison before second choices.
  for (let rank = 0; rank < PER_MENTION; rank++) {
    for (const candidates of ranked) {
      const node = candidates[rank]?.node;
      if (node && chosen.size < LIMIT) chosen.set(node.canonicalKey, node);
    }
  }
  return {
    scope: {
      totalAssets: nodes.length, includedAssets: chosen.size, limit: LIMIT,
      selection: "Retrieved reference candidates, not proof of identity. Omitted assets may still be relevant.",
    },
    catalog: [...chosen.values()].map(node => ({
      canonicalKey: node.canonicalKey, kind: node.kind, label: node.label,
      aliases: (node.aliases ?? []).slice(0, 8), status: node.status,
      description: compact(node.description),
    })),
    candidates: mentions.map((mention, i) => ({
      ...mention, evidence: mention.evidence.slice(0, 3).map(e => compact(e)),
      comparisonKeys: ranked[i].filter(p => chosen.has(p.node.canonicalKey)).map(p => p.node.canonicalKey),
    })),
  };
}
