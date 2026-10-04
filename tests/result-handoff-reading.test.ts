import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkflowReading } from "../components/WorkflowReading";
import type { LensGraph, LensNode } from "../lib/graph";
import type { WorkflowHandoff } from "../lib/flow-context";

const process = (id: string, workflowId: string, stepOrder: number): LensNode => ({ id, label: id, canonicalKey: id, workflowId, stepOrder,
  kind: "process", description: "", status: "confirmed", meaning: { purpose: "", basis: "コード不一致", result: "登録せず通知する", next: "",
    condition: "コードが合わない場合", halt: true, certainty: "confirmed", evidence: "コードが合わない注文は登録せず知らせる" } });
function fixture() {
  const h: WorkflowHandoff = { id: "notify", sourceWorkflowId: "order", sourceProcessId: "notify", targetWorkflowId: "investigate", targetProcessId: "receive",
    dataIds: ["notice"], description: "通知を受けて原因を調べる", evidence: "注文のコード不一致通知を受け取る", kind: "information", status: "confirmed" };
  const graph: LensGraph = { workflows: [{ id: "order", name: "ポータル注文" }, { id: "investigate", name: "登録エラーの調査" }],
    nodes: [process("enter", "order", 1), process("notify", "order", 2), process("receive", "investigate", 1),
      { id: "notice", canonicalKey: "notice", kind: "data", label: "コード不一致通知", description: "", status: "confirmed" }],
    edges: [], dataFlows: [], knowledge: { name: "", description: "", activities: [], categories: [], systems: [], criticalWorkflows: [], handoffs: [h] } };
  return { graph, h };
}
const reading = (graph: LensGraph, initialStepId = "notify") => renderToStaticMarkup(createElement(WorkflowReading, { graph, workflowId: "order", initialStepId, onDetail: () => {} }));
const resultConnections = (html: string) => html.match(/<section[^>]*aria-label="この結果に登録された業務との接続">([\s\S]*?)<\/section>/)?.[1];

test("a later recorded handoff is readable beside the result without changing the source or asserting that a held order resumes", () => {
  const { graph } = fixture(), before = JSON.stringify(graph), html = reading(graph), result = resultConnections(html)!;
  assert.ok(result);
  assert.match(result, /情報を渡す業務：.*登録エラーの調査/);
  assert.match(result, /コード不一致通知.*接続の根拠あり/);
  assert.doesNotMatch(html, /結果によって動く仕事は未確認/);
  assert.match(html, /停止・保留/);
  assert.doesNotMatch(result, /再開|解除|次の業務/);
  assert.equal(JSON.stringify(graph), before);
});

test("references and pending information are shown with their own certainty, while the input explanation stays available", () => {
  const { graph, h } = fixture();
  graph.nodes[1].meaning!.next = "回答後の再送は未確認";
  graph.knowledge!.handoffs = [{ ...h, via: "reference", status: "inferred", dataIds: [], dataNames: ["登録不可の理由"] }];
  const result = resultConnections(reading(graph))!;
  assert.match(result, /この情報を使う業務/);
  assert.match(result, /登録不可の理由・情報の対応は要確認.*接続は推定・要確認/);
  assert.match(result, /入力時の説明を見る.*回答後の再送は未確認/);
  assert.doesNotMatch(result, /情報を渡す業務|接続の根拠あり/);
});

test("another step, an unspecified source step or a future destination cannot establish this step's next work", () => {
  for (const edit of [(h: WorkflowHandoff) => ({ ...h, sourceProcessId: "enter" }),
    (h: WorkflowHandoff) => ({ ...h, sourceProcessId: undefined }),
    (h: WorkflowHandoff) => ({ ...h, targetWorkflowId: "future" })]) {
    const { graph, h } = fixture();
    graph.workflows.push({ id: "future", name: "将来の調査", scenario: "future" });
    graph.knowledge!.handoffs = [edit(h)];
    const html = reading(graph);
    assert.equal(resultConnections(html), undefined);
    assert.match(html, /結果によって動く仕事は未確認/);
  }
});

test("the result limits connection summaries and preserves access to the rest of the work connections", () => {
  const { graph, h } = fixture();
  graph.knowledge!.handoffs = Array.from({ length: 30 }, (_, i) => ({ ...h, id: `notify-${i}`, kind: i === 0 ? "material" : "information" }));
  const result = resultConnections(reading(graph))!;
  assert.equal((result.match(/<button/g) ?? []).length, 3);
  assert.match(result, /物を渡す業務/);
  assert.match(result, /ほか27件.*条件と次の仕事/);
});
