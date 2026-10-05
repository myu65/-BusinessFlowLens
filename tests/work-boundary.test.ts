import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { extractGroundedLocal } from "../lib/local-review";
import { normalizeWorkBoundary, separateWorkParties } from "../lib/work-boundary";
import { groundStepEvidence } from "../lib/ai/source-grounding";
import { preserveRefinements } from "../lib/refinement";
import { previewReviewGraph, editReviewStep, diffReviews } from "../lib/review-workbench";
import { buildWorkflowReviewFromGraph, type WorkBoundary, type LensGraph } from "../lib/graph";
import { SqliteBusinessFlowRepository } from "../lib/storage/sqlite";
import { knowledgeReport, compareWorkflow } from "../lib/knowledge";
import { WorkBoundaryReading } from "../components/WorkBoundaryReading";

const source = "品質担当が試料と検査依頼を外部検査会社へ渡す。外部検査会社の内部の進め方は見えない。PDF成績書が戻り、品質担当がLIMSへ登録する。合否を誰が判断するかは未確認。";
const boundary: WorkBoundary = { scope: "external", party: "外部検査会社", visibility: "unavailable", incoming: ["試料", "検査依頼"], outgoing: ["PDF成績書"], unknowns: ["内部の進め方", "合否を判断する人"], certainty: "confirmed", evidence: "外部検査会社の内部の進め方は見えない" };
const empty: LensGraph = { workflows: [], nodes: [], edges: [], dataFlows: [] };
function fixture() {
  const review = extractGroundedLocal(source);
  review.steps[1] = { ...review.steps[1], actor: "外部検査会社", boundary: structuredClone(boundary),
    systems: [{ name: "外部検査会社", interaction: "other", evidence: boundary.evidence }, { name: "外部検査ポータル", interaction: "receive", evidence: "別の追記の根拠" }],
    executingSystem: "外部検査会社" };
  review.systemProfiles = [{ name: "外部検査会社", category: "製造・検査", purpose: "検査する", certainty: "inferred", evidence: boundary.evidence }];
  review.dataFlows = [{ sourceSystem: "Outlook", targetSystem: "外部検査会社", data: ["検査依頼"], transferType: "email", direction: "push", automation: "manual", frequency: null, evidence: source, certainty: "explicit", relatedStepKeys: [review.steps[1].stepKey] },
    { sourceSystem: "外部検査ポータル", targetSystem: "LIMS", data: ["PDF成績書"], transferType: "file", direction: "push", automation: "manual", frequency: null, evidence: "追記された実際のポータル連携", certainty: "explicit", relatedStepKeys: [review.steps[1].stepKey] }];
  return review;
}

test("an external party is kept as a work boundary, while exact party-as-tool errors are rejected and named portals survive", () => {
  const before = fixture(), original = structuredClone(before), result = separateWorkParties(before);
  assert.deepEqual(before, original);
  assert.deepEqual(result.steps[1].boundary, boundary);
  assert.equal(result.steps[1].actor, "外部検査会社");
  assert.equal(result.steps[1].executingSystem, null);
  assert.deepEqual(result.steps[1].systems.map(s => s.name), ["外部検査ポータル"]);
  assert.ok(result.steps[1].data.some(d => d.name === "検査依頼" && d.operation === "receive"));
  assert.ok(result.steps[1].data.some(d => d.name === "PDF成績書" && d.operation === "send"));
  assert.equal(result.systemProfiles!.length, 0);
  assert.equal(result.dataFlows.length, 1);
  assert.equal(result.dataFlows[0].sourceSystem, "外部検査ポータル");
  assert.ok(result.warnings.some(w => w.includes("社外の相手")));
  const graph = previewReviewGraph(empty, { id: "vendor", name: "委託検査" }, result);
  assert.equal(graph.nodes.some(n => n.kind === "system" && n.label === "外部検査会社"), false);
  assert.ok(graph.nodes.some(n => n.kind === "system" && n.label === "外部検査ポータル"));
  const external = graph.nodes.find(n => n.kind === "process" && n.boundary?.scope === "external")!;
  assert.ok(graph.edges.some(e => e.source === external.id && e.relation === "reads"));
  assert.ok(graph.edges.some(e => e.source === external.id && e.relation === "sends"));
  assert.deepEqual(buildWorkflowReviewFromGraph(graph, "vendor").steps[1].boundary, boundary);
  const excluded = structuredClone(before); excluded.steps[1].data = [];
  excluded.steps[1].humanEdits = [{ field: "data", before: before.steps[1].data, after: [], evidence: "人がこの工程の情報登録を除外" }];
  assert.deepEqual(separateWorkParties(excluded).steps[1].data, []);
});

