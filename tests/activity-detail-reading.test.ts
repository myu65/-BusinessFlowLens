import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LensGraph } from "../lib/graph";
import { knowledgeIndex } from "../lib/knowledge";
import { activityDetailOverview, overviewWindow } from "../lib/relationship-overview";
import { ActivityRelationshipMap } from "../components/ActivityRelationshipMap";
import { RelationshipEvidence } from "../components/RelationshipDiagram";
import { KnowledgeExplorer } from "../components/KnowledgeExplorer";

function fixture(): LensGraph {
  const workflows = Array.from({ length: 300 }, (_, i) => ({ id: `w${i}`, name: `仕事${i}` }));
  const capability = (i: number) => ({ id: `c${i}`, name: i < 2 ? "同じ名前の種類" : `種類${i}`, description: "入力の整理案", certainty: "inferred" as const,
    workflowIds: workflows.slice(i * 10, (i + 1) * 10).map(w => w.id) });
  const handoff = (id: string, source: number, target: number) => ({ id, sourceWorkflowId: `w${source}`, targetWorkflowId: `w${target}`,
    sourceProcessId: `p${source}`, targetProcessId: `p${target}`, dataIds: ["情報"], description: "次の仕事が情報を参照する", evidence: `${id}の原文`, status: "confirmed" as const, kind: "information" as const, via: "reference" as const });
  return { workflows, nodes: [{ id: "情報", canonicalKey: "情報", kind: "data", label: "情報", description: "", status: "confirmed" },
    ...workflows.map((w, i) => ({ id: `p${i}`, canonicalKey: `p${i}`, kind: "process" as const, label: `作業${i}`, description: "", status: "confirmed" as const, workflowId: w.id }))],
    edges: [], dataFlows: [], knowledge: { name: "検証会社", description: "", categories: [], systems: [], criticalWorkflows: [],
      activities: [{ id: "a", name: "製造", description: "", capabilities: Array.from({ length: 25 }, (_, i) => capability(i)) },
        { id: "b", name: "受注", description: "", capabilities: [{ ...capability(25), id: "order" }] }],
      handoffs: [handoff("internal", 0, 1), handoff("between", 0, 10), handoff("out", 10, 250), handoff("in", 250, 0), handoff("unmapped", 0, 290)] } };
}

test("opening an activity keeps work groups, outside activities, internal and unclassified handoffs, and original evidence", () => {
  const graph = fixture(), before = JSON.stringify(graph), ids = graph.workflows.map(w => w.id);
  const p = activityDetailOverview(graph, "a", ids);
  assert.equal(p.nodes.filter(n => n.kindLabel === "仕事のまとまり").length, 25);
  assert.deepEqual(p.nodes.filter(n => n.kindLabel === "別の活動").map(n => n.id), ["b"]);
  assert.equal(p.nodes.filter(n => n.label === "同じ名前の種類").length, 2, "names do not merge identities");
  assert.deepEqual(p.relations.map(r => [r.source, r.target]), [["c0", "c1"], ["c1", "b"], ["b", "c0"]]);
  assert.equal(p.internal.get("c0")![0].id, "internal");
  assert.equal(p.unmapped[0].id, "unmapped");
  for (const ref of [...p.relations.flatMap(r => r.references), ...p.internal.values()].flat().concat(p.unmapped)) {
    const h = graph.knowledge!.handoffs!.find(h => h.id === ref.id)!;
    assert.equal(ref.evidence, h.evidence); assert.equal(ref.certainty, h.status); assert.equal(ref.via, "reference");
    assert.deepEqual(ref.processIds, [h.sourceProcessId, h.targetProcessId]);
    assert.deepEqual(ref.workflowIds, [h.sourceWorkflowId, h.targetWorkflowId]);
  }
  assert.equal(JSON.stringify(graph), before);
  const first = overviewWindow(p.nodes, p.relations, "", 0, 8, { relationLimit: 6 });
  assert.equal(first.edges.length, 3, "the entry page keeps connected groups together");
});

test("membership never creates a handoff; both endpoints must be in the chosen scope, and multiple memberships are retained", () => {
  const graph = fixture();
  assert.equal(activityDetailOverview(graph, "a", ["w0"]).relations.length, 0);
  assert.equal(activityDetailOverview({ ...graph, knowledge: { ...graph.knowledge!, handoffs: [] } }, "a", graph.workflows.map(w => w.id)).relations.length, 0);
  graph.knowledge!.activities[0].capabilities[2].workflowIds.push("w0");
  const p = activityDetailOverview(graph, "a", ["w0", "w10"]);
  assert.deepEqual(p.relations.map(r => [r.source, r.target]), [["c0", "c1"], ["c2", "c1"]]);
  assert.ok(p.relations.every(r => r.references.length === 1 && r.references[0].id === "between"));
});

