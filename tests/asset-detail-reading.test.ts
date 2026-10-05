import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LensGraph } from "../lib/graph";
import type { AssetReadingPosition } from "../lib/exploration";
import { knowledgeIndex } from "../lib/knowledge";
import { AssetReading } from "../components/AssetReading";
import { KnowledgeExplorer } from "../components/KnowledgeExplorer";
import { AssetExplorer } from "../components/ScopedExplorers";
import { WorkflowReading } from "../components/WorkflowReading";

function fixture(): LensGraph {
  const workflows = Array.from({ length: 300 }, (_, i) => ({ id: `w${i}`, name: `業務${i}`, outcome: `判定結果${i}`,
    reviewContext: { summary: "", trigger: "", outcome: "", questions: [], warnings: [], systemProfiles: [{ name: "Teams", category: "連絡", purpose: `業務${i}の承認結果を次の担当へ知らせる`, certainty: "confirmed" as const, evidence: `業務${i}の原文` }] } }));
  const node = (id: string, kind: "system" | "data") => ({ id, canonicalKey: id, kind, label: id, description: "", status: "confirmed" as const });
  return { workflows: [...workflows, { id: "future", name: "将来の業務", scenario: "future" }],
    nodes: [node("Teams", "system"), node("ERP", "system"), node("Identity", "system"), node("記録", "data"),
      ...workflows.map((w, i) => ({ id: `p${i}`, canonicalKey: `p${i}`, kind: "process" as const, label: `通知${i}`, workflowId: w.id, description: "", actor: "担当者", executionMode: "manual" as const, status: "confirmed" as const }))],
    edges: workflows.flatMap((w, i) => [{ id: `e${i}`, source: `p${i}`, target: "Teams", relation: "uses" as const, workflowIds: [w.id] },
      { id: `r${i}`, source: `p${i}`, target: "記録", relation: "reads" as const, workflowIds: [w.id] }]),
    dataFlows: workflows.map((w, i) => ({ id: `f${i}`, sourceSystemId: "Teams", targetSystemId: "ERP", dataIds: ["記録"], workflowIds: [w.id], processIds: [`p${i}`],
      transferType: "manual" as const, automation: "manual" as const, direction: "push" as const, evidence: `受渡し${i}の原文`, status: "confirmed" as const })),
    knowledge: { name: "検証", description: "", categories: [], criticalWorkflows: [],
      activities: Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, name: `活動${i}`, description: "", capabilities: [{ id: `c${i}`, name: `まとまり${i}`, description: "", workflowIds: workflows.slice(i * 25, (i + 1) * 25).map(w => w.id) }] })),
      systems: [{ systemId: "Teams", categoryId: "", owner: "", purpose: "次の担当へ連絡する", certainty: "confirmed", evidence: "資料の原文",
        dependsOn: [{ systemId: "Identity", reason: "社内ログインに使う", certainty: "confirmed", evidence: "ログインの原文", sourceWorkflowId: "w0" }] }] } };
}
const position = (section: AssetReadingPosition["section"], page = 0): AssetReadingPosition => ({ assetId: "Teams", section, rolesPage: page, activityPage: page, workPage: page, flowPage: page, processPage: page, dependencyPage: 0, dependentPage: 0, workKind: "direct" });
function render(graph: LensGraph, reading: AssetReadingPosition, scope: "current" | "future" = "current") {
  const view = knowledgeIndex(graph, scope), asset = view.nodeById.get("Teams")!;
  return renderToStaticMarkup(createElement(AssetReading, { graph, view, asset, impact: view.systemProfile(asset.id), position: reading,
    onActivity: () => {}, onWorkflow: () => {}, onAsset: () => {}, onProcess: () => {}, onReadData: () => {} }));
}

test("300 accumulated workflows open with short role examples and six activities/jobs, without a wall of names or hidden flow sections", () => {
  const graph = fixture(), before = JSON.stringify(graph), html = render(graph, position("work"));
  assert.equal((html.match(/class="asset-role-cards"/g) ?? []).length, 1);
  assert.match(html, /1–2 \/ 300役割/); assert.match(html, /1–6 \/ 12活動/); assert.match(html, /1–6 \/ 300業務/);
  assert.match(html, /業務0の承認結果/); assert.doesNotMatch(html, /業務299の承認結果|活動11<small>/);
  assert.match(html, /道具の一般説明/); assert.match(html, /登録された役割：次の担当へ連絡する/);
  assert.equal((html.match(/<article>/g) ?? []).length, 8);
  assert.match(html, /情報の受渡し<span>300/); assert.doesNotMatch(html, /受渡し0の原文/);
  assert.equal(JSON.stringify(graph), before);
});

test("saved transfer/process pages restore the selected section and expose later entries beyond the former 30 item cap", () => {
  const graph = fixture(), html = render(graph, position("flows", 49));
  assert.match(html, /aria-pressed="true">情報の受渡し/); assert.match(html, /295–300 \/ 300受渡し/);
  assert.match(html, /受渡し299の原文/); assert.doesNotMatch(html, /受渡し0の原文|業務0の承認結果/);
  assert.equal((html.match(/<article>/g) ?? []).length, 6);
  const processes = render(graph, position("processes", 49));
  assert.match(processes, /295–300 \/ 300手順/); assert.match(processes, /通知299 →/); assert.doesNotMatch(processes, /通知0 →/);
  assert.match(processes, /参照・受取/); assert.match(processes, /この処理で何が決まるかは未確認/);
});

