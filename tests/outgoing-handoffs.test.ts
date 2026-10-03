import test from "node:test";
import assert from "node:assert/strict";
import type { ExtractionReview, Workflow } from "../lib/graph";
import { extractGroundedLocal } from "../lib/local-review";
import { previewReviewGraph } from "../lib/review-workbench";
import { validateReviewConnections } from "../lib/review-connections";

const sender: Workflow = { id: "scaleup", name: "量産検討", scenario: "current" };
const target: Workflow = { id: "planning", name: "量産試験を計画する", scenario: "current" };
const source = "製造課長が生産計画担当へTeamsで試験依頼を渡します。";
function fixture() {
  const receiving = extractGroundedLocal("生産計画担当がTeamsで試験依頼を受け取る。");
  receiving.steps = [{ ...receiving.steps[0], stepKey: "receive", actor: "生産計画担当",
    data: [{ name: "試験依頼", operation: "receive", evidence: "試験依頼を受け取る" }] }];
  const graph = previewReviewGraph({ workflows: [], nodes: [], edges: [], dataFlows: [] }, target, receiving);
  const review: ExtractionReview = extractGroundedLocal(source);
  review.handoffs = [{ fromStepKey: review.steps[0].stepKey, targetWorkflowId: target.id,
    targetStepKey: "receive", data: ["試験依頼"], description: "受渡し", evidence: source,
    certainty: "confirmed", origin: "ai" }];
  return { receiving, graph, review };
}

test("an existing workflow ID cannot turn an unknown recipient into an unrelated work connection", () => {
  const { graph, review } = fixture();
  graph.workflows[0] = { id: target.id, name: "原料を調達する", scenario: "current" };
  graph.nodes = graph.nodes.map(n => n.kind === "process" ? { ...n, actor: "調達担当" } : n);
  const result = validateReviewConnections(review, graph, sender, source);
  assert.equal(result.handoffs?.length, 0);
  assert.equal(result.steps.length, review.steps.length);
  assert.equal(result.steps[0].data.length, review.steps[0].data.length);
  assert.ok(result.questions.some(q => q.reason.includes(source)));
});

test("a unique recorded recipient and input supports only an inferred workflow mapping", () => {
  const { graph, review } = fixture();
  const result = validateReviewConnections(review, graph, sender, source);
  assert.equal(result.handoffs?.length, 1);
  assert.equal(result.handoffs![0].certainty, "inferred");
  const wrongSender = source.replace("製造課長が生産計画担当へ", "生産計画担当が研究主任へ");
  review.handoffs![0].evidence = wrongSender;
  assert.equal(validateReviewConnections(review, graph, sender, wrongSender).handoffs?.length, 0);
});

test("two receiving workflows remain ambiguous, while a literal named target disambiguates them", () => {
  const { receiving, graph, review } = fixture();
  const two = previewReviewGraph(graph, { ...target, id: "other", name: "別工場の試験計画" }, receiving);
  assert.equal(validateReviewConnections(review, two, sender, source).handoffs?.length, 0);
  const named = `${target.name}へ試験依頼を渡します。`;
  review.handoffs![0].evidence = named;
  assert.equal(validateReviewConnections(review, two, sender, named).handoffs?.length, 1);
  for (const evidence of [named.replace("渡します", "渡しません"), named.replace("渡します", "渡すか未確認です")]) {
    review.handoffs![0].evidence = evidence;
    assert.equal(validateReviewConnections(review, two, sender, evidence).handoffs?.length, 0);
  }
});

test("mismatching information, ungrounded evidence and other scenarios are rejected; human mapping stays", () => {
  const { graph, review } = fixture();
  review.handoffs![0].data = ["原料発注"];
  assert.equal(validateReviewConnections(review, graph, sender, source).handoffs?.length, 0);
  review.handoffs![0].data = ["試験依頼"];
  assert.equal(validateReviewConnections(review, graph, sender, "誰に渡すか分かりません。").handoffs?.length, 0);
  review.handoffs![0].origin = "human";
  assert.equal(validateReviewConnections(review, graph, sender, "追加した人の根拠").handoffs?.length, 1);
  graph.workflows[0].scenario = "future";
  assert.equal(validateReviewConnections(review, graph, sender, source).handoffs?.length, 0);
});

test("a known named workflow does not confirm an existing step that reads different information", () => {
  const { graph, review } = fixture();
  const named = `${target.name}へ試験依頼を渡します。`;
  review.handoffs![0].evidence = named;
  graph.edges = graph.edges.filter(e => e.relation !== "reads");
  const result = validateReviewConnections(review, graph, sender, named);
  assert.equal(result.handoffs?.length, 1);
  assert.equal(result.handoffs![0].targetStepKey, undefined);
  assert.equal(result.handoffs![0].certainty, "unknown");
});
