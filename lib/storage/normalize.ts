import {canonicalNodeId,canonicalDataFlowId} from "@/lib/graph";
import type {LensGraph,LensNode,LensEdge,NodeKind,SystemDataFlow,Workflow} from "@/lib/graph";

export function normalizeSnapshotGraph(graph: LensGraph): LensGraph {
  const workflowsById = new Map<string, Workflow>();
  for (const workflow of graph.workflows) {
    workflowsById.set(workflow.id, workflow);
  }

  const canonicalNodeByKey = new Map<string, LensNode>();
  const oldIdCandidates = new Map<string, LensNode[]>();

  for (const node of graph.nodes) {
    const normalized: LensNode = {
      ...node,
      id: canonicalNodeId(node.canonicalKey),
    };

    if (!canonicalNodeByKey.has(node.canonicalKey)) {
      canonicalNodeByKey.set(node.canonicalKey, normalized);
    }

    const candidates = oldIdCandidates.get(node.id) ?? [];
    candidates.push(normalized);
    oldIdCandidates.set(node.id, candidates);
  }

  const nodes = [...canonicalNodeByKey.values()];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const validNodeIds = new Set(nodeById.keys());

  const resolveLegacyId = (
    oldId: string,
    expectedKind?: NodeKind,
    workflowIds: string[] = [],
  ) => {
    const candidates = oldIdCandidates.get(oldId) ?? [];

    if (candidates.length === 0) {
      return validNodeIds.has(oldId) ? oldId : undefined;
    }

    if (candidates.length === 1) return candidates[0].id;

    let narrowed = candidates;

    if (expectedKind) {
      const kindMatches = narrowed.filter((node) => node.kind === expectedKind);
      if (kindMatches.length > 0) narrowed = kindMatches;
    }

    const workflowMatches = narrowed.filter(
      (node) =>
        node.kind !== "process" ||
        (node.workflowId && workflowIds.includes(node.workflowId)),
    );
    if (workflowMatches.length > 0) narrowed = workflowMatches;

    // Old versions ASCII-sanitized node IDs, so multiple Japanese
    // canonical keys could share one ID. At this point that original
    // endpoint is fundamentally ambiguous. Pick deterministically so
    // persistence can heal IDs; the edited workflow is rebuilt from its
    // review on apply, restoring its exact relationships.
    return [...narrowed].sort((a, b) =>
      a.canonicalKey.localeCompare(b.canonicalKey),
    )[0]?.id;
  };

  const edgeById = new Map<string, LensEdge>();

  for (const edge of graph.edges) {
    const sourceKind: NodeKind | undefined =
      edge.relation === "next"
        ? "process"
        : edge.relation === "executes"
          ? "system"
          : undefined;
    const targetKind: NodeKind | undefined =
      edge.relation === "next" || edge.relation === "executes"
        ? "process"
        : edge.relation === "uses"
          ? "system"
          : edge.relation === "reads" || edge.relation === "writes"
            ? "data"
            : undefined;

    const source = resolveLegacyId(edge.source, sourceKind, edge.workflowIds);
    const target = resolveLegacyId(edge.target, targetKind, edge.workflowIds);

    if (!source || !target) continue;
    if (!validNodeIds.has(source) || !validNodeIds.has(target)) continue;

    const baseId = `${source}--${edge.relation}--${target}`;
    const separateCondition = edge.relation==='next' && (edge.id.includes('--condition:') || edgeById.has(baseId) && edgeById.get(baseId)?.label!==edge.label);
    const id=baseId+(separateCondition?`--condition:${encodeURIComponent(edge.label??'')}`:'');
    const existing = edgeById.get(id);

    if (existing) {
      existing.workflowIds = [
        ...new Set([...existing.workflowIds, ...edge.workflowIds]),
      ];
      if (!existing.label && edge.label) existing.label = edge.label;
      continue;
    }

    edgeById.set(id, {
      ...edge,
      id,
      source,
      target,
      workflowIds: [...new Set(edge.workflowIds)],
    });
  }

  const flowById = new Map<string, SystemDataFlow>();

  for (const flow of graph.dataFlows ?? []) {
    const sourceSystemId = resolveLegacyId(
      flow.sourceSystemId,
      "system",
      flow.workflowIds,
    );
    const targetSystemId = resolveLegacyId(
      flow.targetSystemId,
      "system",
      flow.workflowIds,
    );

    if (!sourceSystemId || !targetSystemId) continue;

    const dataIds = [
      ...new Set(
        flow.dataIds
          .map((id) => resolveLegacyId(id, "data", flow.workflowIds))
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const processIds = [
      ...new Set(
        flow.processIds
          .map((id) => resolveLegacyId(id, "process", flow.workflowIds))
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const id = canonicalDataFlowId({...flow,sourceSystemId,targetSystemId,dataIds});

    const existing = flowById.get(id);
    if (existing) {
      existing.workflowIds = [
        ...new Set([...existing.workflowIds, ...flow.workflowIds]),
      ];
      existing.processIds = [
        ...new Set([...existing.processIds, ...processIds]),
      ];
      continue;
    }

    flowById.set(id, {
      ...flow,
      id,
      sourceSystemId,
      targetSystemId,
      dataIds,
      processIds,
      workflowIds: [...new Set(flow.workflowIds)],
    });
  }

  return {
    workflows: [...workflowsById.values()].map(w => w.landscape ? {
      ...w,
      landscape: {
        ...w.landscape,
        materialHandoffs: w.landscape.materialHandoffs.map(h => ({
          ...h,
          dataIds: [...new Set(h.dataIds.map(id => resolveLegacyId(id, "data", [w.id, h.targetWorkflowId]) ?? id))],
        })),
      },
    } : w),
    knowledge: graph.knowledge ? {
      ...graph.knowledge,
      systems: graph.knowledge.systems.map(s => ({ ...s,
        systemId: resolveLegacyId(s.systemId, "system") ?? s.systemId,
        dependsOn: s.dependsOn.map(d => ({ ...d, systemId: resolveLegacyId(d.systemId, "system") ?? d.systemId })),
      })),
      handoffs: graph.knowledge.handoffs?.map(h => ({ ...h,
        ...(h.sourceProcessId ? {sourceProcessId:resolveLegacyId(h.sourceProcessId,'process',[h.sourceWorkflowId])??h.sourceProcessId} : {}),
        ...(h.targetProcessId ? {targetProcessId:resolveLegacyId(h.targetProcessId,'process',[h.targetWorkflowId])??h.targetProcessId} : {}),
        dataIds: h.dataIds.map(id => resolveLegacyId(id, "data", [h.sourceWorkflowId, h.targetWorkflowId]) ?? id),
      })),
    } : undefined,
    nodes,
    edges: [...edgeById.values()],
    dataFlows: [...flowById.values()],
  };
}