test("image interpretation and unmatched boundary quotes remain proposals; no invented literal proof", () => {
  const review = fixture(); review.steps[1].systems = []; review.steps[1].executingSystem = null;
  const literal = groundStepEvidence(review, source);
  assert.equal(literal.steps[1].boundary!.certainty, "confirmed");
  const visual = groundStepEvidence(review, `[AI画像解釈 p1・推定・要確認]\n${source}\n[/AI画像解釈]`);
  assert.equal(visual.steps[1].boundary!.certainty, "inferred");
  const labeled = structuredClone(review); labeled.steps[1].boundary!.evidence = `[AI画像解釈 p1・推定・要確認] ${boundary.evidence}`;
  const wrapped = groundStepEvidence(labeled, `[AI画像解釈 p1・推定・要確認]\n${source}\n[/AI画像解釈]`);
  assert.equal(wrapped.steps[1].boundary!.evidence, boundary.evidence);
  assert.equal(wrapped.steps[1].boundary!.certainty, "inferred");
  const unmatched = groundStepEvidence(review, "試料を送ったことだけは分かる。");
  assert.equal(unmatched.steps[1].boundary!.certainty, "inferred");
  assert.equal(unmatched.steps[1].boundary!.evidence, "");
});

test("human boundary corrections survive re-reading without freezing other newly stated exchange facts", () => {
  const before = separateWorkParties(fixture()), key = before.steps[1].stepKey;
  const corrected = editReviewStep(before, key, { boundary: { ...boundary, party: "東海検査社", visibility: "partial", evidence: "利用者が訂正", certainty: "confirmed" } });
  assert.ok(corrected.steps[1].humanEdits!.some(e => e.field === "boundary.party"));
  const reread = structuredClone(before); reread.steps[1].boundary!.outgoing.push("返却試料");
  const retained = preserveRefinements(reread, corrected);
  assert.equal(retained.steps[1].boundary!.party, "東海検査社");
  assert.equal(retained.steps[1].boundary!.visibility, "partial");
  assert.deepEqual(retained.steps[1].boundary!.outgoing, ["PDF成績書", "返却試料"]);
  const delta = diffReviews(before, corrected);
  assert.ok(delta.changed[0].details.some(d => d.includes("東海検査社")));
  assert.ok(delta.changed[0].details.some(d => d.includes("分かるのは一部")));
});

test("external boundary survives SQLite reload and reports, and changes are part of Current/Future comparison", async () => {
  const review = separateWorkParties(fixture()), workflow = { id: "vendor", name: "委託検査", familyId: "vendor-family", scenario: "current" as const };
  const graph = previewReviewGraph(empty, workflow, review);
  const repo = new SqliteBusinessFlowRepository(join(mkdtempSync(join(tmpdir(), "bfl-boundary-")), "test.sqlite"));
  await repo.saveProject({ projectId: "p", projectName: "独立検証", graph, transcripts: { vendor: source }, updatedAt: new Date().toISOString() });
  const saved = (await repo.loadProject("p"))!;
  assert.deepEqual(buildWorkflowReviewFromGraph(saved.graph, "vendor").steps[1].boundary, boundary);
  assert.equal(saved.transcripts.vendor, source);
  const report = knowledgeReport(saved.graph, "current", "", "");
  assert.match(report, /工程の範囲: 社外/); assert.match(report, /内部の進め方: 見えない/); assert.match(report, /PDF成績書/); assert.match(report, /合否を判断する人/);
  const future = structuredClone(review); future.steps[1].boundary!.visibility = "partial";
  const both = previewReviewGraph(graph, { ...workflow, id: "future", scenario: "future", basedOnWorkflowId: workflow.id }, future);
  assert.ok(compareWorkflow(both, "vendor")[0].resultChanges.some(p => p.before.boundary?.visibility === "unavailable" && p.after.boundary?.visibility === "partial"));
  const html = renderToStaticMarkup(React.createElement(WorkBoundaryReading, { boundary }));
  assert.match(html, /社外の工程/); assert.match(html, /内部の進め方は見えない/); assert.match(html, /まだ見えていない点/);
});

test("malformed or absent boundary does not fabricate outsourcing, and unmentioned firms are not classified by a name heuristic", () => {
  assert.equal(normalizeWorkBoundary(null), undefined);
  assert.equal(normalizeWorkBoundary({ scope: "external", visibility: "made-up" }), undefined);
  const review = fixture(); delete review.steps[1].boundary;
  assert.deepEqual(separateWorkParties(review), review);
});