test("scope changes exclude current-only roles and transfers, and dependency reading preserves its literal reason", () => {
  const graph = fixture(), future = render(graph, position("flows", 49), "future");
  assert.match(future, /直接関連 0業務/); assert.doesNotMatch(future, /受渡し299の原文|業務0の承認結果/);
  const deps = render(graph, position("dependencies"));
  assert.match(deps, /社内ログインに使う/); assert.match(deps, /ログインの原文/); assert.match(deps, /根拠の業務を開く/);
  assert.doesNotMatch(deps, /通知0 →|受渡し0の原文/);
  assert.match(render(graph, position("processes", 999)), /295–300 \/ 300手順/);
});

test("asset details show the full filter scope separately from direct use, collapse controls and do not repeat the page title", () => {
  const graph = fixture(), html = renderToStaticMarkup(createElement(KnowledgeExplorer, { graph, projectId: "qa", onGraphApply: () => {}, onOpenWorkflow: () => {}, onWorkflowFocus: () => {},
    exploration: { focus: { kind: "asset", id: "Identity" }, scope: "current", query: "", department: "", category: "", history: [], assetReading: { ...position("dependencies"), assetId: "Identity" } } }));
  assert.match(html, /表示範囲：現在の仕事 · すべての部署 · 300業務/);
  assert.match(html, /直接関連 0業務 · 基盤を介した影響 300業務/);
  assert.doesNotMatch(html, /<h2>Identity<\/h2>/); assert.match(html, /class="kg-scope-controls"/);
  assert.match(html, /基盤を介して影響する300業務を読む/);
});

test("the advanced system entry uses the same bounded sections, and opens change impact before the merge tools", () => {
  const graph = fixture(), before = JSON.stringify(graph);
  const html = renderToStaticMarkup(createElement(AssetExplorer, { graph, onGraphApply: () => {}, onEdit: () => {} }));
  assert.match(html, /aria-pressed="true">変更の影響/); assert.match(html, /1–6 \/ 300業務/);
  assert.equal((html.match(/class="asset-impact-step"/g) ?? []).length, 6);
  assert.ok(html.indexOf("変更するときに") < html.indexOf("表記を統合"));
  assert.match(html, /直接関連 300業務/); assert.match(html, /判断の根拠/); assert.match(html, /ルール・例外・原文/);
  assert.match(html, /この業務の話を補足・訂正する/); assert.match(html, /asset-scope-definition/);
  const restored = renderToStaticMarkup(createElement(AssetExplorer, { graph, onGraphApply: () => {}, onEdit: () => {},
    exploration: { id: "Teams", scope: "current", department: "", readingPosition: position("flows", 49) } }));
  assert.match(restored, /295–300 \/ 300受渡し/); assert.match(restored, /受渡し299の原文/);
  assert.equal(JSON.stringify(graph), before);
});

test("indirect impact explains the prerequisite instead of making it the business executor", () => {
  const graph = fixture(), html = renderToStaticMarkup(createElement(AssetExplorer, { graph, onGraphApply: () => {}, onEdit: () => {},
    exploration: { id: "Identity", scope: "current", department: "", readingPosition: { ...position("impact", 49), assetId: "Identity", workKind: "indirect" } } }));
  assert.match(html, /直接関連 0業務 · 基盤を介した影響 300業務/);
  assert.match(html, /295–300 \/ 300業務/); assert.match(html, /登録された基盤依存を介してIdentityを必要/);
  assert.match(html, /担当者 · 人が行う/); assert.doesNotMatch(html, /Identity · システムが自動実行/);
});

test("a step opened from impact keeps its result, hold condition and next response while collapsing navigation", () => {
  const graph = fixture();
  const held = graph.nodes.find(n => n.id === "p0")!;
  held.stepOrder = 1;
  held.meaning = { purpose: "", basis: "試薬の期限", result: "試薬の使用を保留する", next: "", condition: "期限が短すぎる", halt: true, certainty: "confirmed", evidence: "期限が短すぎる試薬は使用を保留する" };
  graph.nodes.push({ id: "response", canonicalKey: "response", kind: "process", label: "品質課長へ連絡する", description: "", workflowId: "w0", status: "confirmed", stepOrder: 2 });
  graph.edges.push({ id: "hold-response", source: "p0", target: "response", relation: "next", workflowIds: ["w0"], status: "confirmed", holdEffect: "response" });
  const html = renderToStaticMarkup(createElement(WorkflowReading, { graph, workflowId: "w0", initialStepId: "p0", compactControls: true, onDetail: () => {} }));
  assert.match(html, /<details class="flow-step-context"><summary>停止・保留と再開条件を確認する/);
  assert.match(html, /試薬の使用を保留する/); assert.match(html, /期限が短すぎる/);
  assert.match(html, /停止中の対応/); assert.match(html, /品質課長へ連絡する/);
  assert.match(html, /手順を選んで読む/); assert.match(html, /同じ情報の流れを辿る/);
  assert.doesNotMatch(html, /class="flow-explanation"/);
});
