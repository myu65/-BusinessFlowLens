import test from "node:test";
import assert from "node:assert/strict";
import { createChemicalCompany } from "../lib/chemical-company";
import { getWorkflowProcesses } from "../lib/graph";
import {
  reviewFlowNote,
  planFlowAddition,
  applyFlowAddition,
} from "../lib/flow-note";
import { stepContext, traceData, transferSteps } from "../lib/flow-context";
import { SqliteBusinessFlowRepository } from "../lib/storage/sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const graph = createChemicalCompany(),
  wid = "chemical-1-0-0",
  anchor = getWorkflowProcesses(graph, wid)[8].id;
test("notes insert connected facts without replacing any existing workflow, asset or context", () => {
  const note = "営業担当がExcelから「受注確認リスト」をTeamsへ手動で転記する。";
  const review = reviewFlowNote(note, graph, wid),
    plan = planFlowAddition(graph, wid, anchor, note, "one", review),
    result = applyFlowAddition(graph, plan);
  assert.equal(plan.stepIds.length, 1);
  assert.equal(plan.dataFlows.length, 1);
  assert.equal(plan.nodes.filter((n) => n.kind === "system").length, 0);
  assert.match(
    result.nodes.find((n) => n.id === plan.dataFlows[0].sourceSystemId)!.label,
    /Excel/,
  );
  assert.match(
    result.nodes.find((n) => n.id === plan.dataFlows[0].targetSystemId)!.label,
    /Teams/,
  );
  const before = getWorkflowProcesses(graph, wid),
    after = getWorkflowProcesses(result, wid);
  assert.deepEqual(
    after.filter((n) => !plan.stepIds.includes(n.id)).map((n) => n.id),
    before.map((n) => n.id),
  );
  assert.equal(after[9].id, plan.stepIds[0]);
  assert.equal(after[10].id, before[9].id);
  assert.ok(
    result.edges.some(
      (e) =>
        e.source === anchor &&
        e.target === plan.stepIds[0] &&
        e.relation === "next",
    ),
  );
  assert.ok(
    result.edges.some(
      (e) =>
        e.source === plan.stepIds[0] &&
        e.target === before[9].id &&
        e.relation === "next",
    ),
  );
  assert.deepEqual(result.knowledge, graph.knowledge);
  assert.equal(result.workflows.length, 303);
  assert.equal(applyFlowAddition(result, plan), result);
  assert.ok(plan.nodes.every((n) => n.status === "inferred"));
  const ids = new Set(result.nodes.map((n) => n.id));
  assert.ok(result.edges.every((e) => ids.has(e.source) && ids.has(e.target)));
});
test("successive notes reuse the new data and trace manual and automatic work after reload", async () => {
  const one = "営業担当がExcelから「受注確認リスト」をTeamsへ手動で転記する。";
  const p1 = planFlowAddition(
    graph,
    wid,
    anchor,
    one,
    "first",
    reviewFlowNote(one, graph, wid),
  );
  const g1 = applyFlowAddition(graph, p1);
  const two = "SharePointが自動で「受注確認リスト」をSnowflakeへ連携する。";
  const p2 = planFlowAddition(
    g1,
    wid,
    p1.stepIds[0],
    two,
    "second",
    reviewFlowNote(two, g1, wid),
  );
  assert.equal(p2.nodes.filter((n) => n.kind === "data").length, 0);
  assert.equal(p2.dataFlows.length, 1);
  assert.equal(p2.dataFlows[0].automation, "automatic");
  assert.equal(p2.dataFlows[0].transferType, "unknown", "automatic does not prove an API protocol");
  const result = applyFlowAddition(g1, p2),
    dataId = p1.dataFlows[0].dataIds[0];
  const trace = traceData(result, wid, dataId);
  assert.deepEqual(
    trace.map((t) => t.step.id),
    [p1.stepIds[0], p2.stepIds[0]],
  );
  assert.equal(
    transferSteps(result, p2.dataFlows[0].id, wid)[0].id,
    p2.stepIds[0],
  );
  assert.ok(!traceData(result, "chemical-1-0-0-future", dataId).length);
  const repo = new SqliteBusinessFlowRepository(
    join(mkdtempSync(join(tmpdir(), "flow-note-")), "notes.sqlite"),
  );
  await repo.saveProject({
    projectId: "notes",
    projectName: "Notes",
    graph: result,
    transcripts: {},
    updatedAt: new Date().toISOString(),
  });
  const loaded = (await repo.loadProject("notes"))!.graph;
  assert.equal(traceData(loaded, wid, dataId).length, 2);
  assert.equal(
    loaded.nodes.filter(
      (n) => n.kind === "data" && n.label === "受注確認リスト",
    ).length,
    1,
  );
});
test("unknown facts and ambiguous placement are not filled with invented data or transitions", () => {
  const review = reviewFlowNote("確認する。", graph, wid);
  assert.equal(review.steps[0].executionMode, "unknown");
  assert.equal(review.steps[0].data.length, 0);
  assert.equal(review.dataFlows.length, 0);
  assert.ok(review.warnings.length);
  const branched = {
    ...graph,
    edges: [
      ...graph.edges,
      {
        id: "branch",
        source: anchor,
        target: getWorkflowProcesses(graph, wid)[11].id,
        relation: "next" as const,
        workflowIds: [wid],
      },
    ],
  };
  assert.throws(
    () => planFlowAddition(branched, wid, anchor, "確認する", "branch", review),
    /分岐/,
  );
  assert.throws(
    () =>
      planFlowAddition(graph, wid, "missing", "確認する", "missing", review),
    /接続先/,
  );
  assert.throws(
    () => reviewFlowNote("確認する。".repeat(9), graph, wid),
    /8文/,
  );
});
test("detail context retains the same step, explicit data operations and executing system", () => {
  const credit = getWorkflowProcesses(graph, wid).find((s) =>
    s.label.includes("与信"),
  )!;
  const context = stepContext(graph, wid, credit.id);
  assert.equal(context.step, credit);
  assert.ok(context.previous && context.next);
  assert.ok(context.inputs.some((n) => n.label.includes("与信限度")));
  assert.ok(context.executingSystems.some((n) => n.label.includes("SAP")));
  assert.ok(
    traceData(graph, wid, context.inputs[0].id).some(
      (t) => t.step.id === credit.id,
    ),
  );
});

