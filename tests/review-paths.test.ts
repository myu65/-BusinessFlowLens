import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InputStripConnection } from "../components/InputStripConnection";
import { reviewStripConnection } from "../lib/review-paths";
import { extractGroundedLocal } from "../lib/local-review";
import type { ExtractionTransition } from "../lib/graph";

const edge = (from: string, to: string, condition: string | null = null): ExtractionTransition => ({
  fromStepKey: from, toStepKey: to, condition, certainty: "confirmed", evidence: "入力に書かれた接続",
});
const fixture = () => {
  const review = extractGroundedLocal("品質担当が判定する。課長が承認する。担当が通知する。担当が保留する。");
  review.steps = review.steps.slice(0, 4).map((s, i) => ({ ...s, stepKey: String(i + 1), order: i + 1 }));
  assert.equal(review.steps.length, 4);
  review.transitions = [edge("1", "2", "合格"), edge("2", "3"), edge("1", "4", "不合格")];
  return review;
};

test("success notification and failure hold are different branches, with a return to the recorded judgment", () => {
  const review = fixture();
  const connection = reviewStripConnection(review, "3", "4");
  assert.equal(connection.kind, "branches");
  if (connection.kind !== "branches") throw new Error("Missing branch");
  assert.equal(connection.fork.stepKey, "1");
  assert.equal(connection.certainty, "confirmed");
  const html = renderToStaticMarkup(React.createElement(InputStripConnection, { connection, choose: () => {} }));
  assert(html.includes("別の条件の枝"));
  assert(html.includes("分かれ道へ戻る："));
  assert(!html.includes("未確認"));
  assert(!html.includes("→"));
  assert.deepEqual(reviewStripConnection(review, "1", "2"), { kind: "next", transition: review.transitions[0] });
});

test("missing paths, sequential paths, returns and unnamed parallel work do not invent conditional branches", () => {
  const review = fixture();
  review.transitions = [edge("1", "2"), edge("1", "4")];
  assert.equal(reviewStripConnection(review, "2", "4").kind, "unknown");
  review.transitions = [edge("1", "2", "合格"), edge("2", "3"), edge("3", "4")];
  assert.equal(reviewStripConnection(review, "2", "4").kind, "unknown");
  review.transitions = [edge("1", "2", "合格"), edge("1", "4", "不合格"), edge("4", "2", "再確認"), edge("2", "4", "保留")];
  assert.equal(reviewStripConnection(review, "4", "2").kind, "next");
  review.transitions.pop();
  assert.equal(reviewStripConnection(review, "2", "4").kind, "unknown");
  review.transitions = [edge("1", "2", "合格"), edge("1", "missing", "不合格")];
  assert.equal(reviewStripConnection(review, "2", "4").kind, "unknown");
});

test("a branch preserves inferred certainty, while an unknown path still asks for the connection", () => {
  const review = fixture();
  review.transitions[1].certainty = "inferred";
  const inferred = reviewStripConnection(review, "3", "4");
  assert.equal(inferred.kind, "branches");
  if (inferred.kind === "branches") assert.equal(inferred.certainty, "inferred");
  const html = renderToStaticMarkup(React.createElement(InputStripConnection, { connection: inferred, choose: () => {} }));
  assert(html.includes("要確認"));
  review.transitions[1].certainty = "unknown";
  assert.equal(reviewStripConnection(review, "3", "4").kind, "unknown");
});

test("return to the later recorded common judgment when extraction also includes upstream shortcuts", () => {
  const review = fixture();
  review.steps.unshift({ ...review.steps[0], stepKey: "0", order: 0, name: "前の検知" });
  review.transitions.unshift(edge("0", "1"), edge("0", "3", "合格"), edge("0", "4", "不合格"));
  review.transitions[4].certainty = "inferred";
  const connection = reviewStripConnection(review, "3", "4");
  assert.equal(connection.kind, "branches");
  if (connection.kind === "branches") {
    assert.equal(connection.fork.stepKey, "1");
    assert.equal(connection.certainty, "inferred");
  }
});
