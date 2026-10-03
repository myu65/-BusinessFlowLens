import test from "node:test";
import assert from "node:assert/strict";
import { extractGroundedLocal } from "../lib/local-review";
import { validateAITransitions } from "../lib/review-connections";

function fixture(action: string, evidence: string) {
  const review = extractGroundedLocal("機器の使用を停止する。担当が原因を直す。");
  review.steps = review.steps.slice(0, 2).map((s, i) => ({ ...s, stepKey: `s${i}`, order: i + 1 }));
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
  }
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
