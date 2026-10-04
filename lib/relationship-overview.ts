import type { Confidence, LensGraph } from "./graph";
import { inputSystemDependencies } from "./system-dependencies";

export type OverviewRelation = {
  id: string;
  source: string;
  target: string;
  kind: "handoff" | "transfer" | "dependency";
  certainty: Confidence;
  references: Array<{
    kind: "handoff" | "dataFlow" | "systemDependency";
    id?: string;
    workflowIds: string[];
    processIds: string[];
    dataIds: string[];
    evidence: string;
    description: string;
    certainty: Confidence;
    source: string;
    target: string;
    // Dependencies have a recorded pair, rather than a standalone relation ID.
    systemId?: string;
    prerequisiteId?: string;
  }>;
};

function addRelation(groups: Map<string, OverviewRelation>, source: string, target: string,
  kind: OverviewRelation["kind"], reference: OverviewRelation["references"][number]) {
  if (source === target) return;
  const id = JSON.stringify([kind, source, target]);
  const existing = groups.get(id);
  if (existing) {
    existing.references.push(reference);
    existing.certainty = existing.certainty === "unknown" || reference.certainty === "unknown" ? "unknown"
      : existing.certainty === "inferred" || reference.certainty === "inferred" ? "inferred" : "confirmed";
  } else groups.set(id, { id, source, target, kind, certainty: reference.certainty, references: [reference] });
}

// Read projections keep their original identities and evidence. Coordinates and
// the display budget belong to the UI, never to the saved knowledge graph.
export function activityRelationships(graph: LensGraph, workflowIds: readonly string[]) {
  const visible = new Set(workflowIds), activityFor = new Map<string, string>();
  for (const activity of graph.knowledge?.activities ?? [])
    for (const capability of activity.capabilities)
      for (const id of capability.workflowIds) activityFor.set(id, activity.id);
  const groups = new Map<string, OverviewRelation>();
  for (const handoff of graph.knowledge?.handoffs ?? []) {
    if (!visible.has(handoff.sourceWorkflowId) || !visible.has(handoff.targetWorkflowId)) continue;
    const source = activityFor.get(handoff.sourceWorkflowId), target = activityFor.get(handoff.targetWorkflowId);
    if (!source || !target) continue;
    addRelation(groups, source, target, "handoff", { kind: "handoff", id: handoff.id,
      source: handoff.sourceWorkflowId, target: handoff.targetWorkflowId,
      workflowIds: [handoff.sourceWorkflowId, handoff.targetWorkflowId], dataIds: [...handoff.dataIds],
      processIds: [handoff.sourceProcessId, handoff.targetProcessId].filter((id): id is string => !!id),
      evidence: handoff.evidence, description: handoff.description, certainty: handoff.status ?? "unknown" });
  }
  return [...groups.values()];
}

