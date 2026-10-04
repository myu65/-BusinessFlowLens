import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InputReviewFlow } from "../components/InputReviewFlow";
import { InputWorkbench } from "../components/InputWorkbench";
import type {
  ExtractionReview,
  ExtractionReviewStep,
  LensGraph,
} from "../lib/graph";
import {
  hasUnreflectedNotes,
  insertNoteAfterEvidence,
} from "../lib/review-workbench";

const step: ExtractionReviewStep = {
  stepKey: "s1",
  name: "注文を確認する",
  action: "注文を確認する",
  order: 1,
  actor: "営業担当",
  department: null,
  responsiblePerson: null,
  executionMode: "manual",
  executingSystem: null,
  certainty: "explicit",
  evidence: "営業担当がメールの注文書をExcelで確認する",
  systems: [{ name: "Excel", interaction: "view", evidence: "Excelで確認" }],
  data: [{ name: "注文書", operation: "receive", evidence: "メールの注文書" }],
};
const next: ExtractionReviewStep = {
  ...step,
  stepKey: "s2",
  name: "保留して経理に渡す",
  order: 2,
  data: [],
};
const graph: LensGraph = { workflows: [], nodes: [], edges: [], dataFlows: [] };
function render(review: ExtractionReview) {
  return renderToStaticMarkup(
    createElement(InputReviewFlow, {
      review,
      selected: review.steps[0],
      graph,
      busy: false,
      choose: () => {},
      onEdit: () => {},
      onExclude: () => {},
      onWorkflow: () => {},
    }),
  );
}
const review: ExtractionReview = {
  summary: "注文の確認",
  trigger: null,
  outcome: null,
  steps: [step, next],
  transitions: [],
  dataFlows: [],
  questions: [],
  warnings: [],
};

test("a zero-step input review offers clarification and saving without a workflow setup or fake flow", () => {
  const memo = "購買の仕事を整理したいが、作業はまだ分からない。";
  const initial: ExtractionReview = { ...review, steps: [], summary: memo,
    questions: [{ question: "どんな情報が届きますか？", reason: "具体的な作業が未確認です。", target: "scope" }] };
  const html = renderToStaticMarkup(createElement(InputWorkbench, {
    projectId: "test", graph, selectedId: "note", transcripts: { note: memo },
    drafts: { note: { workflow: { id: "note", name: "入力した話" }, review: initial,
      sourceNotes: memo, provider: "test-ai", baseline: null, answers: {}, answerHistory: [] } },
    onSelect: () => {}, onTranscripts: () => {}, onDraft: () => {}, onGraphApply: () => {},
  }));
  assert.ok(html.includes("まだ作業の流れは決めていません"));
  assert.ok(html.includes("どんな情報が届きますか？"));
  assert.ok(html.includes("回答を追加して読み直す"));
  assert.ok(html.includes("3 話と確認事項を保存"));
  assert.ok(!html.includes('aria-label="入力が作った手順"'));
  assert.ok(!html.includes("手順がありません。本文を補足して読み直してください。"));
});

test("a response while held is readable without claiming that normal work resumes", () => {
  const html = render({ ...review,
    steps: [{ ...step, meaning: { purpose: "", basis: "", result: "更新を停止する", next: "担当が原因を直す", condition: "取込エラー", halt: true, certainty: "confirmed", evidence: "更新を止める" } }, { ...next, name: "担当が原因を直す" }],
    transitions: [{ fromStepKey: "s1", toStepKey: "s2", condition: "取込エラー", evidence: "担当が原因を直す", certainty: "inferred", holdEffect: "response" }],
  });
  assert.ok(html.includes("停止・保留中に進む対応"));
  assert.ok(html.includes("停止中の対応 · "));
  assert.ok(html.includes("担当が原因を直す"));
  assert.ok(html.includes("通常の仕事を再開する条件・先は未確認です。"));
  assert.ok(!html.includes("再開 · "));
});

test("following a response still shows which preceding work was held, without marking the response itself stopped", () => {
  const draft: ExtractionReview = { ...review,
    steps: [{ ...step, name: "ETLの更新を止める", meaning: { purpose: "", basis: "", result: "更新停止", next: "通知する", condition: "取込エラー", halt: true, certainty: "confirmed", evidence: "ETLの更新を止める" } }, { ...next, name: "エラーを通知する" }],
    transitions: [{ fromStepKey: "s1", toStepKey: "s2", condition: null, evidence: "エラーを通知する", certainty: "inferred", holdEffect: "response" }],
  };
  const html = renderToStaticMarkup(createElement(InputReviewFlow, { review: draft, selected: draft.steps[1], graph,
    busy: false, choose: () => {}, onEdit: () => {}, onExclude: () => {}, onWorkflow: () => {} }));
  assert.ok(html.includes("停止・保留からの対応"));
  assert.ok(html.includes("停止した処理：ETLの更新を止める ←"));
  assert.ok(!html.includes("ここで停止・保留する"));
});

