import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { extractGroundedLocal } from "../lib/local-review";
import { validateAITransitions } from "../lib/review-connections";
import { previewReviewGraph } from "../lib/review-workbench";
import { stepContext } from "../lib/flow-context";
import { WorkflowReading } from "../components/WorkflowReading";
import type { ExtractionReviewStep } from "../lib/graph";

const stopQuote = "評価条件が足りなければ回答を保留して";
const inquiryQuote = "顧客へ確認します。";
const source = stopQuote + inquiryQuote;
function inquiryDraft(action = "顧客へ確認する", quote = inquiryQuote, edgeQuote = source) {
  const r = extractGroundedLocal("回答を保留する。顧客へ確認する。");
  r.steps = r.steps.slice(0, 2).map((s, i) => ({ ...s, stepKey: `s${i}`, order: i + 1,
    actor: null, department: null, executionMode: "unknown", executingSystem: null, systems: [], data: [] }));
  r.steps[0] = { ...r.steps[0], name: "回答を保留する", action: "回答を保留する", evidence: stopQuote,
    meaning: { purpose: "", basis: "", result: "回答を保留する", next: "", condition: "評価条件が足りない場合", halt: true, certainty: "confirmed", evidence: stopQuote } };
  r.steps[1] = { ...r.steps[1], name: action, action, evidence: quote };
  r.transitions = [{ fromStepKey: "s0", toStepKey: "s1", condition: "評価条件が足りない場合", evidence: edgeQuote, certainty: "confirmed" }];
  return r;
}

test("a stopped clause connects its literal inquiry without supplying an unstated person, channel or release", () => {
  const r = inquiryDraft(), before = JSON.stringify(r), checked = validateAITransitions(r, source);
  assert.equal(checked.transitions[0]?.holdEffect, "response");
  assert.deepEqual(checked.steps, r.steps);
  assert.equal(JSON.stringify(r), before);
  assert.equal(checked.steps[1].actor, null);
  assert.equal(checked.steps[1].executionMode, "unknown");
  assert.deepEqual(checked.steps[1].systems, []);
  assert.equal(validateAITransitions({ ...r, transitions: [] }, source).transitions.length, 0);
  const workflow = { id: "evaluation", name: "顧客への回答" };
  const graph = previewReviewGraph({ workflows: [], nodes: [], edges: [], dataFlows: [] }, workflow, checked);
  const held = graph.nodes.find(n => n.kind === "process" && n.stepOrder === 1)!;
  const contact = graph.nodes.find(n => n.kind === "process" && n.stepOrder === 2)!;
  assert.equal(stepContext(graph, workflow.id, held.id).next?.id, contact.id);
  const html = renderToStaticMarkup(createElement(WorkflowReading, { graph, workflowId: workflow.id, initialStepId: contact.id, onDetail: () => {} }));
  assert.match(html, /停止・保留を続けています/);
  assert.doesNotMatch(html, /Teams|メール|再開 ·/);
});

test("an unknown channel cannot hide a different recipient, negation, system lookup, ordinary completion or another episode", () => {
  for (const [action, quote, text] of [
    ["研究へ確認する", inquiryQuote, source],
    ["顧客へ確認する", "顧客へ確認しません。", stopQuote + "顧客へ確認しません。"],
    ["顧客へ確認する", "顧客へ確認するかは未確認です。", stopQuote + "顧客へ確認するかは未確認です。"],
    ["顧客へ確認して回答を確定する", inquiryQuote, source],
    ["顧客へ確認してSAPへ登録する", inquiryQuote, source],
    ["SAPで数量を確認する", "SAPで数量を確認します。", stopQuote + "SAPで数量を確認します。"],
    ["顧客へ確認する", inquiryQuote, stopQuote + "います。別の仕事で" + inquiryQuote],
  ]) assert.equal(validateAITransitions(inquiryDraft(action, quote, text), text).transitions.length, 0, action + quote);
  const system = inquiryDraft("SAPへ数量を確認する", "SAPへ数量を確認します。", stopQuote + "SAPへ数量を確認します。");
  system.steps[1].systems = [{ name: "SAP", interaction: "view", evidence: system.steps[1].evidence }];
  assert.equal(validateAITransitions(system, stopQuote + "SAPへ数量を確認します。").transitions.length, 0);
});

