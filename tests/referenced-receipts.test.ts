import test from "node:test";
import assert from "node:assert/strict";
import { extractGroundedLocal } from "../lib/local-review";
import { previewReviewGraph } from "../lib/review-workbench";
import { suggestMissingReceipts, validateReviewConnections } from "../lib/review-connections";
import type { Workflow } from "../lib/graph";

const sender: Workflow = { id: "shipping", name: "出荷の段取り", scenario: "current" };
const receiver: Workflow = { id: "picking", name: "倉庫で製品をそろえる", scenario: "current" };
const source = "出荷の段取りで営業が作った出荷指示書を、倉庫担当がTeamsで受け取ります。";
function fixture() {
  const review = extractGroundedLocal(source);
  review.steps[0].data = [{ name: "出荷指示書", operation: "receive", evidence: source }];
  review.steps[0].evidence = "「営業が作った出荷指示書を、倉庫担当がTeamsで受け取ります」";
  review.incomingHandoffs = [];
  const sent = extractGroundedLocal("営業がSAPで出荷指示書を作り、倉庫担当へTeamsで渡します。");
  sent.steps = [sent.steps[0]];
  sent.steps[0].stepKey = "send-instruction";
  sent.steps[0].data = [{ name: "出荷指示書", operation: "send", evidence: sent.steps[0].evidence }];
  const graph = previewReviewGraph({ workflows: [], nodes: [], edges: [], dataFlows: [] }, sender, sent);
  return { review, graph, sent };
}

test("a literal named receipt with one recorded output becomes an inferred candidate, with its evidence", () => {
  const { review, graph } = fixture();
  const next = validateReviewConnections(suggestMissingReceipts(review, graph, receiver, source), graph, receiver);
  assert.equal(next.incomingHandoffs?.length, 1);
  const receipt = next.incomingHandoffs![0];
  assert.equal(receipt.sourceWorkflowId, "shipping");
  assert.equal(receipt.sourceStepKey, "send-instruction");
  assert.equal(receipt.toStepKey, review.steps[0].stepKey);
  assert.equal(receipt.certainty, "inferred");
  assert.equal(receipt.evidence, source.slice(0, -1));
  assert.equal(receipt.via, "handoff");
  assert.deepEqual(review.incomingHandoffs, []);
  assert.equal(suggestMissingReceipts(next, graph, receiver, source).incomingHandoffs?.length, 1);
});

test("missing outputs and duplicate workflow names remain questions instead of selected sources", () => {
  const { review, graph, sent } = fixture();
  const duplicate = previewReviewGraph(graph, { ...sender, id: "other-shipping" }, sent);
  const ambiguous = suggestMissingReceipts(review, duplicate, receiver, source);
  assert.equal(ambiguous.incomingHandoffs?.length, 0);
  assert(ambiguous.questions.some(q => q.question.includes("どの手順から")));
  const noOutput = { ...graph, edges: graph.edges.filter(e => e.relation !== "sends") };
  assert.equal(suggestMissingReceipts(review, noOutput, receiver, source).incomingHandoffs?.length, 0);
  assert(suggestMissingReceipts(review, noOutput, receiver, source).questions.length > review.questions.length);
  const duplicateWithoutOutput = { ...graph, workflows: [...graph.workflows, { ...sender, id: "empty-shipping" }] };
  assert.equal(suggestMissingReceipts(review, duplicateWithoutOutput, receiver, source).incomingHandoffs?.length, 0);
});

test("mentions, unrelated evidence, negative receipts and future-only output do not create a handoff", () => {
  const { review, graph } = fixture();
  const mentioned = source.replace("受け取ります", "受け取らず、後で説明します");
  review.steps[0].evidence = mentioned;
  assert.equal(suggestMissingReceipts(review, graph, receiver, mentioned).incomingHandoffs?.length, 0);
  const unknown = source.replace("受け取ります", "受け取るかは未確認です");
  review.steps[0].evidence = unknown;
  assert.equal(suggestMissingReceipts(review, graph, receiver, unknown).incomingHandoffs?.length, 0);
  review.steps[0].evidence = "担当が指示書を別の場所で受け取ります";
  assert.equal(suggestMissingReceipts(review, graph, receiver, source).incomingHandoffs?.length, 0);
  review.steps[0].evidence = source;
  graph.workflows[0].scenario = "future";
  assert.equal(suggestMissingReceipts(review, graph, receiver, source).incomingHandoffs?.length, 0);
});

test("the receiving step's human source choice and unknown source evidence stay protected", () => {
  const { review, graph } = fixture();
  review.incomingHandoffs = [{ sourceWorkflowId: "manual-source", toStepKey: review.steps[0].stepKey,
    data: ["出荷指示書"], description: "利用者の訂正", evidence: "利用者の訂正", certainty: "confirmed", origin: "human" }];
  assert.deepEqual(suggestMissingReceipts(review, graph, receiver, source).incomingHandoffs, review.incomingHandoffs);
  review.incomingHandoffs = [];
  graph.nodes.find(n => n.kind === "process")!.status = "unknown";
  assert.equal(suggestMissingReceipts(review, graph, receiver, source).incomingHandoffs?.length, 0);
});

test("a unique send is the receipt source even when an earlier step creates the same Data", () => {
  const { review, graph, sent } = fixture();
  const created = { ...sent.steps[0], stepKey: "create-instruction", order: 1,
    data: [{ name: "出荷指示書", operation: "create" as const, evidence: "指示書を作る" }] };
  const two = previewReviewGraph(graph, sender, { ...sent, steps: [created, { ...sent.steps[0], order: 2 }] });
  assert.equal(suggestMissingReceipts(review, two, receiver, source).incomingHandoffs?.[0].sourceStepKey, "send-instruction");
  const branches = previewReviewGraph(two, sender, { ...sent, steps: [created, sent.steps[0], { ...sent.steps[0], stepKey: "other-send", order: 3 }] });
  assert.equal(suggestMissingReceipts(review, branches, receiver, source).incomingHandoffs?.length, 0);
});
