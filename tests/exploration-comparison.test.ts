import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { branchWorkflowScenario, type LensGraph, type LensNode } from "../lib/graph";
import { exploreSavedStory } from "../lib/exploration";
import { WorkflowReading } from "../components/WorkflowReading";
import { compareWorkflow, comparisonExecutor, comparisonResources, knowledgeReport } from "../lib/knowledge";

function step(workflowId: string, key: string, label: string, order = 1): LensNode {
  return { id: `${workflowId}/${key}`, canonicalKey: `process:${workflowId}:${key}`, workflowId,
    kind: "process", label, description: label, status: "confirmed", stepOrder: order,
    executionMode: "manual", actor: "品質担当", evidence: "品質担当がTeamsの内容をQMSへ転記する。" };
}

function fixture(): LensGraph {
  const current = step("current", "register:ticket", "苦情を手で転記する");
  current.humanEdits = [{ field: "actor", before: "担当", after: "品質担当", evidence: "現場で訂正" }];
  const future = step("future", "register:ticket", "苦情をAPIで登録する");
  future.actor = "";
  future.executionMode = "automatic";
  future.evidence = "QMSがTeamsの受付記録をAPIで取得して登録する。";
  return {
    workflows: [
      { id: "current", name: "苦情受付", scenario: "current", familyId: "complaint" },
      { id: "future", name: "苦情受付の将来案", scenario: "future", familyId: "complaint" },
      { id: "other", name: "別の仕事", scenario: "current", familyId: "other" },
    ],
    nodes: [current, future, step("other", "register:ticket", "別の仕事"),
      { id: "qms", canonicalKey: "system:qms", kind: "system", label: "QMS", description: "", status: "confirmed" },
      { id: "teams", canonicalKey: "system:teams", kind: "system", label: "Teams", description: "", status: "confirmed" },
      { id: "receipt", canonicalKey: "data:receipt", kind: "data", label: "受付記録", description: "", status: "confirmed" }],
    edges: [
      { id: "current-tool", source: current.id, target: "qms", relation: "uses", workflowIds: ["current"] },
      { id: "future-exec", source: "qms", target: future.id, relation: "executes", workflowIds: ["future"] },
      { id: "current-read", source: "receipt", target: current.id, relation: "reads", workflowIds: ["current"] },
      { id: "future-read", source: "receipt", target: future.id, relation: "reads", workflowIds: ["future"] },
    ],
    dataFlows: [
      { id: "manual-transfer", sourceSystemId: "teams", targetSystemId: "qms", dataIds: ["receipt"],
        transferType: "manual", direction: "push", automation: "manual", status: "confirmed", workflowIds: ["current"], processIds: [current.id] },
      { id: "api-transfer", sourceSystemId: "teams", targetSystemId: "qms", dataIds: ["receipt"],
        transferType: "api", direction: "pull", automation: "automatic", status: "confirmed", workflowIds: ["future"], processIds: [future.id] },
    ],
  };
}

test("the explicit input link opens its saved scenario and step with a company return point", () => {
  const graph = fixture(), before = JSON.stringify(graph);
  const exploration = exploreSavedStory(graph, "future", "future/register:ticket");
  assert.deepEqual(exploration, { focus: { kind: "workflow", id: "future" }, scope: "future",
    query: "", department: "", category: "", stepId: "future/register:ticket",
    history: [{ focus: { kind: "company" }, scope: "future", query: "", department: "", category: "" }] });
  assert.equal(JSON.stringify(graph), before);
  assert.equal(exploreSavedStory(graph, "future", "current/register:ticket").stepId, undefined,
    "a step in another story must never become the entry point");
  assert.equal(exploreSavedStory(graph, "future", "qms").stepId, undefined,
    "a system is not a process entry point");
  assert.deepEqual(exploreSavedStory(graph, "missing"), { focus: { kind: "company" }, scope: "current",
    query: "", department: "", category: "", history: [] });
});

test("a resumed reader retains the later step, selected information and level of detail", () => {
  const graph = fixture(), later = step("current", "check:ticket", "記録の内容を確認する", 2);
  graph.nodes.push(later);
  graph.edges.push({ id: "later-read", source: "receipt", target: later.id, relation: "reads", workflowIds: ["current"] });
  const html = renderToStaticMarkup(createElement(WorkflowReading, { graph, workflowId: "current",
    initialStepId: later.id, initialDataId: "receipt", initialLens: "data", onDetail: () => {} }));
  assert.ok(html.includes('value="current/check:ticket" selected=""'));
  assert.ok(html.includes('value="receipt" selected=""'));
  assert.ok(html.includes('aria-pressed="true">同じ情報の流れを辿る'));
  const detail = renderToStaticMarkup(createElement(WorkflowReading, { graph, workflowId: "current",
    initialStepId: later.id, initialDepth: "detail", onDetail: () => {} }));
  assert.ok(detail.includes("同じ手順の判断と個別作業"));
  assert.ok(detail.includes("記録の内容を確認する"));
  graph.edges = graph.edges.filter(e => e.id !== "later-read");
  const unrelatedInformation = renderToStaticMarkup(createElement(WorkflowReading, { graph, workflowId: "current",
    initialStepId: later.id, initialDataId: "receipt", initialLens: "data", onDetail: () => {} }));
  assert.ok(unrelatedInformation.includes('value="current/check:ticket" selected=""'),
    "returning to a chosen step must not silently jump to another step that uses the selected information");
});