const approvalQuote = "営業部長が対象と説明内容を承認したら";
const denialQuote = "資料の内容が未承認の製品は紹介を保留します。";
function approvalDraft(quote = denialQuote) {
  const r = extractGroundedLocal("対象と説明内容を承認する。資料を保存する。紹介を保留する。");
  r.steps = r.steps.slice(0, 3).map((s, i) => ({ ...s, stepKey: `a${i}`, order: i + 1, systems: [], data: [] }));
  r.steps[0] = { ...r.steps[0], name: "対象と説明内容を承認する", action: "対象と説明内容を承認する", evidence: approvalQuote };
  r.steps[1] = { ...r.steps[1], name: "資料を保存する", action: "資料を保存する", evidence: "資料をSharePointへ保存します。" };
  r.steps[2] = { ...r.steps[2], name: "未承認なら紹介を保留する", action: "未承認なら紹介を保留する", evidence: quote,
    meaning: { purpose: "", basis: "", result: "紹介を保留する", next: "", condition: "資料の内容が未承認の場合", halt: true, certainty: "confirmed", evidence: quote } };
  r.transitions = [{ fromStepKey: "a0", toStepKey: "a1", condition: "承認した場合", evidence: approvalQuote, certainty: "confirmed" },
    { fromStepKey: "a0", toStepKey: "a2", condition: "資料の内容が未承認の場合", evidence: quote, certainty: "inferred" }];
  return r;
}

test("a pure completed approval does not lead to a not-approved hold; both stated actions remain without an invented common check", () => {
  const r = approvalDraft(), text = approvalQuote + r.steps[1].evidence + denialQuote;
  const before = JSON.stringify(r), result = validateAITransitions(r, text);
  assert.deepEqual(result.transitions.map(t => t.toStepKey), ["a1"]);
  assert.deepEqual(result.steps, r.steps);
  assert.equal(JSON.stringify(r), before);
  assert.ok(result.warnings.some(w => w.includes("承認完了から未承認時")));
  assert.ok(result.questions.some(q => q.question.includes("どの確認・判断から")));
  const check = { ...r, steps: r.steps.map((s, i): ExtractionReviewStep => i === 0
    ? { ...s, action: "対象と説明内容を確認する", evidence: "対象と説明内容を確認します。" } : s) };
  assert.equal(validateAITransitions(check, check.steps.map(s => s.evidence).join("")).transitions.length, 2);
});

test("a stated later approval cancellation is retained, while unknown or denied post-approval wording does not establish it", () => {
  for (const quote of ["承認後に資料の内容が未承認へ変わった製品は紹介を保留します。",
    "承認を取り消して未承認になった製品は紹介を保留します。"])
    assert.equal(validateAITransitions(approvalDraft(quote), approvalQuote + quote).transitions.length, 2, quote);
  for (const quote of ["承認後に未承認の製品を保留するかは未確認です。", "承認後ではなく、未承認の製品は紹介を保留します。"])
    assert.equal(validateAITransitions(approvalDraft(quote), approvalQuote + quote).transitions.length, 1, quote);
  const ordinaryFailure = "承認後に資料の登録が失敗したら紹介を保留します。";
  assert.equal(validateAITransitions(approvalDraft(ordinaryFailure), approvalQuote + ordinaryFailure).transitions.length, 2);
});

test("an approval-pending clause does not follow a completed approval even when its condition contains the pending explanation", () => {
  for (const quote of ["予算超過は承認を保留して依頼した部署へTeamsで確認します。", "予算超過の場合、承認は保留します。", "予算超過の承認保留を依頼部署へ知らせます。"]) {
    const r = approvalDraft(quote);
    r.steps[0].meaning = { purpose: "", basis: "予算と数量", result: "承認する", next: "資料を保存する",
      condition: "予算超過時は承認を保留する", halt: false, certainty: "confirmed", evidence: approvalQuote };
    const before = JSON.stringify(r), checked = validateAITransitions(r, approvalQuote + r.steps[1].evidence + quote);
    assert.deepEqual(checked.transitions.map(t => t.toStepKey), ["a1"], quote);
    assert.deepEqual(checked.steps, r.steps);
    assert.ok(checked.questions.some(q => q.question.includes("どの確認・判断から")));
    assert.equal(JSON.stringify(r), before);
  }
});

test("a pending approval after stated cancellation and negated pending wording are not mistaken for this pre-approval hold", () => {
  for (const quote of ["承認後に条件変更で承認を取り消し、次の承認を保留して依頼部署へ確認します。",
    "承認を保留しないが、登録に失敗したら作業を保留します。", "承認は保留しません。登録に失敗したら作業を保留します。"]) {
    const checked = validateAITransitions(approvalDraft(quote), approvalQuote + quote);
    assert.equal(checked.transitions.length, 2, quote);
    assert.ok(!checked.warnings.some(w => w.includes("承認完了から未承認時")), quote);
  }
});

