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
    via?: "handoff" | "reference";
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

function handoffReference(handoff: NonNullable<NonNullable<LensGraph["knowledge"]>["handoffs"]>[number]): OverviewRelation["references"][number] {
  return { kind: "handoff", id: handoff.id, source: handoff.sourceWorkflowId, target: handoff.targetWorkflowId,
    workflowIds: [handoff.sourceWorkflowId, handoff.targetWorkflowId], dataIds: [...handoff.dataIds],
    processIds: [handoff.sourceProcessId, handoff.targetProcessId].filter((id): id is string => !!id),
    evidence: handoff.evidence, description: handoff.description, certainty: handoff.status ?? "unknown", via: handoff.via };
}

// Open one activity at the next grouping level. Other activities remain groups.
// Group membership never implies sequence, transfer or equivalence of names.
export function activityDetailOverview(graph: LensGraph, activityId: string, workflowIds: readonly string[]) {
  const visible = new Set(workflowIds), activities = graph.knowledge?.activities ?? [];
  const activity = activities.find(a => a.id === activityId);
  const workflowById = new Map(graph.workflows.map(w => [w.id, w]));
  const sameName = (a: string, b: string) => a.normalize("NFKC").trim() === b.normalize("NFKC").trim();
  const groupingNote = (a: typeof activities[number], c?: typeof a.capabilities[number]) => {
    if ((c?.certainty ?? a.certainty) !== "confirmed") return "まとまりは整理案";
    const ids = c?.workflowIds ?? a.capabilities.flatMap(c => c.workflowIds);
    return ids.some(id => {
      const organization = workflowById.get(id)?.reviewContext?.organization;
      return visible.has(id) && organization && sameName(organization.activity, a.name)
        && (!c || sameName(organization.capability, c.name)) && organization.certainty !== "confirmed";
    }) ? "一部の業務の分類は整理案" : undefined;
  };
  const capabilities = (activity?.capabilities ?? []).filter(c => c.workflowIds.some(id => visible.has(id)));
  const groupsFor = new Map<string, string[]>();
  for (const c of capabilities) for (const id of new Set(c.workflowIds)) {
    if (visible.has(id)) groupsFor.set(id, [...(groupsFor.get(id) ?? []), c.id]);
  }
  const nodes: OverviewNode[] = capabilities.map(c => ({ id: c.id, label: c.name, kindLabel: "仕事のまとまり",
    subtitle: `${new Set(c.workflowIds.filter(id => visible.has(id))).size}業務`,
    note: activity ? groupingNote(activity, c) : undefined }));
  const externalGroups = new Map<string, string[]>();
  for (const a of activities.filter(a => a.id !== activityId)) {
    for (const id of new Set(a.capabilities.flatMap(c => c.workflowIds))) {
      if (visible.has(id) && !groupsFor.has(id)) externalGroups.set(id, [...(externalGroups.get(id) ?? []), a.id]);
    }
  }
  const groups = new Map<string, OverviewRelation>(), internal = new Map<string, OverviewRelation["references"]>();
  const unmapped: OverviewRelation["references"] = [], externalIds = new Set<string>();
  for (const h of graph.knowledge?.handoffs ?? []) {
    if (!visible.has(h.sourceWorkflowId) || !visible.has(h.targetWorkflowId)) continue;
    if (!groupsFor.has(h.sourceWorkflowId) && !groupsFor.has(h.targetWorkflowId)) continue;
    const source = groupsFor.get(h.sourceWorkflowId) ?? externalGroups.get(h.sourceWorkflowId) ?? [];
    const target = groupsFor.get(h.targetWorkflowId) ?? externalGroups.get(h.targetWorkflowId) ?? [];
    const reference = handoffReference(h);
    if (!source.length || !target.length) { unmapped.push(reference); continue; }
    for (const s of source) for (const t of target) {
      if (s === t) internal.set(s, [...(internal.get(s) ?? []), reference]);
      else addRelation(groups, s, t, "handoff", reference);
      if (externalGroups.get(h.sourceWorkflowId)?.includes(s)) externalIds.add(s);
      if (externalGroups.get(h.targetWorkflowId)?.includes(t)) externalIds.add(t);
    }
  }
  for (const a of activities.filter(a => externalIds.has(a.id))) {
    nodes.push({ id: a.id, label: a.name, kindLabel: "別の活動", subtitle: "活動を開く →",
      note: groupingNote(a) });
  }
  const relations = [...groups.values()];
  const neighbors = new Map(nodes.map(n => [n.id, new Set(relations.filter(r => r.source === n.id || r.target === n.id).flatMap(r => [r.source, r.target]).filter(id => id !== n.id))]));
  const size = new Map(capabilities.map(c => [c.id, new Set(c.workflowIds.filter(id => visible.has(id))).size]));
  const ranked = [...nodes].sort((a, b) => neighbors.get(b.id)!.size - neighbors.get(a.id)!.size
    || (size.get(b.id) ?? 0) - (size.get(a.id) ?? 0) || a.id.localeCompare(b.id));
  const hub = ranked[0];
  const ordered = hub ? [hub, ...ranked.filter(n => neighbors.get(hub.id)!.has(n.id)),
    ...ranked.filter(n => n.id !== hub.id && !neighbors.get(hub.id)!.has(n.id))] : [];
  return { nodes: ordered, relations, internal, unmapped };
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
    addRelation(groups, source, target, "handoff", handoffReference(handoff));
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
