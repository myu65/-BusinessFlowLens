// Opt-in live verification using synthetic interview notes only.
// Run with AI_BASE_URL, AI_MODEL and AI_API_KEY set; never logs credentials.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createDemoGraph, type LensGraph } from "../lib/graph";
import {
  extractWorkflowReviewWithAI,
  resolveWorkflowReviewWithAI,
} from "../lib/ai/provider";
import { mergeAssets } from "../lib/refinement";

async function main() {
  const workflow = { id: "live-synthetic", name: "検証用受注業務" };
  const graph: LensGraph = {
    workflows: [workflow],
    edges: [],
    dataFlows: [],
    nodes: [],
  };
  const results: Record<string, unknown> = {};
  const record = (name: string, result: unknown) => {
    results[name] = result;
    mkdirSync(".data/qa-issue6", { recursive: true });
    writeFileSync(
      ".data/qa-issue6/live-model-results.json",
      JSON.stringify(
        {
          model: process.env.AI_MODEL,
          testedAt: new Date().toISOString(),
          results,
        },
        null,
        2,
      ),
    );
  };
  const vague = await extractWorkflowReviewWithAI({
    workflow,
    graph,
    interview:
      "たぶん営業が注文を受けてERPで登録する。あとは担当の人が確認する。担当者名、承認条件、連携方式は未確認。別の資料ではSAPと書いてあるけど、ERPと同じかはまだ分からない。",
  });
  record("vague", vague);
  assert.ok(vague.review.steps.length > 0);
  assert.ok(
    vague.review.questions.length > 0 || vague.review.warnings.length > 0,
  );
  assert.ok(vague.review.steps.every((step) => !step.responsiblePerson));
  assert.ok(vague.review.steps.every((step) => !step.technicalDetails?.length));
  assert.equal(vague.review.dataFlows.length, 0);
  results.vague = vague;
  console.log(
    "PASS: vague input preserves unknowns without invented technical details",
  );

  const explicit = await extractWorkflowReviewWithAI({
    workflow,
    graph,
    interview:
      "営業部の田中さんがSAP 本番で受注を登録する。SAPモジュール: 受注領域、トランザクション: Z_ORDER、HANA領域: BUSINESS、ビュー: ORDER_VIEW。これらは今回の検証用の名称。登録画面で必須項目を入力し、内容を確認して保存する。入力が足りない場合は保存せず営業へ確認する。",
  });
  record("explicit", explicit);
  const step = explicit.review.steps.find((item) =>
    item.technicalDetails?.some((detail) =>
      detail.transaction?.includes("Z_ORDER"),
    ),
  );
  assert.ok(step, "stated transaction must be captured");
  assert.ok(
    step.technicalDetails?.some(
      (detail) =>
        detail.hanaArea?.includes("BUSINESS") &&
        detail.objects?.includes("ORDER_VIEW"),
    ),
  );
  assert.ok(
    explicit.review.steps.some(
      (item) =>
        item.department === "営業部" && item.responsiblePerson === "田中さん",
    ),
  );
  results.explicit = explicit;
  console.log(
    "PASS: stated SAP transaction and HANA physical objects are extracted",
  );

  step.detailSteps = [
    {
      id: "human-operation",
      action: "入力の根拠を確認する",
      condition: "申請が揃った場合",
      evidence: "人が追記した検証情報",
    },
  ];
  step.technicalDetails!.push({
    system: "SAP 本番",
    module: null,
    transaction: "Z_HUMAN",
    hanaArea: null,
    objects: null,
    evidence: "人が追記した検証情報",
  });
  const refined = await extractWorkflowReviewWithAI({
    workflow,
    graph,
    previousReview: explicit.review,
    interview:
      "既存の手順と人が追記した技術情報はそのまま維持する。登録後に営業部が保存結果を確認することを追加したい。",
  });
  assert.ok(
    refined.review.steps.some((item) =>
      item.detailSteps?.some(
        (detail) =>
          detail.id === "human-operation" &&
          detail.action === "入力の根拠を確認する",
      ),
    ),
  );
  assert.ok(
    refined.review.steps.some((item) =>
      item.technicalDetails?.some((detail) => detail.transaction === "Z_HUMAN"),
    ),
  );
  results.refined = refined;
  console.log("PASS: real-model refinement preserves manual details");

  const aliasGraph = createDemoGraph();
  aliasGraph.nodes.push({
    id: "system:sap-test",
    canonicalKey: "system:sap-test",
    kind: "system",
    label: "SAP 本番",
    description: "検証用",
    status: "confirmed",
  });
  const merged = mergeAssets(aliasGraph, "system:erp", "system:sap-test");
  const resolved = await resolveWorkflowReviewWithAI({
    workflow,
    graph: merged,
    review: vague.review,
  });
  assert.ok(
    resolved.patch.nodes.some(
      (node) =>
        node.kind === "system" && node.canonicalKey === "system:sap-test",
    ),
  );
  assert.ok(
    !resolved.patch.nodes.some((node) => node.canonicalKey === "system:erp"),
  );
  results.aliasResolution = resolved;
  console.log(
    "PASS: confirmed ERP alias reuses SAP after real-model resolution",
  );
  mkdirSync(".data/qa-issue6", { recursive: true });
  writeFileSync(
    ".data/qa-issue6/live-model-results.json",
    JSON.stringify(
      {
        model: process.env.AI_MODEL,
        testedAt: new Date().toISOString(),
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    "Live model checks: 4 passed. Synthetic results saved to .data/qa-issue6/live-model-results.json",
  );
}
main().catch((error) => {
  // Avoid echoing raw provider errors which could contain provider headers.
  console.error(
    "Live verification failed:",
    error instanceof assert.AssertionError
      ? error.message
      : "Provider request failed; check configured model and connectivity.",
  );
  process.exitCode = 1;
});
