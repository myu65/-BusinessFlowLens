import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { extractGroundedLocal } from "../lib/local-review";
import { validateAITransitions } from "../lib/review-connections";
import { replaceWorkflowGraph, type LensGraph } from "../lib/graph";
import { resolveWorkflowReviewLocally } from "../lib/ai/provider";
import { stepContext } from "../lib/flow-context";
import { WorkflowReading } from "../components/WorkflowReading";
import { InputFlowCanvas } from "../components/InputFlowCanvas";

const stop = "数量が一致しない場合は登録を保留して";
const inquiry = "物流へメールで確認します。";
const source = stop + inquiry;
function fixture(targetAction = "物流へメールで数量を確認する", targetEvidence = inquiry, transitionEvidence = source) {
  const review = extractGroundedLocal("登録を保留する。数量を確認する。");
  review.steps = review.steps.slice(0, 2).map((s, i) => ({ ...s, stepKey: `s${i}`, order: i + 1, data: [], systems: [] }));
  review.steps[0] = { ...review.steps[0], name: "登録を保留する", action: "訂正伝票の登録を保留する", evidence: stop,
    meaning: { purpose: "", basis: "数量不一致", result: "登録を保留する", next: "", condition: "数量が一致しない場合", halt: true, certainty: "confirmed", evidence: stop } };
  review.steps[1] = { ...review.steps[1], name: targetAction, action: targetAction, evidence: targetEvidence,
    meaning: { purpose: "", basis: "", result: "物流へ確認する", next: "", condition: "数量が一致しない場合", halt: false, certainty: "confirmed", evidence: targetEvidence },
    systems: [{ name: "メール", interaction: "send", evidence: targetEvidence }],
    data: [{ name: "数量の確認依頼", operation: "send", evidence: targetEvidence }] };
  review.transitions = [{ fromStepKey: "s0", toStepKey: "s1", condition: null, evidence: transitionEvidence, certainty: "confirmed" }];
  return review;
}

test("a literal inquiry in the stopped clause keeps the offered connection and original hold, without inventing a release", () => {
  const draft = fixture(), before = JSON.stringify(draft), result = validateAITransitions(draft, source);
  assert.equal(result.transitions.length, 1); assert.equal(result.transitions[0].holdEffect, "response");
  assert.equal(result.transitions[0].evidence, source); assert.equal(result.transitions[0].certainty, "confirmed");
  assert.deepEqual(result.steps, draft.steps); assert.equal(result.steps[0].meaning?.halt, true);
  assert.equal(JSON.stringify(draft), before);
  const missing = validateAITransitions({ ...draft, transitions: [] }, source);
  assert.equal(missing.transitions.length, 0, "the validator does not invent a model-omitted edge");
  const negativeRelease = stop + "再開せず" + inquiry;
  const held = validateAITransitions(fixture(undefined, inquiry, negativeRelease), negativeRelease);
  assert.equal(held.transitions[0].holdEffect, "response");
});

test("the quoted recipient anchors an inquiry even when the action puts the channel first or names it separately", () => {
  for (const action of ["メールで物流へ確認する", "物流へ数量を確認する", "物流にメールで数量を確認する"]) {
    const result = validateAITransitions(fixture(action), source);
    assert.equal(result.transitions[0]?.holdEffect, "response", action);
    assert.equal(result.transitions[0].evidence, source);
  }
  const reversed = "メールで物流へ確認します。";
  const result = validateAITransitions(fixture("物流へ数量を確認する", reversed, stop + reversed), stop + reversed);
  assert.equal(result.transitions[0]?.holdEffect, "response");
});

