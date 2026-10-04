import test from "node:test";
import assert from "node:assert/strict";
import { extractGroundedLocal } from "../lib/local-review";
import { validateAITransitions } from "../lib/review-connections";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWorkflowReviewFromGraph, replaceWorkflowGraph, type FollowUpAnswer, type LensGraph } from "../lib/graph";
import { previewReviewGraph } from "../lib/review-workbench";
import { resolveWorkflowReviewLocally } from "../lib/ai/provider";
import { SqliteBusinessFlowRepository } from "../lib/storage/sqlite";

function fixture(action: string, evidence: string) {
  const review = extractGroundedLocal("機器の使用を停止する。担当が原因を直す。");
  review.steps = review.steps.slice(0, 2).map((s, i) => ({ ...s, stepKey: `s${i}`, order: i + 1 }));
  review.steps[0].evidence = evidence;
  review.steps[0].meaning = { purpose: "", basis: "", result: "機器を使用不可にする", next: "",
    condition: "範囲外の場合", halt: true, certainty: "confirmed", evidence };
  review.steps[1] = { ...review.steps[1], action, name: action, evidence };
  review.transitions = [{ fromStepKey: "s0", toStepKey: "s1", condition: "範囲外の場合", evidence }];
  return review;
}

test("a stated notice or report can follow stopping without pretending to release it", () => {
  for (const verb of ["知らせる", "報告する"]) {
    const source = `範囲外なら機器を使用不可にして、課長へTeamsで${verb}。`;
    const draft = fixture(`課長へTeamsで${verb}`, source);
    const result = validateAITransitions(draft, source);
    assert.equal(result.transitions.length, 1);
    assert.equal(result.steps[0].meaning?.halt, true);
    assert.equal(result.transitions[0].holdEffect, "response");
  }
});

const stopSource = "取込みエラーがあれば更新を止め、監視システムがデータ基盤担当へTeamsでエラー通知を送ります。";
const repairSource = "担当が原因を直した後にどこから再実行するかはまだ分かりません。";
function etlFixture(evidence: string) {
  const review = fixture("担当が原因を直す", evidence);
  review.steps[0].evidence = stopSource;
  review.steps[1].evidence = "担当が原因を直した後";
  review.transitions[0].certainty = "confirmed";
  return review;
}

test("an unknown restart after a stated repair leaves the repair reachable, without releasing the held result", () => {
  for (const evidence of [repairSource, "「取込みエラーがあれば」「担当が原因を直した後」"]) {
    const result = validateAITransitions(etlFixture(evidence), stopSource + repairSource);
    assert.equal(result.transitions.length, 1, evidence);
    assert.equal(result.transitions[0].holdEffect, "response");
    assert.equal(result.steps[0].meaning!.halt, true);
    assert.equal(result.steps[1].meaning?.halt, false);
    if (evidence.startsWith("「")) assert.equal(result.transitions[0].certainty, "inferred");
  }
});

test("quoted response fragments cannot fabricate a release, bridge another event, or conceal an unknown repair", () => {
  const quotes = "「取込みエラーがあれば」「担当が原因を直した後」";
  for (const source of [
    stopSource + "担当が原因を直すかは未確認です。",
    stopSource + "別の設備で温度逸脱が起きます。" + repairSource,
    repairSource + stopSource,
    stopSource + "担当は原因を直さないことにしました。",
  ]) assert.equal(validateAITransitions(etlFixture(quotes), source).transitions.length, 0, source);
  assert.equal(validateAITransitions(etlFixture(repairSource), stopSource + "別の設備で温度逸脱が起きます。" + repairSource).transitions.length, 0);
  const completion = etlFixture(quotes);
  completion.steps[1].action = "担当が原因を直して日次データを確定する";
  assert.equal(validateAITransitions(completion, stopSource + repairSource).transitions.length, 0);
  const fabricated = etlFixture('承認されたので「取込みエラーがあれば」「担当が原因を直した後」');
  assert.equal(validateAITransitions(fabricated, stopSource + repairSource).transitions.length, 0);
});