export function systemRelationships(graph: LensGraph, scope: "current" | "future" | "alternative",
  workflowIds: readonly string[], systemIds: readonly string[]) {
  const visible = new Set(workflowIds), systems = new Set(systemIds), groups = new Map<string, OverviewRelation>();
  for (const flow of graph.dataFlows) {
    const workflows = flow.workflowIds.filter(id => visible.has(id));
    if (!workflows.length || !systems.has(flow.sourceSystemId) || !systems.has(flow.targetSystemId)) continue;
    addRelation(groups, flow.sourceSystemId, flow.targetSystemId, "transfer", { kind: "dataFlow", id: flow.id,
      source: flow.sourceSystemId, target: flow.targetSystemId,
      workflowIds: workflows, dataIds: [...flow.dataIds], evidence: flow.evidence ?? "",
      processIds: flow.processIds.filter(id => workflows.includes(graph.nodes.find(n => n.id === id)?.workflowId ?? "")),
      description: "情報の受渡し", certainty: flow.status });
  }
  // Company platform declarations can support a different department's work.
  // Keep the scenario boundary, and retain the declaring workflow as evidence.
  const scenarioIds = graph.workflows.filter(w => (w.scenario ?? "current") === scope).map(w => w.id);
  const scenarioSet = new Set(scenarioIds);
  const declarations = inputSystemDependencies(graph, scenarioIds);
  for (const profile of graph.knowledge?.systems ?? []) {
    if (!systems.has(profile.systemId)) continue;
    for (const dependency of profile.dependsOn) {
      if (!systems.has(dependency.systemId) || (dependency.sourceWorkflowId && !scenarioSet.has(dependency.sourceWorkflowId))) continue;
      if (declarations.some(d => d.systemId === profile.systemId && d.prerequisiteId === dependency.systemId)) continue;
      addRelation(groups, profile.systemId, dependency.systemId, "dependency", { kind: "systemDependency",
        source: profile.systemId, target: dependency.systemId,
        systemId: profile.systemId, prerequisiteId: dependency.systemId,
        workflowIds: dependency.sourceWorkflowId ? [dependency.sourceWorkflowId] : [], processIds: [], dataIds: [],
        evidence: dependency.evidence ?? "", description: dependency.reason, certainty: dependency.certainty ?? "unknown" });
    }
  }
  for (const dependency of declarations) {
    if (!systems.has(dependency.systemId) || !systems.has(dependency.prerequisiteId)) continue;
    addRelation(groups, dependency.systemId, dependency.prerequisiteId, "dependency", { kind: "systemDependency",
      source: dependency.systemId, target: dependency.prerequisiteId,
      systemId: dependency.systemId, prerequisiteId: dependency.prerequisiteId, workflowIds: [dependency.sourceWorkflowId],
      processIds: [], dataIds: [], evidence: dependency.evidence, description: dependency.reason, certainty: dependency.certainty });
  }
  return [...groups.values()];
}

export type OverviewNode = { id: string; label: string; subtitle: string; note?: string; kindLabel?: string };

// Collapse display endpoints only. References still point to the original tools
// and flows, so a reader or a future query can open the underlying relation.
export function groupRelationships(relations: readonly OverviewRelation[], groupFor: ReadonlyMap<string, string>) {
  const groups = new Map<string, OverviewRelation>();
  for (const relation of relations) {
    const source = groupFor.get(relation.source), target = groupFor.get(relation.target);
    if (!source || !target) continue;
    for (const reference of relation.references) addRelation(groups, source, target, relation.kind, reference);
  }
  return [...groups.values()];
}
export function overviewWindow(nodes: readonly OverviewNode[], relations: readonly OverviewRelation[],
  selectedId = "", page = 0, limit = 8, options: { relationPage?: number; relationLimit?: number } = {}) {
  const budget = Math.max(2, Math.min(8, limit)), selected = nodes.find(n => n.id === selectedId);
  const nodeIds = new Set(nodes.map(n => n.id));
  const inScope = relations.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
  const relevant = selected ? inScope.filter(e => e.source === selected.id || e.target === selected.id) : inScope;
  const neighbors = new Set(relevant.flatMap(e => [e.source, e.target]));
  const candidates = selected ? nodes.filter(n => n.id !== selected.id && neighbors.has(n.id)) : nodes;
  const pageSize = selected ? budget - 1 : budget;
  const lastPage = Math.max(0, Math.ceil(candidates.length / pageSize) - 1);
  const shownPage = Math.min(Math.max(0, page), lastPage);
  const shown = [...(selected ? [selected] : []), ...candidates.slice(shownPage * pageSize, (shownPage + 1) * pageSize)];
  const shownIds = new Set(shown.map(n => n.id));
  const layoutEdges = relevant.filter(e => shownIds.has(e.source) && shownIds.has(e.target))
    .sort((a, b) => b.references.length - a.references.length || a.id.localeCompare(b.id));
  const relationLimit = Math.max(1, Math.min(12, options.relationLimit ?? 12));
  const lastRelationPage = Math.max(0, Math.ceil(layoutEdges.length / relationLimit) - 1);
  const relationPage = Math.min(Math.max(0, options.relationPage ?? 0), lastRelationPage);
  const edges = layoutEdges.slice(relationPage * relationLimit, (relationPage + 1) * relationLimit);
  return { nodes: shown, edges, page: shownPage, lastPage, totalNodes: nodes.length,
    layoutEdges, relationPage, lastRelationPage, windowRelations: layoutEdges.length,
    neighborCount: selected ? candidates.length : undefined, totalRelations: relevant.length };
}