test("a literal result handoff in dictionary or polite form continues the hold without inventing a release or person", () => {
  for (const verb of ["渡す", "渡します"]) {
    const held = "条件を超えた原料は隔離を維持して", transfer = `購買へTeamsで検査結果を${verb}。`, text = held + transfer;
    const r = inquiryDraft("購買へTeamsで検査結果を渡す", transfer, text);
    r.steps[0] = { ...r.steps[0], name: "原料の隔離を維持する", action: "原料の隔離を維持する", evidence: held,
      meaning: { purpose: "", basis: "", result: "原料の隔離を維持する", next: "", condition: "条件を超えた原料", halt: true, certainty: "confirmed", evidence: held } };
    const before = JSON.stringify(r), checked = validateAITransitions(r, text);
    assert.equal(checked.transitions[0]?.holdEffect, "response", verb);
    assert.deepEqual(checked.steps, r.steps);
    assert.equal(JSON.stringify(r), before);
    assert.equal(checked.steps[1].actor, null);
    assert.equal(checked.steps[1].executionMode, "unknown");
    assert.equal(validateAITransitions({ ...r, transitions: [] }, text).transitions.length, 0);
    const workflow = { id: "temperature", name: "輸入原料の温度確認" };
    const graph = previewReviewGraph({ workflows: [], nodes: [], edges: [], dataFlows: [] }, workflow, checked);
    const target = graph.nodes.find(n => n.kind === "process" && n.stepOrder === 2)!;
    const html = renderToStaticMarkup(createElement(WorkflowReading, { graph, workflowId: workflow.id, initialStepId: target.id, onDetail: () => {} }));
    assert.match(html, /停止・保留を続けています/);
    assert.doesNotMatch(html, /再開 ·/);
  }
});

test("a negated result handoff cannot make a held step proceed", () => {
  for (const verb of ["渡さない", "渡しません", "渡していません"]) {
    const quote = `購買へTeamsで検査結果を${verb}。`;
    const checked = validateAITransitions(inquiryDraft("購買へTeamsで検査結果を渡す", quote, stopQuote + quote), stopQuote + quote);
    assert.equal(checked.transitions.length, 0, verb);
  }
});

function incidentDraft(quote = "EAMへ異常を記録します。", action = "EAMへ配管異常を記録する", text = "配管が違う場合は投入せず" + quote) {
  const r = inquiryDraft(action, quote, text);
  r.steps[0] = { ...r.steps[0], name: "配管が違う場合は投入しない", action: "配管が違う場合は投入しない",
    evidence: "配管が違う場合は投入せず",
    meaning: { purpose: "", basis: "", result: "投入しない", next: "", condition: "配管が違う場合", halt: true, certainty: "confirmed", evidence: "配管が違う場合は投入せず" } };
  return r;
}

test("recording a literal incident in the same stopped clause preserves the hold, endpoints and unknown actor", () => {
  const source = "配管が違う場合は投入せずEAMへ異常を記録します。";
  for (const evidence of [source, "投入せずEAMへ異常を記録します。"]) {
    const r = incidentDraft();
    r.transitions[0].evidence = evidence;
    const offered = JSON.stringify(r), checked = validateAITransitions(r, source);
    assert.equal(checked.transitions[0]?.holdEffect, "response");
    assert.deepEqual(checked.steps, r.steps);
    assert.equal(JSON.stringify(r), offered);
    assert.equal(checked.steps[1].actor, null);
    assert.equal(checked.steps[1].executionMode, "unknown");
    assert.equal(validateAITransitions({ ...r, transitions: [] }, source).transitions.length, 0);
    const workflow = { id: "charge", name: "原料投入" };
    const graph = previewReviewGraph({ workflows: [], nodes: [], edges: [], dataFlows: [] }, workflow, checked);
    const target = graph.nodes.find(n => n.kind === "process" && n.stepOrder === 2)!;
    const html = renderToStaticMarkup(createElement(WorkflowReading, { graph, workflowId: workflow.id, initialStepId: target.id, onDetail: () => {} }));
    assert.match(html, /停止・保留を続けています/);
    assert.doesNotMatch(html, /再開 ·/);
  }
});

test("an incident record cannot continue a hold using negated, unknown, unrelated or release work", () => {
  for (const [quote, action, text] of [
    ["EAMへ異常を記録しません。", "EAMへ異常を記録する", "配管が違う場合は投入せずEAMへ異常を記録しません。"],
    ["EAMへ異常を記録するかは未確認です。", "EAMへ異常を記録する", "配管が違う場合は投入せずEAMへ異常を記録するかは未確認です。"],
    ["EAMへ異常を記録します。", "EAMへ障害を記録する", "配管が違う場合は投入せずEAMへ異常を記録します。"],
    ["EAMへ異常を記録します。", "EAMへ異常を記録して投入を再開する", "配管が違う場合は投入せずEAMへ異常を記録します。"],
    ["EAMへ異常を記録します。", "EAMへ異常を記録して投入を開始する", "配管が違う場合は投入せずEAMへ異常を記録します。"],
    ["EAMへ異常を記録します。", "EAMへ異常を記録する", "配管が違う場合は投入せず待機します。別の設備でEAMへ異常を記録します。"],
    ["SAPへ数量を記録します。", "SAPへ数量を記録する", "配管が違う場合は投入せずSAPへ数量を記録します。"],
  ]) {
    const checked = validateAITransitions(incidentDraft(quote, action, text), text);
    assert.equal(checked.transitions.length, 0, quote + action);
  }
  const r = incidentDraft();
  r.transitions[0].evidence = "EAMへ異常を記録します。";
  assert.equal(validateAITransitions(r, "配管が違う場合は投入せずEAMへ異常を記録します。").transitions.length, 0);
});