test("an existing confirmed capability cannot make a later AI membership appear confirmed", () => {
  const graph = fixture();
  graph.knowledge!.activities[0].certainty = "confirmed";
  graph.knowledge!.activities[0].capabilities[0].certainty = "confirmed";
  graph.workflows[0].reviewContext = { summary: "", trigger: "", outcome: "", questions: [], warnings: [],
    organization: { title: "仕事0", activity: "製造", capability: "同じ名前の種類", certainty: "inferred", evidence: "分類の提案", origin: "ai" } };
  const note = activityDetailOverview(graph, "a", ["w0"]).nodes.find(n => n.id === "c0")!.note;
  assert.equal(note, "一部の業務の分類は整理案");
  assert.equal(activityDetailOverview(graph, "a", ["w1"]).nodes[0].note, undefined, "out-of-scope proposals do not describe the chosen group");
});

test("300 accumulated workflows open as at most eight groups and six edges, and every group and relation is reachable", () => {
  const graph = fixture(), view = knowledgeIndex(graph, "current"), activity = view.activities[0];
  const props = { graph, activity, workflowIds: view.rows.map(r => r.workflow.id), onActivity: () => {}, onCapability: () => {}, onSystem: () => {}, onWorkflow: () => {} };
  const html = renderToStaticMarkup(createElement(ActivityRelationshipMap, props));
  assert.equal((html.match(/class="relationship-node /g) ?? []).length, 8);
  assert.ok((html.match(/class="relationship-edge /g) ?? []).length <= 6);
  assert.doesNotMatch(html, /仕事299 →/);
  const p = activityDetailOverview(graph, activity.id, props.workflowIds), nodes = new Set<string>(), edges = new Set<string>();
  const first = overviewWindow(p.nodes, p.relations, "", 0, 8, { relationLimit: 6 });
  for (let page = 0; page <= first.lastPage; page++) overviewWindow(p.nodes, p.relations, "", page, 8, { relationLimit: 6 }).nodes.forEach(n => nodes.add(n.id));
  for (const node of p.nodes) {
    const ego = overviewWindow(p.nodes, p.relations, node.id, 0, 8, { relationLimit: 6 });
    for (let page = 0; page <= ego.lastPage; page++) {
      const window = overviewWindow(p.nodes, p.relations, node.id, page, 8, { relationLimit: 6 });
      for (let relationPage = 0; relationPage <= window.lastRelationPage; relationPage++) {
        overviewWindow(p.nodes, p.relations, node.id, page, 8, { relationLimit: 6, relationPage }).edges.forEach(e => edges.add(e.id));
      }
    }
  }
  assert.equal(nodes.size, p.nodes.length); assert.equal(edges.size, p.relations.length);
  const restored = renderToStaticMarkup(createElement(ActivityRelationshipMap, { ...props,
    position: { activityId: "a", capabilityId: "c0", page: 0, relationPage: 0, systemPage: 0 } }));
  assert.match(restored, /aria-pressed="true"/); assert.match(restored, /選んだ仕事のまとまり/);
  assert.match(restored, /仕事0 →/); assert.doesNotMatch(restored, /仕事9 →/);
});

test("a dense relation shows three original references and six workflow links per reference, without losing full counts", () => {
  const graph = fixture(), p = activityDetailOverview(graph, "a", graph.workflows.map(w => w.id));
  const edge = { ...p.relations[0], references: Array.from({ length: 300 }, (_, i) => ({ ...p.relations[0].references[0], id: `r${i}`, workflowIds: graph.workflows.map(w => w.id) })) };
  const html = renderToStaticMarkup(createElement(RelationshipEvidence, { graph, edge, nodes: p.nodes, onWorkflow: () => {} }));
  assert.equal((html.match(/<article>/g) ?? []).length, 3);
  assert.match(html, /1–3 \/ 300根拠/); assert.match(html, /1–6 \/ 300関連業務/);
  assert.match(html, /情報の参照/); assert.equal((html.match(/仕事\d+ →/g) ?? []).length, 18);
  assert.equal(edge.references.length, 300); assert.equal(edge.references[0].workflowIds.length, 300);
});

test("opening a saved position restores the capability list page and clamps a stale page to the remaining work", () => {
  const graph = fixture();
  const render = (listPage: number) => renderToStaticMarkup(createElement(KnowledgeExplorer, { graph, projectId: "qa",
    onGraphApply: () => {}, onOpenWorkflow: () => {}, onWorkflowFocus: () => {},
    exploration: { focus: { kind: "capability", id: "c0" }, scope: "current", query: "", department: "", category: "", history: [], listPage } }));
  const html = render(1);
  assert.match(html, /7–10/); assert.match(html, /仕事6<\/button>/); assert.doesNotMatch(html, /仕事0<\/button>/);
  assert.equal((html.match(/<article>/g) ?? []).length, 4);
  assert.match(render(99), /7–10/); assert.match(html, /活動のまとまりの関係へ戻る/);
});
