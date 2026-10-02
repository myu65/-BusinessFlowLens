import { getWorkflowProcesses, type LensGraph, type WorkflowScenario } from "./graph";

export type OverviewScope = WorkflowScenario | "all";
export function buildOverview(graph: LensGraph, scope: OverviewScope) {
  const workflows = graph.workflows.filter(w => scope === "all" || (w.scenario ?? "current") === scope);
  const ids = new Set(workflows.map(w => w.id));
  const processes = graph.nodes.filter(n => n.kind === "process" && ids.has(n.workflowId ?? ""));
  const processMap = new Map(processes.map(n => [n.id, n]));
  const flows = graph.dataFlows.filter(f => f.workflowIds.some(id => ids.has(id)));
  const data = graph.nodes.filter(n => n.kind === "data").map(asset => {
    const usages = graph.edges.flatMap(edge => {
      if (!["reads", "writes", "sends", "uses"].includes(edge.relation)) return [];
      const process = processMap.get(edge.source === asset.id ? edge.target : edge.target === asset.id ? edge.source : "");
      if (!process || (edge.workflowIds.length && !edge.workflowIds.includes(process.workflowId!))) return [];
      return [{ process, relation: edge.relation, label: edge.label }];
    });
    const transfers = flows.filter(f => f.dataIds.includes(asset.id));
    const relatedIds = new Set([...usages.map(u => u.process.workflowId!), ...transfers.flatMap(f => f.workflowIds.filter(id => ids.has(id)))]);
    // A system used by a process is not evidence that it stores that process's data.
    const systemIds = new Set(transfers.flatMap(f => [f.sourceSystemId, f.targetSystemId]));
    const direct = graph.edges.filter(e => e.relation !== "next" && (e.source === asset.id || e.target === asset.id) && e.workflowIds.some(id => ids.has(id)) && graph.nodes.some(n => n.id === (e.source === asset.id ? e.target : e.source) && n.kind === "system"));
    for (const e of direct) {
      for (const id of e.workflowIds) if (ids.has(id)) relatedIds.add(id);
      const id = e.source === asset.id ? e.target : e.source;
      if (graph.nodes.some(n => n.id === id && n.kind === "system")) systemIds.add(id);
    }
    return { asset, usages, transfers, workflows: workflows.filter(w => relatedIds.has(w.id)), systems: graph.nodes.filter(n => n.kind === "system" && systemIds.has(n.id)), direct };
  }).filter(row => row.workflows.length).sort((a,b) => b.workflows.length - a.workflows.length || a.asset.label.localeCompare(b.asset.label, "ja"));
  const businesses = workflows.map(workflow => {
    const steps = getWorkflowProcesses(graph, workflow.id);
    return { workflow, steps, departments: [...new Set(steps.map(s => s.department || s.actor).filter(Boolean))], data: data.filter(d => d.workflows.some(w => w.id === workflow.id)) };
  });
  return { workflows, data, flows, businesses };
}
