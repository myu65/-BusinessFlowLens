import assert from "node:assert/strict";
import test from "node:test";
import type { ExtractionReview } from "../lib/graph";
import { groundStepEvidence } from "../lib/ai/source-grounding";
import { extractGroundedLocal } from "../lib/local-review";
import { preserveRefinements } from "../lib/refinement";
import { previewReviewGraph } from "../lib/review-workbench";

const source = "検査担当がLIMSに保管場所を記録します。";
function fixture(): ExtractionReview {
  const review = extractGroundedLocal(source);
  review.steps = [{ ...review.steps[0], stepKey: "record", evidence: source, certainty: "explicit",
    systems: [{ name: "LIMS", interaction: "input", evidence: "LIMSに保管場所を記録します" }],
    data: [{ name: "保管記録", operation: "create", evidence: "保管場所を記録します" }],
    meaning: { purpose: "", basis: "", result: "保管場所を記録する", next: "", condition: "", halt: false,
      evidence: "保管場所を記録します", certainty: "confirmed" },
  }];
  return review;
}

test("literal step, result, tool and information quotes keep their certainty without changing facts or identities", () => {
  const review = fixture(), before = structuredClone(review);
  const result = groundStepEvidence(review, source);
  assert.equal(result.steps[0].certainty, "explicit");
  assert.equal(result.steps[0].meaning!.certainty, "confirmed");
  assert.equal(result.steps[0].evidence, source);
  assert.deepEqual(result.steps[0].systems, review.steps[0].systems);
  assert.deepEqual(result.steps[0].data, review.steps[0].data);
  assert.deepEqual(result.warnings, review.warnings);
  assert.deepEqual(review, before);
});

test("paraphrased or forged quotes become reviewable proposals, never verbatim evidence or confirmed graph work", () => {
  const review = fixture();
  review.steps[0].evidence = "検査担当が保管場所をLIMSへ記録します。";
  review.steps[0].meaning!.evidence = "保管場所を作成して自動承認します";
  review.steps[0].systems[0].evidence = "LIMSが自動承認する";
  review.steps[0].data[0].evidence = "保管記録を作成する";
  review.steps[0].technicalDetails = [{ system: "LIMS", module: "自動承認", transaction: null,
    hanaArea: null, objects: null, evidence: "LIMSが自動承認します" }];
  review.steps[0].detailSteps = [{ id: "child", action: "承認する", condition: null, evidence: "自動承認します" }];
  const before = structuredClone(review), result = groundStepEvidence(review, source);
  const step = result.steps[0];
  assert.equal(step.certainty, "inferred");
  assert.equal(step.meaning!.certainty, "inferred");
  assert.equal(step.evidence, "");
  assert.equal(step.meaning!.evidence, "");
  assert.equal(step.systems[0].evidence, "");
  assert.equal(step.data[0].evidence, "");
  assert.equal(step.technicalDetails![0].evidence, "");
  assert.equal(step.detailSteps![0].evidence, "");
  assert.equal(step.action, before.steps[0].action);
  assert.equal(step.stepKey, "record");
  assert.equal(step.meaning!.result, before.steps[0].meaning!.result);
  assert.equal(step.data[0].operation, "create");
  assert.deepEqual(result.transitions, before.transitions);
  assert(result.warnings.some(w => w.includes(before.steps[0].evidence) && w.includes("AIの引用")));
  assert(result.warnings.some(w => w.includes(before.steps[0].meaning!.evidence!)));
  const graph = previewReviewGraph({ workflows: [], nodes: [], edges: [], dataFlows: [] }, { id: "sample", name: "保管" }, result);
  const process = graph.nodes.find(n => n.kind === "process")!;
  assert.equal(process.status, "inferred");
  assert.equal(process.evidence, "");
  assert.deepEqual(review, before);
});

test("literal abbreviations and additional evidence remain usable, but cannot erase negation or promote existing uncertainty", () => {
  const positive = "品質担当がロットを確認してQMSへ調査記録を保存します。";
  const review = fixture();
  review.steps[0].evidence = "品質担当がロットを確認…調査記録を保存します";
  const result = groundStepEvidence(review, source + "\n" + positive);
  assert.equal(result.steps[0].evidence, positive.slice(0, -1));
  assert.equal(result.steps[0].certainty, "explicit");
  const denial = "品質担当がロットを確認しても、保留中は調査記録を保存しません。";
  review.steps[0].evidence = "品質担当がロットを確認…調査記録を保存します";
  assert.equal(groundStepEvidence(review, source + "\n" + denial).steps[0].evidence, "");
  review.steps[0].certainty = "inferred";
  review.steps[0].evidence = source;
  review.steps[0].meaning!.certainty = "unknown";
  review.steps[0].meaning!.evidence = "";
  const uncertain = groundStepEvidence(review, source);
  assert.equal(uncertain.steps[0].certainty, "inferred");
  assert.equal(uncertain.steps[0].meaning!.certainty, "unknown");
});

test("source checks precede human corrections, retaining their values and their distinct evidence", () => {
  const previous = fixture();
  previous.steps[0].actor = "検査主任";
  previous.steps[0].meaning!.result = "試料の保管場所を残す";
  previous.steps[0].humanEdits = [
    { field: "actor", before: "検査担当", after: "検査主任", evidence: "検査主任が記録します" },
    { field: "meaning.result", before: "保管場所を記録する", after: "試料の保管場所を残す", evidence: "利用者が候補を訂正" },
  ];
  const raw = fixture();
  raw.steps[0].evidence = "LIMSが自動で記録する";
  raw.steps[0].meaning!.evidence = "LIMSが自動で作成する";
  const result = preserveRefinements(groundStepEvidence(raw, source), previous);
  assert.equal(result.steps[0].actor, "検査主任");
  assert.equal(result.steps[0].meaning!.result, "試料の保管場所を残す");
  assert.deepEqual(result.steps[0].humanEdits, previous.steps[0].humanEdits);
  assert.equal(result.steps[0].evidence, "");
  assert.equal(result.steps[0].stepKey, "record");
});

test("missing field quotes from a permissive provider become unverified without crashing the draft", () => {
  const review = fixture();
  review.steps[0].systems[0].evidence = undefined as unknown as string;
  review.steps[0].data[0].evidence = null as unknown as string;
  const result = groundStepEvidence(review, source);
  assert.equal(result.steps[0].systems[0].evidence, "");
  assert.equal(result.steps[0].data[0].evidence, "");
  assert.equal(result.steps[0].certainty, "inferred");
  assert.equal(result.steps[0].evidence, source);
  assert(result.warnings.some(w => w.includes("引用未登録")));
});
