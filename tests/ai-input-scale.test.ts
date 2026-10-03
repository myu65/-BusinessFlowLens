import test from "node:test";
import assert from "node:assert/strict";
import { buildAssetResolutionContext, scopedAssetNodes } from "../lib/ai/asset-context";
import { buildPreviousReviewContext } from "../lib/ai/context";
import { extractGroundedLocal } from "../lib/local-review";
import type { LensGraph, LensNode } from "../lib/graph";

const node = (id: string, label: string): LensNode => ({
  id, canonicalKey: `data:${id}`, kind: "data", label,
  description: "入力された記録", status: "confirmed",
});

test("asset retrieval finds a late alias and preserves ambiguity without sending an accumulated company catalog", () => {
  const nodes = Array.from({ length: 1500 }, (_, i) => node(`record-${i}`, `記録${i}`));
  nodes.push({ ...node("tokyo", "東京工場の調達回答"), aliases: ["購買回答"] });
  nodes.push({ ...node("osaka", "大阪工場の調達回答"), aliases: ["購買回答"] });
  const context = buildAssetResolutionContext(nodes, [{
    candidateId: "reply", kind: "data", name: "購買回答", evidence: ["購買回答を受け取る"],
  }]);
  const keys = context.candidates[0].comparisonKeys;
  assert(keys.includes("data:tokyo"));
  assert(keys.includes("data:osaka"));
  assert(context.catalog.every(n => n.kind === "data"));
  assert(context.catalog.length <= 60);
  assert(JSON.stringify(context).length < 5000);
  assert.equal(context.scope.totalAssets, 1502);
  // Retrieval is reference information; no selected candidate is confirmed.
  assert(!("decision" in context.candidates[0]));
});

test("shared-asset comparison keeps current, future and explicit baseline scope distinct", () => {
  const graph: LensGraph = {
    workflows: [{ id: "now", name: "現在" }, { id: "later", name: "将来", scenario: "future" }],
    nodes: [node("now", "現在の記録"), node("later", "将来の記録"), node("shared", "共通マスタ")],
    edges: [
      { id: "n", source: "process-n", target: "now", relation: "reads", workflowIds: ["now"] },
      { id: "f", source: "process-f", target: "later", relation: "reads", workflowIds: ["later"] },
    ],
    dataFlows: [],
  };
  assert.deepEqual(scopedAssetNodes(graph, { id: "new", name: "話" }).map(n => n.id), ["now", "shared"]);
  assert.deepEqual(scopedAssetNodes(graph, { id: "new", name: "案", scenario: "future" }).map(n => n.id), ["later", "shared"]);
  assert.equal(scopedAssetNodes(graph, { id: "new", name: "案", scenario: "future", basedOnWorkflowId: "now" }).length, 3);
});

test("large description and many mentions remain bounded while each mention receives an initial comparison", () => {
  const nodes = Array.from({ length: 300 }, (_, i) => ({
    ...node(`record-${i}`, `工場${i}記録`), description: "詳細な説明".repeat(300),
  }));
  const mentions = Array.from({ length: 30 }, (_, i) => ({
    candidateId: String(i), kind: "data" as const, name: `工場${299-i}記録`, evidence: ["受け取る"],
  }));
  const context = buildAssetResolutionContext(nodes, mentions);
  assert(context.catalog.length <= 60);
  assert(JSON.stringify(context).length < 30000);
  context.candidates.forEach((c, i) => assert(c.comparisonKeys.includes(`data:record-${299-i}`)));
});

test("rereading removes repeated AI detail but retains stable steps, human corrections and exclusions", () => {
  const review = extractGroundedLocal("営業がExcelで数量を確認する。");
  review.steps[0].action = "古い説明".repeat(500);
  review.steps[0].humanEdits = [{ field: "actor", before: "担当", after: "営業課長", evidence: "利用者の訂正" }];
  review.steps[0].detailSteps = [{ id: "check", action: "入力数量を確認", condition: null, evidence: "数量を確認する" }];
  review.excludedSteps = [structuredClone(review.steps[0])];
  const context = buildPreviousReviewContext(review);
  assert.equal(context.steps[0].stepKey, review.steps[0].stepKey);
  assert.deepEqual(context.steps[0].humanEdits, [{ field: "actor", after: "営業課長", evidence: "利用者の訂正" }]);
  assert.equal(context.steps[0].detailSteps?.[0].id, "check");
  assert.equal(context.excludedSteps?.[0].stepKey, review.steps[0].stepKey);
  assert(!JSON.stringify(context).includes("古い説明"));
});
