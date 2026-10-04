import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ExtractionReview, ExtractionReviewStep } from "../lib/graph";
import { inputCanvasEdge, inputCanvasLabel, inputCanvasLayout, inputStepName } from "../lib/input-canvas";
import { InputFlowCanvas } from "../components/InputFlowCanvas";
import { InputRelations } from "../components/InputRelations";
import { InputReviewFlow } from "../components/InputReviewFlow";

const step = (key: string, order: number, name = key): ExtractionReviewStep => ({
  stepKey: key, order, name, action: name, actor: "経理課長", department: null,
  responsiblePerson: null, executionMode: "manual", executingSystem: null,
  certainty: "explicit", evidence: name, systems: [], data: [],
});

test("a linear wrap takes one row and an overview uses only a grounded result, with the original task kept accessible", () => {
  const review: ExtractionReview = { ...empty, steps: Array.from({ length: 5 }, (_, i) => step(`s${i}`, i + 1)), transitions: Array.from({ length: 3 }, (_, i) => ({ fromStepKey: `s${i}`, toStepKey: `s${i+1}`, condition: null, evidence: "", certainty: "confirmed" })) };
  const layout = inputCanvasLayout(review);
  assert.equal(layout.nodes[3].lane, layout.nodes[2].lane + 1, "wrapping must not add a blank row twice");
  const wrap = inputCanvasEdge(layout.nodes[2], layout.nodes[3], layout.nodes, 2);
  assert.ok((wrap.labelY ?? wrap.y - 15) - 10 > layout.nodes[2].y + 130, "condition text clears the card and its selection outline");
  assert.ok(layout.height < 400);
  assert.equal(layout.nodes[4].isolated, true);
  const base = { ...step("prepare", 1, "経理課長が帳票の数字を確認する"), meaning: { purpose: "", basis: "", result: "価格案が用意できる", next: "", condition: "", halt: false, certainty: "confirmed" as const, evidence: "価格案を作る" } };
  assert.equal(inputCanvasLabel(base), "価格案が用意できる");
  assert.equal(inputCanvasLabel({ ...base, meaning: { ...base.meaning, certainty: "inferred", result: "価格を確定する" } }), "帳票の数字を確認する");
  const corrected = { ...base, actor: "経理係長", humanEdits: [{ field: "actor", before: "経理課長", after: "経理係長", evidence: "人が担当を訂正" }] };
  assert.equal(inputStepName(corrected), "帳票の数字を確認する", "a title must not contradict the corrected actor shown separately");
  assert.equal(corrected.name, "経理課長が帳票の数字を確認する", "the recorded name and source are retained");
  const detail = renderToStaticMarkup(createElement(InputReviewFlow, { review: { ...empty, steps: [corrected] }, selected: corrected,
    graph: { workflows: [], nodes: [], edges: [], dataFlows: [] }, busy: false, choose: () => {}, onEdit: () => {}, onExclude: () => {}, onWorkflow: () => {} }));
  assert.equal(detail.match(/<h3[^>]*>(.*?)<\/h3>/)?.[1], "帳票の数字を確認する");
  assert.match(detail, /経理係長/);
  const html = renderToStaticMarkup(createElement(InputFlowCanvas, { review: { ...empty, steps: [base] }, selected: base, page: 0, onPage: () => {}, choose: () => {} }));
  assert.match(html, /title="経理課長が帳票の数字を確認する"/);
  assert.match(html, /価格案が用意できる/);
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
  assert.ok(layout.height <= 600, "two branches and the separate unknown task stay bounded");
  assert.equal(layout.nodes.find(n => n.step.stepKey === "approve")?.y, layout.nodes.find(n => n.step.stepKey === "hold")?.y);
  const html = renderToStaticMarkup(createElement(InputFlowCanvas, { review, selected: review.steps[0], page: 0, onPage: () => {}, choose: () => {} }));
  assert.match(html, /data-from="check" data-to="approve" data-certainty="inferred"/);
  assert.match(html, /data-from="check" data-to="hold" data-certainty="confirmed" data-halt="true"/);
  assert.doesNotMatch(html, /data-from="approve" data-to="hold"/);
  assert.match(html, /推定・要確認/);
  assert.equal(JSON.stringify(review), before);
});