test("unsaved memo status includes clearing a saved memo, while an untouched empty entry is clean", () => {
  assert.equal(hasUnreflectedNotes({ new: "" }, {}), false);
  assert.equal(hasUnreflectedNotes({ new: "まだ担当が分からない" }, {}), true);
  assert.equal(
    hasUnreflectedNotes({ saved: "" }, { saved: "保存した原文" }),
    true,
  );
  assert.equal(
    hasUnreflectedNotes({ saved: "保存した原文" }, { saved: "保存した原文" }),
    false,
  );
});

test("continuation preserves the earlier source literally, without doubled punctuation or ambiguous placement", () => {
  const source =
    "注文がメールで届く。\r\n  担当者が確認する。\r\n次の担当へ渡す。";
  assert.equal(
    insertNoteAfterEvidence(
      source,
      "担当者が確認する",
      "営業がSharePointに保存する。",
    ),
    "注文がメールで届く。\r\n  担当者が確認する。\n営業がSharePointに保存する。\r\n次の担当へ渡す。",
  );
  assert.equal(
    insertNoteAfterEvidence("確認する。確認する。", "確認する", "相談する。"),
    null,
  );
  assert.equal(
    insertNoteAfterEvidence(source, "原文にない手順", "相談する。"),
    null,
  );
  assert.equal(
    insertNoteAfterEvidence(
      "担当者が確認する場合、承認を依頼する。",
      "担当者が確認する",
      "相談する。",
    ),
    null,
  );
  assert.equal(
    insertNoteAfterEvidence("確認する。次へ渡す。", "確認する", "相談する"),
    "確認する。\n相談する\n次へ渡す。",
  );
});

test("input review reads received data as input and leaves outcomes and unregistered connections unconfirmed", () => {
  const html = render(review);
  assert.match(html, /受け取る・判断の根拠.*注文書.*決まる・次に渡すこと/);
  assert.doesNotMatch(html, /注文書を更新・作成/);
  assert.match(html, /この作業の結果は、まだ確認できていません/);
  assert.match(html, /次の接続は未確認/);
  assert.doesNotMatch(html, /次へ.*→.*保留して経理に渡す/);
});

test("review makes registered conditions, a hold, and human changes readable with their original evidence", () => {
  const changed = {
    ...review,
    steps: [
      {
        ...step,
        meaning: {
          purpose: "回収できる範囲の確認",
          basis: "与信限度",
          result: "与信超過が分かる",
          next: "経理に解除判断を依頼",
          condition: "与信を超えた場合",
          halt: true,
          certainty: "confirmed" as const,
          evidence: "利用者の補足",
        },
        humanEdits: [
          {
            field: "actor",
            before: null,
            after: "営業担当",
            evidence: "利用者の訂正",
          },
        ],
      },
      next,
    ],
    transitions: [
      {
        fromStepKey: "s1",
        toStepKey: "s2",
        condition: "与信超過なら",
        certainty: "confirmed" as const,
        evidence: "与信超過なら保留",
      },
    ],
  };
  const html = render(changed);
  assert.match(html, /条件による停止・保留/);
  assert.match(html, /与信超過なら/);
  assert.match(html, /与信超過が分かる/);
  assert.match(html, /人の訂正あり/);
  assert.match(html, /営業担当がメールの注文書をExcelで確認する/);
  assert.match(html, /担当する人：未確認.*営業担当/);
});

test("automatic work with an unknown executor stays explicit about the gap, and certainty alone does not claim human confirmation", () => {
  const html = render({
    ...review,
    steps: [
      {
        ...step,
        actor: null,
        executionMode: "automatic",
        executingSystem: null,
        meaning: {
          purpose: "",
          basis: "",
          result: "価格が確定する",
          next: "",
          condition: "",
          halt: false,
          certainty: "confirmed",
          evidence: "価格が確定すると原文に記載",
        },
      },
    ],
  });
  assert.match(html, /担当.*まだ分かっていません/);
  assert.match(html, /結果の説明：確認済み/);
  assert.doesNotMatch(html, /人が確認/);
});
