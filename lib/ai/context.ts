import type { LensGraph, LensNode, Workflow } from "../graph";

const ASSET_LIMIT = 30;
const WORKFLOW_LIMIT = 12;
const STEP_LIMIT = 6;
const normalize = (value: string) =>
  value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
const compact = (value: string | null | undefined, limit = 220) =>
  (value ?? "").slice(0, limit);

function pairs(value: string) {
  const result = new Set<string>();
  for (const part of normalize(value).match(/[\p{L}\p{N}]+/gu) ?? []) {
    for (let index = 0; index < part.length - 1; index++) {
      result.add(part.slice(index, index + 2));
    }
  }
  return result;
}

// Retrieval ranks reference candidates; it never confirms their identity or a handoff.
export function buildExtractionContext(
  graph: LensGraph,
  current: Workflow,
  source: string,
) {
  const text = normalize(source);
  const queryPairs = pairs(source);
  const mentioned = (value: string) => {
    const name = normalize(value);
    return name.length > 1 && text.includes(name);
  };
  const overlap = (value: string) => {
    const candidate = pairs(value);
    let matches = 0;
    for (const pair of candidate) if (queryPairs.has(pair)) matches++;
    return candidate.size ? matches / candidate.size : 0;
  };
  const nameScore = (label: string, aliases: string[] = []) =>
    Math.max(
      0,
      ...[label, ...aliases].map((name) =>
        mentioned(name) ? 100 + Math.min(normalize(name).length, 40) : 0,
      ),
    );
  const scenario = current.scenario ?? "current";
  const inScope = new Set(
    graph.workflows
      .filter(
        (w) =>
          (w.scenario ?? "current") === scenario ||
          w.id === current.basedOnWorkflowId,
      )
      .map((w) => w.id),
  );
  const workflowNames = new Map(graph.workflows.map((w) => [w.id, w.name]));
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const processesByWorkflow = new Map<string, LensNode[]>();
  const usage = new Map<string, Set<string>>();
  const dataByProcess = new Map<
    string,
    Array<{ name: string; operation: string }>
  >();
  for (const node of graph.nodes) {
    if (node.kind !== "process" || !node.workflowId) continue;
    const steps = processesByWorkflow.get(node.workflowId) ?? [];
    steps.push(node);
    processesByWorkflow.set(node.workflowId, steps);
  }
  const addUsage = (nodeId: string, workflowIds: string[]) => {
    const ids = usage.get(nodeId) ?? new Set<string>();
    for (const id of workflowIds) ids.add(id);
    usage.set(nodeId, ids);
  };
  for (const edge of graph.edges) {
    addUsage(edge.source, edge.workflowIds);
    addUsage(edge.target, edge.workflowIds);
    const process = nodesById.get(edge.source);
    const data = nodesById.get(edge.target);
    if (process?.kind === "process" && data?.kind === "data") {
      const records = dataByProcess.get(process.id) ?? [];
      records.push({
        name: data.label,
        operation: edge.label ?? edge.relation,
      });
      dataByProcess.set(process.id, records);
    }
  }
  for (const flow of graph.dataFlows ?? []) {
    for (const id of [
      flow.sourceSystemId,
      flow.targetSystemId,
      ...flow.dataIds,
    ]) {
      addUsage(id, flow.workflowIds);
    }
  }
  const sharedScore = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.kind === "process" || !nameScore(node.label, node.aliases))
      continue;
    for (const id of usage.get(node.id) ?? []) {
      if (!inScope.has(id)) continue;
      sharedScore.set(
        id,
        (sharedScore.get(id) ?? 0) + (node.kind === "data" ? 8 : 2),
      );
    }
  }
  const workflows = graph.workflows
    .filter((w) => w.id !== current.id && inScope.has(w.id))
    .map((w, index) => {
      const steps = processesByWorkflow.get(w.id) ?? [];
      return {
        workflow: w,
        index,
        score:
          nameScore(w.name) * 2 +
          (w.id === current.basedOnWorkflowId ? 200 : 0) +
          (sharedScore.get(w.id) ?? 0) +
          overlap(
            `${w.name} ${w.summary ?? ""} ${w.trigger ?? ""} ${w.outcome ?? ""}`,
          ) *
            5 +
          Math.max(
            0,
            ...steps.map((s) =>
              overlap(`${s.label} ${s.meaning?.result ?? ""}`),
            ),
          ) *
            4,
      };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, WORKFLOW_LIMIT);
  const selectedWorkflows = new Set(workflows.map((w) => w.workflow.id));
  selectedWorkflows.add(current.id);
  const assets = (kind: "system" | "data") =>
    graph.nodes
      .filter(
        (n) =>
          n.kind === kind &&
          (!usage.get(n.id)?.size ||
            [...usage.get(n.id)!].some((id) => inScope.has(id))),
      )
      .map((node, index) => ({
        node,
        index,
        score:
          nameScore(node.label, node.aliases) +
          ([...(usage.get(node.id) ?? [])].some((id) =>
            selectedWorkflows.has(id),
          )
            ? 10
            : 0) +
          overlap(`${node.label} ${node.description}`),
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, ASSET_LIMIT)
      .map(({ node }) => ({
        canonicalKey: node.canonicalKey,
        name: node.label,
        aliases: (node.aliases ?? []).slice(0, 8),
        status: node.status,
        description: compact(node.description),
        usedBy: [...(usage.get(node.id) ?? [])]
          .filter((id) => inScope.has(id))
          .sort(
            (a, b) =>
              Number(selectedWorkflows.has(b)) -
              Number(selectedWorkflows.has(a)),
          )
          .slice(0, 4)
          .map((id) => workflowNames.get(id) ?? id),
      }));
  return {
    scope: {
      scenario,
      selection:
        "入力本文と追加回答への関連度で選んだ参照候補。存在や一致は関係の確定根拠ではありません。",
      totalWorkflows: [...inScope].filter((id) => id !== current.id).length,
      includedWorkflows: workflows.length,
      omittedWorkflows: Math.max(
        0,
        [...inScope].filter((id) => id !== current.id).length -
          workflows.length,
      ),
    },
    systems: assets("system"),
    data: assets("data"),
    organization: {
      activities: (graph.knowledge?.activities ?? [])
        .slice(0, 30)
        .map((a) => ({
          name: a.name,
          capabilities: a.capabilities.slice(0, 20).map((c) => c.name),
          certainty: a.certainty ?? "unknown",
        })),
      systemCategories: (graph.knowledge?.categories ?? [])
        .slice(0, 30)
        .map((c) => ({ name: c.name, description: compact(c.description) })),
    },
    workflows: workflows.map(({ workflow: w }) => {
      const ordered = [...(processesByWorkflow.get(w.id) ?? [])].sort(
        (a, b) => (a.stepOrder ?? 0) - (b.stepOrder ?? 0),
      );
      const selected = [...ordered]
        .map((step, index) => ({
          step,
          index,
          score:
            overlap(`${step.label} ${step.meaning?.result ?? ""}`) * 5 +
            (index === 0 ? 4 : index === ordered.length - 1 ? 2 : 0),
        }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, STEP_LIMIT)
        .sort((a, b) => a.index - b.index);
      return {
        id: w.id,
        name: w.name,
        scenario: w.scenario ?? "current",
        description: compact(w.summary ?? w.description),
        trigger: compact(w.trigger),
        outcome: compact(w.outcome),
        totalSteps: ordered.length,
        steps: selected.map(({ step }) => ({
          stepKey: step.canonicalKey.split(":").at(-1),
          name: step.label,
          actor: step.actor ?? null,
          result: compact(step.meaning?.result, 140),
          data: (dataByProcess.get(step.id) ?? []).slice(0, 4),
          status: step.status,
        })),
      };
    }),
  };
}