test("after a three-step stem, normal work reads left to right beside the separate exception branch and each arrow offers insertion", () => {
  const review: ExtractionReview = { ...empty, steps: Array.from({ length: 6 }, (_, i) => step(`s${i}`, i + 1)), transitions: [[0,1],[1,2],[2,3],[3,4],[2,5]].map(([a,b]) => ({ fromStepKey: `s${a}`, toStepKey: `s${b}`, condition: b === 5 ? "空きがない" : null, evidence: "", certainty: "confirmed" })) };
  const layout = inputCanvasLayout(review);
  assert.ok(layout.nodes[3].x < layout.nodes[4].x);
  assert.ok(layout.nodes[4].x < layout.nodes[5].x);
  assert.equal(layout.nodes[3].y, layout.nodes[5].y);
  assert.ok(layout.height < 400);
  const geometry = inputCanvasEdge(layout.nodes[2], layout.nodes[5], layout.nodes, 4);
  assert.ok(geometry.y > layout.nodes[2].y + 128 && geometry.y < layout.nodes[5].y);
  const html = renderToStaticMarkup(createElement(InputFlowCanvas, { review, selected: review.steps[2], page: 0, onPage: () => {}, choose: () => {}, onInsert: () => {} }));
  assert.equal((html.match(/class="input-canvas-insert"/g) ?? []).length, 5);
  assert.match(html, /の間に作業を追加（空きがない）/);
  assert.doesNotMatch(html, /data-from="s4" data-to="s5"/);
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

test("a hold on the next page keeps the original common check, normal alternative and condition visible without changing step IDs", () => {
  const steps = Array.from({ length: 7 }, (_, i) => step(`s${i}`, i + 1));
  steps[6].meaning = { purpose: "", basis: "", result: "使用を保留する", next: "", condition: "前の製品が不明", halt: true, certainty: "confirmed", evidence: "不明なら保留" };
  const review = { ...empty, steps, transitions: [[0,1],[1,2],[2,3],[3,4],[4,5],[2,6]].map(([from,to]) => ({ fromStepKey: `s${from}`, toStepKey: `s${to}`, condition: to === 6 ? "前の製品が不明" : null, evidence: "原文", certainty: "confirmed" as const })) };
  const before = JSON.stringify(review), last = inputCanvasLayout(review, 1);
  assert.equal(last.coreCount, 1); assert.ok(last.nodes.length <= 6);
  assert.deepEqual(last.nodes.filter(n => !n.context).map(n => n.step.stepKey), ["s6"]);
  assert.deepEqual(last.nodes.filter(n => n.context).map(n => n.step.stepKey), ["s2", "s3"]);
  assert.ok(last.edges.some(e => e.fromStepKey === "s2" && e.toStepKey === "s6" && e.condition === "前の製品が不明"));
  assert.ok(last.edges.some(e => e.fromStepKey === "s2" && e.toStepKey === "s3"));
  assert.ok(!last.edges.some(e => e.fromStepKey === "s3" && e.toStepKey === "s6"));
  const html = renderToStaticMarkup(createElement(InputFlowCanvas, { review, selected: steps[6], page: 1, onPage: () => {}, choose: () => {}, onInsert: () => {} }));
  assert.match(html, /別のページの手順/); assert.match(html, /手順3「s2」のページへ/);
  assert.match(html, /data-from="s2" data-to="s6" data-certainty="confirmed" data-halt="true"/);
  assert.match(html, /の間に作業を追加（前の製品が不明）/);
  const first = renderToStaticMarkup(createElement(InputFlowCanvas, { review, selected: steps[2], page: 0, onPage: () => {}, choose: () => {} }));
  assert.match(first, /手順7「s6」のページへ/);
  assert.doesNotMatch(first, /手順3「s2」のページへ/);
  assert.equal(JSON.stringify(review), before);
});

test("a full page shows its boundary before the diagram, caps dense boundary links at six, and never interprets an off-page edge as unknown work", () => {
  const review = { ...empty, steps: Array.from({ length: 300 }, (_, i) => step(`s${i}`, i + 1)),
    transitions: Array.from({ length: 294 }, (_, i) => ({ fromStepKey: "s2", toStepKey: `s${i + 6}`, condition: `条件${i}`, evidence: "原文", certainty: "inferred" as const })) };
  const layout = inputCanvasLayout(review, 0);
  assert.equal(layout.nodes.length, 6); assert.equal(layout.outside.length, 294); assert.equal(layout.nodes[2].isolated, false);
  const html = renderToStaticMarkup(createElement(InputFlowCanvas, { review, selected: review.steps[2], page: 0, onPage: () => {}, choose: () => {} }));
  assert.equal((html.match(/<article>/g) ?? []).length, 6); assert.match(html, /1–6 \/ 294接続/);
  assert.ok(html.indexOf('aria-label="ページをまたぐつながり"') < html.indexOf('aria-label="入力が作った手順"'));
  assert.doesNotMatch(html, /矢印がない手順は、前後がまだ分かっていません/);
  assert.match(html, /点線は、推定または未確認です/);
  for (let p = 0; p < 50; p++) assert.ok(inputCanvasLayout(review, p).nodes.length <= 6);
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
