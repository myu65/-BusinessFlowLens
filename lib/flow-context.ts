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
  const byId = new Map(steps.map((s) => [s.id, s]));
  const outgoing = graph.edges
    .filter(
      (e) =>
        e.relation === "next" &&
        e.source === stepId &&
        e.workflowIds.includes(workflowId) &&
        byId.has(e.target),
    )
    .map((edge) => ({ edge, step: byId.get(edge.target)! }));
  const incoming = graph.edges
    .filter(
      (e) =>
        e.relation === "next" &&
        e.target === stepId &&
        e.workflowIds.includes(workflowId) &&
        byId.has(e.source),
    )
    .map((edge) => ({ edge, step: byId.get(edge.source)! }));
  const links = step ? getProcessAssetLinks(graph, step.id) : [];
  const unique = (nodes: LensNode[]) => [
    ...new Map(nodes.map((n) => [n.id, n])).values(),
  ];
  return {
    steps,
    step,
    index,
    previous: incoming.length === 1 ? incoming[0].step : undefined,
    next:
      outgoing.length === 1 && !step?.meaning?.halt
        ? outgoing[0].step
        : undefined,
    outgoing,
    incoming,
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

export type FlowJourney = {
  workflowId: string;
  stepId?: string;
  dataId?: string;
  trail: Array<{
    workflowId: string;
    stepId: string;
    dataId?: string;
    description: string;
    evidence: string;
  }>;
  entryKnown: boolean;
};
export type WorkflowHandoff = NonNullable<
  NonNullable<LensGraph["knowledge"]>["handoffs"]
>[number];
export function handoffEntry(
  graph: LensGraph,
  handoff: WorkflowHandoff,
  preferredDataId?: string,
) {
  const dataId =
    preferredDataId && handoff.dataIds.includes(preferredDataId)
      ? preferredDataId
      : handoff.dataIds[0];
  const steps = getWorkflowProcesses(graph, handoff.targetWorkflowId);
  const specified = steps.find((s) => s.id === handoff.targetProcessId);
  const receivers = dataId
    ? steps.filter((s) =>
        getProcessAssetLinks(graph, s.id).some(
          (l) => l.asset.id === dataId && l.relation === "reads",
        ),
      )
    : [];
  return {
    stepId:
      specified?.id ?? (receivers.length === 1 ? receivers[0].id : undefined),
    dataId,
    entryKnown: !!specified || receivers.length === 1,
  };
}

export function handoffJourney(
  graph: LensGraph,
  handoff: WorkflowHandoff,
  fromWorkflowId: string,
  fromStepId: string,
  previous?: FlowJourney,
  preferredDataId?: string,
): FlowJourney {
  const forward = handoff.sourceWorkflowId === fromWorkflowId;
  const entry = forward
    ? handoffEntry(graph, handoff, preferredDataId)
    : {
        stepId: handoff.sourceProcessId,
        dataId:
          preferredDataId && handoff.dataIds.includes(preferredDataId)
            ? preferredDataId
            : handoff.dataIds[0],
        entryKnown:
          !!handoff.sourceProcessId &&
          graph.nodes.some((n) => n.id === handoff.sourceProcessId),
      };
  return {
    workflowId: forward ? handoff.targetWorkflowId : handoff.sourceWorkflowId,
    ...entry,
    trail: [
      ...(previous?.workflowId === fromWorkflowId ? previous.trail : []),
      {
        workflowId: fromWorkflowId,
        stepId: fromStepId,
        dataId: entry.dataId,
        description: handoff.description,
        evidence: handoff.evidence,
      },
    ].slice(-10),
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
