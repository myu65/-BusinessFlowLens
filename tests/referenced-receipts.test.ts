import test from "node:test";
import assert from "node:assert/strict";
import { extractGroundedLocal } from "../lib/local-review";
import { previewReviewGraph } from "../lib/review-workbench";
import { suggestMissingSourceConnections, validateReviewConnections } from "../lib/review-connections";
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
  const next = validateReviewConnections(suggestMissingSourceConnections(review, graph, receiver, source), graph, receiver);
  assert.equal(next.incomingHandoffs?.length, 1);
  const receipt = next.incomingHandoffs![0];
  assert.equal(receipt.sourceWorkflowId, "shipping");
  assert.equal(receipt.sourceStepKey, "send-instruction");
  assert.equal(receipt.toStepKey, review.steps[0].stepKey);
  assert.equal(receipt.certainty, "inferred");
  assert.equal(receipt.evidence, source.slice(0, -1));
  assert.equal(receipt.via, "handoff");
  assert.deepEqual(review.incomingHandoffs, []);
  assert.equal(suggestMissingSourceConnections(next, graph, receiver, source).incomingHandoffs?.length, 1);
});

test("missing outputs and duplicate workflow names remain questions instead of selected sources", () => {
  const { review, graph, sent } = fixture();
  const duplicate = previewReviewGraph(graph, { ...sender, id: "other-shipping" }, sent);
  const ambiguous = suggestMissingSourceConnections(review, duplicate, receiver, source);
  assert.equal(ambiguous.incomingHandoffs?.length, 0);
  assert(ambiguous.questions.some(q => q.question.includes("どの手順から")));
  const noOutput = { ...graph, edges: graph.edges.filter(e => e.relation !== "sends") };
  assert.equal(suggestMissingSourceConnections(review, noOutput, receiver, source).incomingHandoffs?.length, 0);
  assert(suggestMissingSourceConnections(review, noOutput, receiver, source).questions.length > review.questions.length);
  const duplicateWithoutOutput = { ...graph, workflows: [...graph.workflows, { ...sender, id: "empty-shipping" }] };
  assert.equal(suggestMissingSourceConnections(review, duplicateWithoutOutput, receiver, source).incomingHandoffs?.length, 0);
});

test("mentions, unrelated evidence, negative receipts and future-only output do not create a handoff", () => {
  const { review, graph } = fixture();
  const mentioned = source.replace("受け取ります", "受け取らず、後で説明します");
  review.steps[0].evidence = mentioned;
  assert.equal(suggestMissingSourceConnections(review, graph, receiver, mentioned).incomingHandoffs?.length, 0);
  const unknown = source.replace("受け取ります", "受け取るかは未確認です");
  review.steps[0].evidence = unknown;
  assert.equal(suggestMissingSourceConnections(review, graph, receiver, unknown).incomingHandoffs?.length, 0);
  review.steps[0].evidence = "担当が指示書を別の場所で受け取ります";
  assert.equal(suggestMissingSourceConnections(review, graph, receiver, source).incomingHandoffs?.length, 0);
  review.steps[0].evidence = source;
  graph.workflows[0].scenario = "future";
  assert.equal(suggestMissingSourceConnections(review, graph, receiver, source).incomingHandoffs?.length, 0);
});

test("the receiving step's human source choice and unknown source evidence stay protected", () => {
  const { review, graph } = fixture();
  review.incomingHandoffs = [{ sourceWorkflowId: "manual-source", toStepKey: review.steps[0].stepKey,
    data: ["出荷指示書"], description: "利用者の訂正", evidence: "利用者の訂正", certainty: "confirmed", origin: "human" }];
  assert.deepEqual(suggestMissingSourceConnections(review, graph, receiver, source).incomingHandoffs, review.incomingHandoffs);
  review.incomingHandoffs = [];
  graph.nodes.find(n => n.kind === "process")!.status = "unknown";
  assert.equal(suggestMissingSourceConnections(review, graph, receiver, source).incomingHandoffs?.length, 0);
});

