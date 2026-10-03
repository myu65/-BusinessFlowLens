import {
  getProcessAssetLinks,
  getWorkflowProcesses,
  type LensGraph,
  type LensNode,
} from "./graph";

export function stepContext(
  graph: LensGraph,
  workflowId: string,
  stepId: string,
) {
  const steps = getWorkflowProcesses(graph, workflowId);
  const index = steps.findIndex((s) => s.id === stepId);
  const step = steps[index];
  const links = step ? getProcessAssetLinks(graph, step.id) : [];
  const unique = (nodes: LensNode[]) => [
    ...new Map(nodes.map((n) => [n.id, n])).values(),
  ];
  return {
    steps,
    step,
    index,
    previous: steps[index - 1],
    next: steps[index + 1],
    systems: unique(
      links.filter((l) => l.asset.kind === "system").map((l) => l.asset),
    ),
    inputs: unique(
      links
        .filter((l) => l.asset.kind === "data" && l.relation === "reads")
        .map((l) => l.asset),
    ),
    outputs: unique(
      links
        .filter(
          (l) =>
            l.asset.kind === "data" && ["writes", "sends"].includes(l.relation),
        )
        .map((l) => l.asset),
    ),
    transfers: graph.dataFlows.filter(
      (f) =>
        f.workflowIds.includes(workflowId) && f.processIds.includes(stepId),
    ),
    executingSystems: graph.edges
      .filter((e) => e.target === stepId && e.relation === "executes")
      .map((e) => graph.nodes.find((n) => n.id === e.source)!)
      .filter(Boolean),
  };
}

export function traceData(
  graph: LensGraph,
  workflowId: string,
  dataId: string,
) {
  return getWorkflowProcesses(graph, workflowId).flatMap((step) => {
    const context = stepContext(graph, workflowId, step.id);
    const operations = getProcessAssetLinks(graph, step.id)
      .filter((l) => l.asset.id === dataId)
      .map((l) => l.relation);
    const transfers = context.transfers.filter((f) =>
      f.dataIds.includes(dataId),
    );
    return operations.length || transfers.length
      ? [
          {
            step,
            operations: [...new Set(operations)],
            systems: context.systems,
            executingSystems: context.executingSystems,
            transfers,
          },
        ]
      : [];
  });
}

export function transferSteps(
  graph: LensGraph,
  flowId: string,
  workflowId?: string,
) {
  const flow = graph.dataFlows.find((f) => f.id === flowId);
  if (!flow) return [];
  return graph.nodes
    .filter(
      (n) =>
        n.kind === "process" &&
        flow.processIds.includes(n.id) &&
        flow.workflowIds.includes(n.workflowId!) &&
        (!workflowId || n.workflowId === workflowId),
    )
    .sort((a, b) => (a.stepOrder ?? 0) - (b.stepOrder ?? 0));
}
