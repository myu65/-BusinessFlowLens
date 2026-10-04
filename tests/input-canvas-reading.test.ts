import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ExtractionReview, ExtractionReviewStep } from "../lib/graph";
import { inputCanvasLayout } from "../lib/input-canvas";
import { InputFlowCanvas } from "../components/InputFlowCanvas";
import { InputRelations } from "../components/InputRelations";

const step = (key: string, order: number, name = key): ExtractionReviewStep => ({
  stepKey: key, order, name, action: name, actor: "経理課長", department: null,
  responsiblePerson: null, executionMode: "manual", executingSystem: null,
  certainty: "explicit", evidence: name, systems: [], data: [],
});
const empty: ExtractionReview = { summary: "", trigger: null, outcome: null, steps: [], transitions: [], dataFlows: [], questions: [], warnings: [] };

test("a shared check displays approval and hold as independent branches, with unknown work left disconnected", () => {
  const review: ExtractionReview = { ...empty, steps: [step("check", 1, "レートの日付を確認する"), step("approve", 2, "評価仕訳を承認する"), {
    ...step("hold", 3, "承認を保留する"), meaning: { purpose: "", basis: "", result: "保留", next: "", condition: "日付が違う", halt: true, certainty: "confirmed", evidence: "日付が違う場合は承認を保留する" },
  }, { ...step("unknown", 4), certainty: "inferred" }], transitions: [
    { fromStepKey: "check", toStepKey: "approve", condition: "日付が一致", evidence: "", certainty: "inferred" },
    { fromStepKey: "check", toStepKey: "hold", condition: "日付が違う", evidence: "", certainty: "confirmed" },
  ] };
  const before = JSON.stringify(review);
  const layout = inputCanvasLayout(review);
  assert.equal(layout.edges.length, 2);
  assert.equal(layout.nodes.find(n => n.step.stepKey === "unknown")?.isolated, true);
  assert.equal(new Set(layout.nodes.map(n => `${n.x}:${n.y}`)).size, 4);
  assert.ok(layout.height <= 400, "both branches fit the same compact map");
  const html = renderToStaticMarkup(createElement(InputFlowCanvas, { review, selected: review.steps[0], page: 0, onPage: () => {}, choose: () => {} }));
  assert.match(html, /data-from="check" data-to="approve" data-certainty="inferred"/);
  assert.match(html, /data-from="check" data-to="hold" data-certainty="confirmed" data-halt="true"/);
  assert.doesNotMatch(html, /data-from="approve" data-to="hold"/);
  assert.match(html, /推定・要確認/);
  assert.equal(JSON.stringify(review), before);
});

test("a long or cyclic review stays bounded and every step and out-of-page edge remains reachable", () => {
  const review: ExtractionReview = { ...empty, steps: Array.from({ length: 30 }, (_, i) => step(`s${i}`, i + 1)), transitions: Array.from({ length: 29 }, (_, i) => ({ fromStepKey: `s${i}`, toStepKey: `s${i + 1}`, condition: null, evidence: "", certainty: "confirmed" })) };
  review.transitions.push({ fromStepKey: "s5", toStepKey: "s3", condition: "差戻し", evidence: "", certainty: "confirmed" });
  const visited: string[] = [];
  for (let page = 0; page < 5; page++) {
    const layout = inputCanvasLayout(review, page);
    assert.equal(layout.nodes.length, 6);
    assert.equal(new Set(layout.nodes.map(n => `${n.x}:${n.y}`)).size, 6);
    visited.push(...layout.nodes.map(n => n.step.stepKey));
  }
  assert.equal(new Set(visited).size, 30);
  assert.ok(inputCanvasLayout(review).outside.some(e => e.toStepKey === "s6"));
  assert.equal(inputCanvasLayout(review, 99).page, 4);
});

test("the information perspective explains manual tool transfer and the changed result without registering a new draft", () => {
  const review: ExtractionReview = { ...empty, steps: [{ ...step("copy", 1, "容器数と重量を転記する"), systems: [{ name: "Excel", interaction: "input", evidence: "" }],
    data: [{ name: "重量", operation: "read", evidence: "WMSの重量" }], meaning: { purpose: "", basis: "", result: "梱包明細が用意できる", next: "", condition: "", halt: false, certainty: "confirmed", evidence: "" } }],
    dataFlows: [{ sourceSystem: "WMS", targetSystem: "Excel", data: ["重量"], automation: "manual", direction: "push", transferType: "manual", frequency: null, evidence: "WMSの重量をExcelへ転記", certainty: "explicit", relatedStepKeys: ["copy"] }] };
  const html = renderToStaticMarkup(createElement(InputRelations, { review, kind: "information", selected: review.steps[0], choose: () => {} }));
  assert.match(html, /WMS/);
  assert.match(html, /Excel/);
  assert.match(html, /人が渡す・転記する/);
  assert.match(html, /梱包明細が用意できる/);
  assert.match(html, /原文に明示/);
});