test("a unique send is the receipt source even when an earlier step creates the same Data", () => {
  const { review, graph, sent } = fixture();
  const created = { ...sent.steps[0], stepKey: "create-instruction", order: 1,
    data: [{ name: "出荷指示書", operation: "create" as const, evidence: "指示書を作る" }] };
  const two = previewReviewGraph(graph, sender, { ...sent, steps: [created, { ...sent.steps[0], order: 2 }] });
  assert.equal(suggestMissingSourceConnections(review, two, receiver, source).incomingHandoffs?.[0].sourceStepKey, "send-instruction");
  const branches = previewReviewGraph(two, sender, { ...sent, steps: [created, sent.steps[0], { ...sent.steps[0], stepKey: "other-send", order: 3 }] });
  assert.equal(suggestMissingSourceConnections(review, branches, receiver, source).incomingHandoffs?.length, 0);
});

function referenceFixture() {
  const source = "日次経営データを更新するで更新された日次経営データを、Power BIがSnowflakeから毎朝読み込みます。";
  const producer: Workflow = { id: "daily-data", name: "日次経営データを更新する", scenario: "current" };
  const reader: Workflow = { id: "dashboard", name: "朝の経営確認", scenario: "current" };
  const produced = extractGroundedLocal("ETLがSnowflakeの日次経営データを更新する。");
  produced.steps = [produced.steps[0]];
  produced.steps[0].stepKey = "update-daily-data";
  produced.steps[0].data = [{ name: "日次経営データ", operation: "update", evidence: produced.steps[0].evidence }];
  const graph = previewReviewGraph({ workflows: [], nodes: [], edges: [], dataFlows: [] }, producer, produced);
  const review = extractGroundedLocal(source);
  review.steps = [review.steps[0]];
  review.steps[0].evidence = source;
  review.steps[0].data = [{ name: "日次経営データ", operation: "read", evidence: source }];
  review.incomingHandoffs = [];
  return { source, graph, review, producer, reader, produced };
}

test("a named read points to the unique writer as a reference, not a delivered handoff", () => {
  const { source, graph, review, reader } = referenceFixture();
  const next = validateReviewConnections(suggestMissingSourceConnections(review, graph, reader, source), graph, reader);
  assert.equal(next.incomingHandoffs?.length, 1);
  assert.equal(next.incomingHandoffs![0].via, "reference");
  assert.equal(next.incomingHandoffs![0].sourceStepKey, "update-daily-data");
  assert.equal(next.incomingHandoffs![0].certainty, "inferred");
  const preview = previewReviewGraph(graph, reader, next);
  assert.equal(preview.knowledge?.handoffs?.[0].via, "reference");
  assert.equal(preview.dataFlows.length, graph.dataFlows.length);
});

test("two writers or a send without a recorded write leave the reference source unresolved", () => {
  const { source, graph, review, producer, reader, produced } = referenceFixture();
  const twoWriters = previewReviewGraph(graph, producer, { ...produced, steps: [produced.steps[0],
    { ...produced.steps[0], stepKey: "other-update", order: 2 }] });
  const unresolved = suggestMissingSourceConnections(review, twoWriters, reader, source);
  assert.equal(unresolved.incomingHandoffs?.length, 0);
  assert(unresolved.questions.some(q => q.question.includes("どの手順で作成・更新")));
  const sendOnly = { ...graph, edges: graph.edges.map(e => e.relation === "writes" ? { ...e, relation: "sends" as const } : e) };
  assert.equal(suggestMissingSourceConnections(review, sendOnly, reader, source).incomingHandoffs?.length, 0);
});

test("negative or uncertain reads, future sources and human corrections cannot become inferred references", () => {
  const { source, graph, review, reader } = referenceFixture();
  for (const ending of ["読み込まない", "読み込んでいません", "読みません", "読んでいない", "参照していません", "確認していない", "確認できていない", "参照できるか検討中", "読むかは未確認", "参照するかは分からない", "確認しない"]) {
    const unclear = source.replace("毎朝読み込みます", ending);
    review.steps[0].evidence = unclear;
    assert.equal(suggestMissingSourceConnections(review, graph, reader, unclear).incomingHandoffs?.length, 0);
  }
  review.steps[0].evidence = source;
  graph.workflows[0].scenario = "future";
  assert.equal(suggestMissingSourceConnections(review, graph, reader, source).incomingHandoffs?.length, 0);
  graph.workflows[0].scenario = "current";
  review.incomingHandoffs = [{ sourceWorkflowId: "manual", toStepKey: review.steps[0].stepKey,
    data: ["日次経営データ"], via: "reference", description: "人の訂正", evidence: "人の訂正", certainty: "confirmed", origin: "human" }];
  assert.deepEqual(suggestMissingSourceConnections(review, graph, reader, source).incomingHandoffs, review.incomingHandoffs);
});
