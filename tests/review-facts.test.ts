import test from "node:test";
import assert from "node:assert/strict";
import type { ExtractionReview, ExtractionReviewStep } from "../lib/graph";
import { separateMissingFacts } from "../lib/review-facts";

const step = (key: string, evidence: string, action = evidence): ExtractionReviewStep => ({
  stepKey: key, name: action, action, evidence, order: 1, actor: null,
  department: null, responsiblePerson: null, executingSystem: null,
  executionMode: "unknown", certainty: "explicit", systems: [], data: [],
});
const review = (steps: ExtractionReviewStep[]): ExtractionReview => ({
  summary: "", trigger: null, outcome: null, steps, transitions: [],
  dataFlows: [], questions: [], warnings: [],
});

test("a missing owner remains a source-grounded question without creating a task or bridging its branch", () => {
  const fact = "反応が止まった場合の廃液の処理担当はまだ分かりません。";
  const draft = review([step("react", "原料を反応させます。"),
    step("unknown", `「${fact.slice(0, -1)}」`, "廃液処理担当を確認する"), step("record", "温度を記録します。")]);
  draft.transitions = [{ fromStepKey: "react", toStepKey: "unknown", condition: "反応停止時", evidence: fact },
    { fromStepKey: "unknown", toStepKey: "record", condition: null, evidence: fact }];
  draft.dataFlows = [{ sourceSystem: "A", targetSystem: "B", data: ["廃液記録"],
    transferType: "manual", direction: "push", automation: "manual", frequency: null,
    evidence: fact, certainty: "inferred", relatedStepKeys: ["unknown"] }];
  const result = separateMissingFacts(draft, `原料を反応させます。温度を記録します。${fact}`);
  assert.deepEqual(result.steps.map(s => s.stepKey), ["react", "record"]);
  assert.equal(result.transitions.length, 0);
  assert.equal(result.dataFlows.length, 0);
  assert.equal(result.questions[0].target, "owner");
  assert.ok(result.questions[0].question.includes(fact.slice(0, -1)));
  assert.ok(result.warnings[0].includes("確認事項"));
  assert.equal(draft.steps.length, 3);
});

test("known actions remain when their actor, tool or continuation is unknown", () => {
  for (const evidence of ["担当は不明です。価格を確定します。", "担当が不明なので経理に照会します。",
    "廃液を処理する担当は分かりません。", "反応が止まった場合は班長が担当を確認します。",
    "廃液処理担当を確認する手順は未確認です。", "温度を記録します。使う道具は未確認です。"] ) {
    const draft = review([step("known", evidence)]);
    assert.equal(separateMissingFacts(draft, evidence).steps.length, 1, evidence);
  }
});

test("ungrounded model quotes and human corrections are preserved", () => {
  const evidence = "再開先は未確認です。";
  assert.equal(separateMissingFacts(review([step("invented", evidence)]), "再開先は計画担当です。").steps.length, 1);
  const human = step("human", evidence);
  human.humanEdits = [{ field: "action", before: "未確認", after: "担当に聞く", evidence: "利用者の補足" }];
  assert.equal(separateMissingFacts(review([human]), evidence).steps.length, 1);
});