test("a literal repair while held can refer back to the sole hold, without choosing between multiple holds", () => {
  const explicit = "データ基盤担当の原因修正は更新が止まっている間に行います。";
  const source = stopSource + repairSource + "更新を止めるのはETLです。" + explicit;
  const review = etlFixture("原因修正は更新が止まっている間に行います");
  review.steps[1].evidence = explicit;
  const result = validateAITransitions(review, source);
  assert.equal(result.transitions.length, 1);
  assert.equal(result.transitions[0].holdEffect, "response");
  assert.equal(result.transitions[0].certainty, "inferred");
  const ambiguous = structuredClone(review);
  ambiguous.steps.push({ ...review.steps[0], stepKey: "another-hold", name: "別の更新を保留する" });
  assert.equal(validateAITransitions(ambiguous, source).transitions.length, 0);
});

test("a held response remains distinct through both graph paths, SQLite and review reconstruction", async () => {
  const review = validateAITransitions(etlFixture("「取込みエラーがあれば」「担当が原因を直した後」"), stopSource + repairSource);
  const graph: LensGraph = { workflows: [], nodes: [], edges: [], dataFlows: [] };
  const workflow = { id: "etl", name: "夜間更新" };
  const preview = previewReviewGraph(graph, workflow, review);
  const resolved = resolveWorkflowReviewLocally({ review, workflow, graph });
  assert.equal(resolved.patch.edges.find(e => e.relation === "next")!.holdEffect, "response");
  assert.equal(preview.edges.find(e => e.relation === "next")!.holdEffect, "response");
  const repository = new SqliteBusinessFlowRepository(join(mkdtempSync(join(tmpdir(), "held-response-")), "test.sqlite"));
  await repository.saveProject({ projectId: "test", projectName: "Test", graph: replaceWorkflowGraph(graph, workflow, resolved.patch),
    transcripts: { etl: stopSource + repairSource }, updatedAt: new Date().toISOString() });
  const loaded = (await repository.loadProject("test"))!;
  const restored = buildWorkflowReviewFromGraph(loaded.graph, "etl");
  assert.equal(restored.transitions[0].holdEffect, "response");
  assert.equal(restored.transitions[0].certainty, "inferred");
  assert.equal(restored.steps[0].meaning!.halt, true);
  assert.equal(loaded.transcripts.etl, stopSource + repairSource);
});

test("explicit cause investigation and repair remain reachable while the result is held", () => {
  for (const action of ["原因を調べる", "原因を調査する", "原因を直す", "原因を修正する", "障害を切り分ける"]) {
    const source = `失敗した場合は更新を止め、監視担当が${action}。`;
    const result = validateAITransitions(fixture(action, source), source);
    assert.equal(result.transitions.length, 1, action);
    assert.equal(result.steps[0].meaning?.halt, true);
  }
});

test("repair wording cannot authorize unknown, negative or normal completion paths", () => {
  for (const [action, evidence, source] of [
    ["原因を直して更新を再実行する", "失敗した場合は更新を止め、原因を直す。", "失敗した場合は更新を止め、原因を直す。"],
    ["原因を直して出荷を確定する", "原因を直す。", "原因を直す。"],
    ["原因を直す", "原因を直すかは未確認です。", "原因を直すかは未確認です。"],
    ["原因を調べる", "原因は調べません。", "原因は調べません。"],
    ["課長へ知らせる", "課長へ知らせない。", "課長へ知らせない。"],
    ["原因を直す", "担当が原因を直す。", "誰がどう直すか分かりません。"],
  ]) {
    assert.equal(validateAITransitions(fixture(action, evidence), source).transitions.length, 0, action + evidence);
  }
});

const contractHold = "そろわない条項がある場合は承認を保留します。";
const contractResponse = "営業担当と法務担当がTeamsで条項を調整します。";
const contractQuestion = "承認を保留した後、誰がどのように条項を再調整し、承認確認を再開しますか？";
const contractAnswer: FollowUpAnswer = { question: contractQuestion,
  answer: contractResponse + "合意したコメントを法務担当がSharePointに記録したら、営業部長の確認から再開します。" };
function contractFixture() {
  const review = fixture("営業担当と法務担当がTeamsで条項を調整する", "承認を保留した後、" + contractResponse);
  review.steps[0] = { ...review.steps[0], name: "承認を保留する", action: "承認を保留する", evidence: contractHold,
    meaning: { ...review.steps[0].meaning!, result: "承認を保留する", condition: "そろわない条項がある場合", evidence: contractHold } };
  review.steps[1].evidence = contractResponse;
  review.transitions[0].certainty = "confirmed";
  return review;
}

