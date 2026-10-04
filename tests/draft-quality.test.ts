import assert from "node:assert/strict";
import test from "node:test";
import { preApprovalRepair, approvalDenialRepair, retainSplitCheckKeys } from "../lib/ai/draft-quality";
import { extractGroundedLocal } from "../lib/local-review";
import { preserveRefinements } from "../lib/refinement";
import type { ExtractionReview } from "../lib/graph";

const approval = "営業部長が大型案件の確度を確認し、承認します。";
const before = "確認した後、迷った場合は承認する前に営業部長へ判断を頼みます。";
const combined = () => {
  const review = extractGroundedLocal(approval);
  review.steps = [{ ...review.steps[0], stepKey: "check", action: "大型案件の確度を確認し、承認する", evidence: approval }];
  return review;
};

test("a literal pre-approval request flags combined work without changing the draft", () => {
  const review = combined(), original = structuredClone(review);
  assert.deepEqual(preApprovalRepair(review, approval + before), {
    stepKeys: ["check"], checkAndApprovalEvidence: [approval], beforeApprovalEvidence: before.slice(0, -1),
  });
  assert.deepEqual(review, original);
  review.steps[0].action = "大型案件の確度を確認する";
  assert.equal(preApprovalRepair(review, approval + before), null);
});

test("splitting retains the uniquely grounded check identity and its position, without duplicating the old combined work", () => {
  const previous = combined();
  previous.steps[0].humanEdits = [
    { field: "actor", before: "営業部長", after: "部長代理", evidence: "部長代理が確認します" },
    { field: "placement", before: null, after: { afterStepKey: "record" }, evidence: approval },
  ];
  const candidate: ExtractionReview = { ...previous, steps: [
    { ...previous.steps[0], stepKey: "new-check", humanEdits: undefined, action: "大型案件の確度を確認する", name: "確度確認" },
    { ...previous.steps[0], stepKey: "approve", humanEdits: undefined, action: "承認する", name: "承認" },
  ], transitions: [{ fromStepKey: "new-check", toStepKey: "approve", condition: null, evidence: approval }],
    dataFlows: [{ sourceSystem: "SAP", targetSystem: "Excel", data: [], transferType: "manual" as const,
      direction: "push", automation: "manual", frequency: null, evidence: "転記する", certainty: "explicit", relatedStepKeys: ["new-check"] }] };
  const result = retainSplitCheckKeys(candidate, previous, approval + before);
  assert.equal(result.steps[0].stepKey, "check");
  assert.equal(result.transitions[0].fromStepKey, "check");
  assert.deepEqual(result.dataFlows[0].relatedStepKeys, ["check"]);
  const preserved = preserveRefinements(result, previous);
  assert.equal(preserved.steps.length, 2);
  assert.equal(preserved.steps[0].actor, "部長代理");
  assert.equal(preserved.steps[0].humanEdits?.length, 2);
  assert.equal(preserved.steps[1].actor, previous.steps[0].actor);
  assert.equal(preserved.steps[1].humanEdits, undefined);
  const priorWithUneditedCheck = { ...previous, steps: [...previous.steps, { ...candidate.steps[0], humanEdits: undefined }] };
  const reread = preserveRefinements(result, priorWithUneditedCheck);
  assert.equal(reread.steps.length, 2);
  assert.equal(reread.steps[0].actor, "部長代理");
  assert.equal(reread.steps[0].humanEdits?.length, 2);
});

test("ambiguous or differently grounded checking actions keep their new identities", () => {
  const previous = combined();
  const step = { ...previous.steps[0], stepKey: "new", action: "確度を確認する", name: "確度確認" };
  const ambiguous = { ...previous, steps: [step, { ...step, stepKey: "second" }] };
  assert.equal(retainSplitCheckKeys(ambiguous, previous, approval), ambiguous);
  const different = { ...previous, steps: [{ ...step, evidence: "検査結果を確認します。" }] };
  assert.equal(retainSplitCheckKeys(different, previous, approval + "検査結果を確認します。"), different);
  const duplicatePrior = { ...previous, steps: [...previous.steps, { ...previous.steps[0], stepKey: "other-old" }] };
  const candidate = { ...previous, steps: [step] };
  assert.equal(retainSplitCheckKeys(candidate, duplicatePrior, approval), candidate);
});

test("denied, unknown, ungrounded or absent pre-approval work does not trigger a repair", () => {
  for (const source of [approval, approval + "承認する前ではなく、承認した後に判断を頼みます。",
    approval + "承認する前に頼むかどうかは未確認です。", approval + "承認する前に確認します。",
    approval + before + "訂正します。承認する前ではなく、承認した後に頼みます。"]) {
    assert.equal(preApprovalRepair(combined(), source), null);
  }
  const review = combined();
  review.steps[0].evidence = "部長が一覧を確認して自動承認する";
  assert.equal(preApprovalRepair(review, approval + before), null);
  review.steps[0].evidence = approval;
  review.steps[0].action = "確度を確認し、承認しない";
  assert.equal(preApprovalRepair(review, approval + before), null);
  review.steps[0].action = "確度を確認し、承認する";
  review.steps[0].evidence = "確度を確認します";
  assert.equal(preApprovalRepair(review, "確度を確認します。" + before), null);
  review.steps[0].evidence = undefined as unknown as string;
  assert.equal(preApprovalRepair(review, approval + before), null);
});

const denial = "承認されなければ送付を保留して検査担当へ確認します。";
function denialBranch() {
  const review = combined();
  review.steps.push({ ...review.steps[0], stepKey: "hold", action: "不承認なら送付を保留して検査へ確認する", evidence: denial });
  review.transitions = [{ fromStepKey: "check", toStepKey: "hold", condition: "承認されない場合", evidence: denial, certainty: "confirmed" }];
  return review;
}

test("a literal denied-approval hold after combined checking flags only the grouping without changing facts or connections", () => {
  const review = denialBranch(), before = structuredClone(review);
  assert.deepEqual(approvalDenialRepair(review, approval + denial), {
    stepKeys: ["check"], checkAndApprovalEvidence: [approval], denialEvidence: [denial],
  });
  assert.deepEqual(review, before);
  review.steps[0].action = "大型案件の確度を確認する";
  assert.equal(approvalDenialRepair(review, approval + denial), null);
});

test("unknown, denied, unrelated, post-approval or ungrounded holds do not trigger the denied-approval repair", () => {
  for (const text of [approval, approval + "承認されなければ送付を保留するかは未確認です。",
    approval + "承認されなければ送付を保留しません。", approval + "承認後に反映が失敗したら送付を保留します。"]) {
    const review = denialBranch();
    review.transitions[0].evidence = text.slice(approval.length);
    review.steps[1].evidence = review.transitions[0].evidence;
    assert.equal(approvalDenialRepair(review, text), null);
  }
  const review = denialBranch();
  review.transitions[0].fromStepKey = "another-check";
  assert.equal(approvalDenialRepair(review, approval + denial), null);
  review.transitions[0].fromStepKey = "check";
  review.steps[1].evidence = "承認されなければMESを停止する";
  assert.equal(approvalDenialRepair(review, approval + denial), null);
  review.steps[1].evidence = denial;
  review.steps[0].action = "確度を確認して承認しない";
  assert.equal(approvalDenialRepair(review, approval + denial), null);
  review.steps[0].action = "確度を確認して承認する";
  review.steps[0].evidence = "承認済み案件を確認する";
  assert.equal(approvalDenialRepair(review, approval + denial), null);
});