test("append preserves conditional routing and other memberships, rejects a nonsequential branch", () => {
  const outgoing = graph.edges.find(e => e.source === anchor && e.relation === "next")!;
  const conditional = {...graph, edges: graph.edges.map(e => e.id === outgoing.id ? {...e, label: "差異がある場合", workflowIds: [wid, "shared-route"]} : e)};
  const review = reviewFlowNote("営業担当が確認する。", graph, wid);
  const plan = planFlowAddition(conditional, wid, anchor, "営業担当が確認する。", "conditional", review);
  const result = applyFlowAddition(conditional, plan);
  assert.deepEqual(result.edges.find(e => e.id === outgoing.id)?.workflowIds, ["shared-route"]);
  assert.equal(result.edges.find(e => e.source === anchor && e.target === plan.stepIds[0])?.label, "差異がある場合");
  const nonsequential = {...graph, edges: graph.edges.map(e => e.id === outgoing.id ? {...e, target: getWorkflowProcesses(graph, wid)[12].id} : e)};
  assert.throws(() => planFlowAddition(nonsequential, wid, anchor, "確認する", "skip", review), /分岐/);
  assert.throws(() => applyFlowAddition(nonsequential, plan), /分岐/);
});

test("system mentions escape punctuation, prefer exact names, and never guess ambiguous aliases", () => {
  const custom = {...graph, nodes: [...graph.nodes, {id: "qa-system", canonicalKey: "system:qa-system", kind: "system" as const, label: "QA (A+B)", description: "test", status: "confirmed" as const}]};
  const note = reviewFlowNote("営業担当がQA (A+B)から「記録」をTeamsへ手動で転記する。", custom, wid);
  assert.equal(note.dataFlows[0].sourceSystem, "QA (A+B)");
  const sap = graph.nodes.find(n => n.label === "SAP S/4HANA")!;
  const ambiguous = {...graph, nodes: [...graph.nodes, {...sap, id: "other-sap", label: "別のSAP", aliases: ["SAP"]}]};
  assert.equal(reviewFlowNote("SAPから「記録」をTeamsへ転記する。", ambiguous, wid).dataFlows.length, 0);
  assert.equal(reviewFlowNote("SAP S/4HANAから「記録」をTeamsへ転記する。", ambiguous, wid).dataFlows[0].sourceSystem, "SAP S/4HANA");
  assert.equal(reviewFlowNote("ASAPから「記録」をTeamsへ転記する。", graph, wid).dataFlows.length, 0);
});

test("conditional extracted transitions retain their meaning instead of becoming unconditional steps", () => {
  const review = reviewFlowNote("営業担当が確認する。営業担当が送信する。", graph, wid);
  review.transitions = [{fromStepKey: review.steps[0].stepKey, toStepKey: review.steps[1].stepKey, condition: "承認済みの場合", evidence: "承認後に送信"}];
  const plan = planFlowAddition(graph, wid, anchor, "承認後に送信", "conditional-note", review);
  const result = applyFlowAddition(graph, plan);
  const edges = result.edges.filter(e=>e.source===plan.stepIds[0]&&e.target===plan.stepIds[1]&&e.relation==='next');
  assert.equal(edges.length,1);
  assert.equal(edges[0].label,"承認済みの場合");
  assert.throws(() => planFlowAddition(graph, wid, anchor, "分岐", "branched-note", {...review, transitions: [...review.transitions, {...review.transitions[0], condition: "却下の場合"}]}), /分岐/);
});