test("inquiries cannot bridge another episode, hide uncertainty, turn system checks into handoffs, or proceed to normal writes", () => {
  for (const [action, evidence, text] of [
    ["SAPで数量を確認する", "SAPで数量を確認します。", stop + "SAPで数量を確認します。"],
    ["物流へメールで確認する", "物流へメールで確認しません。", stop + "物流へメールで確認しません。"],
    ["物流へメールで確認する", "物流へメールで確認するかは未確認です。", stop + "物流へメールで確認するかは未確認です。"],
    ["物流へメールで確認してSAPへ訂正伝票を登録する", inquiry, source],
    ["物流へメールで確認して出荷を確定する", inquiry, source],
    ["物流へメールで確認する", inquiry, stop + "います。別の依頼では" + inquiry],
    ["物流へメールで確認する", "物流課長へメールで確認します。", source],
    ["経理へメールで確認する", inquiry, source],
    ["逆物流へメールで確認する", inquiry, source],
  ]) assert.equal(validateAITransitions(fixture(action, evidence, text), text).transitions.length, 0, action + evidence);
  assert.equal(validateAITransitions(fixture(undefined, inquiry, inquiry), source).transitions.length, 0);
  const ambiguous = fixture();
  ambiguous.steps.push({ ...ambiguous.steps[0], stepKey: "another-hold" });
  assert.equal(validateAITransitions(ambiguous, source).transitions.length, 0);
});

test("a held inquiry remains traversable and visibly held at both steps after constructing the saved graph", () => {
  const review = validateAITransitions(fixture(), source);
  const empty: LensGraph = { workflows: [], nodes: [], edges: [], dataFlows: [] }, workflow = { id: "invoice", name: "請求を訂正する" };
  const resolved = resolveWorkflowReviewLocally({ review, workflow, graph: empty });
  const graph = replaceWorkflowGraph(empty, workflow, resolved.patch), before = JSON.stringify(graph);
  const stopped = graph.nodes.find(n => n.kind === "process" && n.stepOrder === 1)!, response = graph.nodes.find(n => n.kind === "process" && n.stepOrder === 2)!;
  assert.equal(stepContext(graph, workflow.id, stopped.id).next?.id, response.id);
  const unclassified: LensGraph = { ...graph, edges: graph.edges.map(e => ({ ...e, holdEffect: undefined })) };
  assert.equal(stepContext(unclassified, workflow.id, stopped.id).next, undefined);
  const props = { graph, workflowId: workflow.id, onDetail: () => {} };
  const stopHtml = renderToStaticMarkup(createElement(WorkflowReading, { ...props, initialStepId: stopped.id }));
  assert.match(stopHtml, /停止中の対応へ/); assert.match(stopHtml, /停止・保留を続けたまま/); assert.doesNotMatch(stopHtml, /再開 ·/);
  const responseHtml = renderToStaticMarkup(createElement(WorkflowReading, { ...props, initialStepId: response.id }));
  assert.match(responseHtml, /登録を保留する/); assert.match(responseHtml, /停止・保留を続けています/);
  assert.match(responseHtml, /③ 作る・更新する・渡す情報/); assert.match(responseHtml, /数量の確認依頼/);
  assert.equal(JSON.stringify(graph), before);
});

test("the input diagram explains a held response on both the original arrow and its page-boundary connection", () => {
  const review = validateAITransitions(fixture(), source);
  const fillers = Array.from({ length: 5 }, (_, i) => ({ ...review.steps[1], stepKey: `f${i}`, order: i + 1 }));
  const seven = { ...review, steps: [...fillers, { ...review.steps[0], order: 6 }, { ...review.steps[1], order: 7 }] };
  const html = renderToStaticMarkup(createElement(InputFlowCanvas, { review: seven, selected: seven.steps[6], page: 1, onPage: () => {}, choose: () => {}, onInsert: () => {} }));
  assert.match(html, /画面の外に続くつながり/); assert.match(html, /data-hold-effect="response"/);
  assert.match(html, /<title>停止中の対応<\/title>/); assert.match(html, /間に作業を追加 · 停止中の対応/);
  assert.ok((html.match(/class="input-canvas-step"/g) ?? []).length <= 6);
});
