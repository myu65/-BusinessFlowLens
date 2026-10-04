import test from "node:test";
import assert from "node:assert/strict";
import { createChemicalCompany } from "../lib/chemical-company";
import { knowledgeIndex } from "../lib/knowledge";
import { activityRelationships, systemRelationships, groupRelationships, overviewWindow, type OverviewRelation } from "../lib/relationship-overview";

const graph = createChemicalCompany();
const currentIds = graph.workflows.filter(w => w.scenario === "current").map(w => w.id);
test("activity aggregation retains registered direction, original handoff IDs, evidence and uncertainty", () => {
  const before = JSON.stringify(graph), relations = activityRelationships(graph, currentIds);
  assert.ok(relations.length > 0);
  for (const relation of relations) for (const reference of relation.references) {
    const original = graph.knowledge!.handoffs!.find(h => h.id === reference.id)!;
    assert.ok(original);
    assert.equal(reference.source, original.sourceWorkflowId);
    assert.equal(reference.target, original.targetWorkflowId);
    assert.equal(reference.evidence, original.evidence);
    assert.deepEqual(reference.dataIds, original.dataIds);
    assert.deepEqual(reference.processIds, [original.sourceProcessId, original.targetProcessId].filter(Boolean));
    assert.ok(currentIds.includes(reference.source) && currentIds.includes(reference.target));
    if (reference.certainty !== "confirmed") assert.notEqual(relation.certainty, "confirmed");
  }
  assert.deepEqual(activityRelationships(graph, [currentIds[0]]), []);
  assert.equal(JSON.stringify(graph), before, "a bird view never changes source data");
});
test("system relations distinguish information transfer from prerequisite dependence and respect scenario", () => {
  const view = knowledgeIndex(graph, "current"), systemIds = graph.nodes.filter(n => n.kind === "system").map(n => n.id);
  const relations = systemRelationships(graph, "current", currentIds, systemIds);
  assert.ok(relations.some(r => r.kind === "transfer"));
  assert.ok(relations.some(r => r.kind === "dependency"));
  for (const relation of relations.filter(r => r.kind === "transfer")) for (const reference of relation.references) {
    const flow = graph.dataFlows.find(f => f.id === reference.id)!;
    assert.equal(relation.source, flow.sourceSystemId);
    assert.equal(relation.target, flow.targetSystemId);
    assert.ok(reference.workflowIds.every(id => currentIds.includes(id)));
    assert.deepEqual(reference.processIds, flow.processIds.filter(id => reference.workflowIds.includes(graph.nodes.find(n => n.id === id)?.workflowId ?? "")));
  }
  const futureIds = graph.workflows.filter(w => w.scenario === "future").map(w => w.id);
  const future = systemRelationships(graph, "future", futureIds, systemIds);
  assert.ok(future.filter(r => r.kind === "transfer").every(r => r.references.every(ref => ref.workflowIds.every(id => futureIds.includes(id)))));
  const narrowed = systemRelationships(graph, "current", [view.rows[0].workflow.id], systemIds);
  assert.ok(narrowed.filter(r => r.kind === "transfer").every(r => r.references.every(ref => ref.workflowIds.every(id => id === view.rows[0].workflow.id))));
});
test("co-mention cannot create a tool dependency or information-transfer arrow", () => {
  const copy = structuredClone(graph);
  copy.dataFlows = [];
  copy.knowledge!.systems.forEach(s => s.dependsOn = []);
  copy.workflows.forEach(w => { if (w.reviewContext) w.reviewContext.systemDependencies = []; });
  assert.deepEqual(systemRelationships(copy, "current", currentIds, copy.nodes.filter(n => n.kind === "system").map(n => n.id)), []);
});
test("role groups preserve relation references and separate opposite directions and relation kinds", () => {
  const relations = systemRelationships(graph, "current", currentIds, graph.nodes.filter(n => n.kind === "system").map(n => n.id));
  const groupFor = new Map(graph.knowledge!.systems.map(s => [s.systemId, s.categoryId]));
  const grouped = groupRelationships(relations, groupFor);
  assert.ok(grouped.length);
  assert.ok(grouped.every(r => r.source !== r.target));
  for (const relation of grouped) for (const ref of relation.references) {
    const original = relations.find(r => r.references.includes(ref))!;
    assert.ok(original);
    assert.equal(groupFor.get(original.source), relation.source);
    assert.equal(groupFor.get(original.target), relation.target);
    assert.equal(relation.kind, original.kind);
  }
});
test("dense cyclic views have a fixed display budget and every edge keeps its endpoints", () => {
  const nodes = Array.from({ length: 300 }, (_, i) => ({ id: `n${i}`, label: "同じ名前", subtitle: "1業務" }));
  const edges: OverviewRelation[] = nodes.flatMap(s => nodes.filter(t => t.id !== s.id).slice(0, 20).map(t => ({
    id: JSON.stringify([s.id, t.id]), source: s.id, target: t.id, kind: "transfer", certainty: "confirmed", references: [],
  })));
  for (const selected of ["", "n0", "n299"]) {
    const window = overviewWindow(nodes, edges, selected, 900, 8);
    assert.ok(window.nodes.length <= 8 && window.edges.length <= 12);
    assert.ok(window.edges.every(e => window.nodes.some(n => n.id === e.source) && window.nodes.some(n => n.id === e.target)));
    if (selected) assert.ok(window.nodes.some(n => n.id === selected));
    assert.ok(window.page <= window.lastPage);
  }
  const renamed = nodes.map(n => ({ ...n, label: "名前を訂正" }));
  assert.deepEqual(overviewWindow(nodes, edges).edges.map(e => e.id), overviewWindow(renamed, edges).edges.map(e => e.id));
  assert.equal(overviewWindow(nodes, edges, "missing").nodes.length, 8);
});

test("all group relations remain reachable without moving nodes when relation pages change", () => {
  const nodes = Array.from({ length: 6 }, (_, i) => ({ id: `g${i}`, label: `まとまり${i}`, subtitle: "" }));
  const edges: OverviewRelation[] = nodes.flatMap(s => nodes.filter(t => t.id !== s.id).map(t => ({
    id: `${s.id}:${t.id}`, source: s.id, target: t.id, kind: "transfer", certainty: "confirmed", references: [],
  })));
  const first = overviewWindow(nodes, edges, "", 0, 8, { relationLimit: 6 });
  const readIds = new Set<string>();
  for (let page = 0; page <= first.lastRelationPage; page++) {
    const window = overviewWindow(nodes, edges, "", 0, 8, { relationPage: page, relationLimit: 6 });
    assert.ok(window.edges.length <= 6);
    assert.deepEqual(window.nodes, first.nodes);
    assert.deepEqual(window.layoutEdges, first.layoutEdges, "layout has the same relationships on every page");
    window.edges.forEach(e => readIds.add(e.id));
  }
  assert.deepEqual([...readIds].sort(), edges.map(e => e.id).sort());
  const narrowed = overviewWindow(nodes, [edges[0]], "", 0, 8, { relationPage: 100, relationLimit: 6 });
  assert.equal(narrowed.relationPage, 0);
  assert.equal(narrowed.edges[0].id, edges[0].id);
});