test("renaming and automating the same saved step is a change, with both sources retained", () => {
  const graph = fixture(), before = JSON.stringify(graph);
  const [comparison] = compareWorkflow(graph, "current");
  assert.equal(compareWorkflow(graph, "current").length, 1, "another business family is excluded");
  assert.deepEqual(comparison.removed, []);
  assert.deepEqual(comparison.added, []);
  assert.deepEqual(comparison.correspondingSteps.map(x => [x.before.id, x.after.id]),
    [["current/register:ticket", "future/register:ticket"]]);
  assert.equal(comparison.resultChanges.length, 1);
  assert.equal(comparisonExecutor(graph, comparison.resultChanges[0].before), "品質担当");
  assert.equal(comparisonExecutor(graph, comparison.resultChanges[0].after), "QMS");
  assert.deepEqual(comparisonResources(graph, comparison.resultChanges[0].after),
    { tools: "QMS", input: "受付記録", output: "未登録" });
  const report = knowledgeReport(graph, "current", "", "", ["current"]);
  assert.ok(report.includes("除外する手順の候補: なし / 追加する手順の候補: なし"));
  assert.ok(report.includes("登録された手動の受渡し 1 → 0"));
  assert.ok(report.includes("人の操作全体や未登録の受渡しを含まない"));
  assert.ok(report.includes("担当・実行主体: 品質担当 → QMS"));
  assert.ok(report.includes("品質担当がTeamsの内容をQMSへ転記する。 → QMSがTeamsの受付記録をAPIで取得して登録する。"));
  assert.ok(report.includes("人の訂正: 1件 → 0件"));
  assert.equal(JSON.stringify(graph), before, "reading or reporting never changes a source or human correction");
});

test("a copied scenario retains the complete step key including colons", () => {
  const graph = fixture();
  graph.nodes.push(step("current", "approve:ticket", "案件を承認する", 2));
  const branched = branchWorkflowScenario(graph, "current", { id: "alternative", name: "別案", scenario: "alternative" });
  assert.deepEqual(branched.nodes.filter(n => n.workflowId === "alternative").map(n => n.canonicalKey),
    ["process:alternative:register:ticket", "process:alternative:approve:ticket"]);
  const comparison = compareWorkflow(branched, "current").find(c => c.workflow.id === "alternative")!;
  assert.equal(comparison.correspondingSteps.length, 2);
  assert.deepEqual(comparison.added, []);
  assert.deepEqual(comparison.removed, []);
});

test("equal names or order do not hide real removal and addition", () => {
  const graph = fixture();
  graph.nodes.find(n => n.workflowId === "future")!.canonicalKey = "process:future:brand-new";
  graph.nodes.find(n => n.workflowId === "future")!.label = "苦情を手で転記する";
  const [comparison] = compareWorkflow(graph, "current");
  assert.equal(comparison.correspondingSteps.length, 0);
  assert.deepEqual(comparison.removed.map(n => n.id), ["current/register:ticket"]);
  assert.deepEqual(comparison.added.map(n => n.id), ["future/register:ticket"]);
  assert.deepEqual(comparison.resultChanges, []);
});

test("duplicate or unrecognized keys remain unmatched rather than receiving guessed correspondence", () => {
  for (const scope of ["current", "future"]) {
    const graph = fixture();
    graph.nodes.push({ ...graph.nodes.find(n => n.workflowId === scope)!, id: `${scope}/duplicate` });
    assert.equal(compareWorkflow(graph, "current")[0].correspondingSteps.length, 0);
  }
  const graph = fixture();
  graph.nodes.find(n => n.workflowId === "future")!.canonicalKey = "legacy:ticket";
  assert.equal(compareWorkflow(graph, "current")[0].correspondingSteps.length, 0);
});

test("a resource-only change is visible and an automatic actor is not guessed from a used tool", () => {
  const graph = fixture(), current = graph.nodes.find(n => n.workflowId === "current")!;
  const future = graph.nodes.find(n => n.workflowId === "future")!;
  Object.assign(future, { label: current.label, actor: current.actor, executionMode: current.executionMode });
  graph.edges = graph.edges.filter(e => e.id !== "future-exec");
  graph.edges.push({ id: "future-other-tool", source: future.id, target: "teams", relation: "uses", workflowIds: ["future"] });
  assert.equal(compareWorkflow(graph, "current")[0].resultChanges.length, 1);
  future.executionMode = "automatic";
  assert.equal(comparisonExecutor(graph, future), "実行システム未確認");
});