test("a direct answer to the sole grounded approval hold keeps adjustment reachable as an inferred response, not a release", () => {
  const source = contractHold + "\n" + contractAnswer.answer;
  const result = validateAITransitions(contractFixture(), source, [contractAnswer]);
  assert.equal(result.transitions.length, 1);
  assert.equal(result.transitions[0].holdEffect, "response");
  assert.equal(result.transitions[0].certainty, "inferred");
  assert.equal(result.transitions[0].evidence, `「${contractHold}」「${contractResponse}」`);
  assert.equal(result.steps[0].meaning!.halt, true);
  assert.equal(result.steps[1].meaning?.halt, false);
  assert.equal(validateAITransitions(contractFixture(), source).transitions.length, 0);
});

test("a literal restart after recording the agreed comment is labeled separately from the held adjustment", () => {
  const review = contractFixture();
  const restart = contractAnswer.answer.split("。")[1] + "。";
  const check = "営業部長が法務コメントを確認します。";
  review.steps.push({ ...review.steps[1], stepKey: "record", action: "合意したコメントを記録する", evidence: restart },
    { ...review.steps[1], stepKey: "check", action: "法務コメントを確認する", evidence: check });
  review.transitions.push({ fromStepKey: "s1", toStepKey: "record", condition: null, evidence: contractResponse },
    { fromStepKey: "record", toStepKey: "check", condition: "合意したコメントを記録したら", evidence: restart, certainty: "confirmed" });
  const result = validateAITransitions(review, check + contractHold + "\n" + contractAnswer.answer, [contractAnswer]);
  assert.equal(result.transitions[0].holdEffect, "response");
  assert.equal(result.transitions[1].holdEffect, undefined);
  assert.equal(result.transitions[2].holdEffect, "resume");
  const unknown = validateAITransitions({ ...review, transitions: review.transitions.map(t => t.fromStepKey === "record"
    ? { ...t, evidence: "記録した後に再開するかは未確認です。" } : t) },
    check + contractHold + contractResponse + "記録した後に再開するかは未確認です。", [contractAnswer]);
  assert.notEqual(unknown.transitions.find(t => t.fromStepKey === "record")?.holdEffect, "resume");
});

test("answer scope cannot choose another hold, use another story, invent a quote, or turn a completion into held work", () => {
  const source = contractHold + "\n" + contractAnswer.answer;
  for (const answer of [
    { ...contractAnswer, question: "出荷を保留した後、誰が対応しますか？" },
    { ...contractAnswer, question: "誰が対応しますか？" },
    { ...contractAnswer, reference: { workflowId: "another", workflowName: "別の契約", usedAt: "2026-10-04" } },
    { ...contractAnswer, answer: "別の契約では、" + contractAnswer.answer },
    { ...contractAnswer, answer: "担当者を確認します。" + contractAnswer.answer },
  ]) assert.equal(validateAITransitions(contractFixture(), contractHold + "\n" + answer.answer, [answer]).transitions.length, 0);
  const ambiguous = contractFixture();
  ambiguous.steps.push({ ...ambiguous.steps[0], stepKey: "another-hold", name: "出荷を保留する" });
  assert.equal(validateAITransitions(ambiguous, source, [contractAnswer]).transitions.length, 0);
  assert.equal(validateAITransitions(contractFixture(), contractAnswer.answer, [contractAnswer]).transitions.length, 0);
  const invented = contractFixture();
  invented.steps[1].evidence = "法務課長がTeamsで条項を調整します。";
  assert.equal(validateAITransitions(invented, source, [contractAnswer]).transitions.length, 0);
  const completed = contractFixture();
  completed.steps[1].action = "条項を調整して契約を承認する";
  assert.equal(validateAITransitions(completed, source, [contractAnswer]).transitions.length, 0);
});

test("an unknown or denied adjustment, including a newer answer, does not revive an old response", () => {
  for (const answer of ["営業担当と法務担当が条項を調整しません。", "営業担当と法務担当が条項を調整するかは未確認です。"]) {
    const review = contractFixture();
    review.steps[1].evidence = answer;
    const followUp = { ...contractAnswer, answer };
    assert.equal(validateAITransitions(review, contractHold + "\n" + answer, [followUp]).transitions.length, 0);
    assert.equal(validateAITransitions(contractFixture(), contractHold + "\n" + contractAnswer.answer + "\n" + answer,
      [contractAnswer, followUp]).transitions.length, 0);
  }
});
