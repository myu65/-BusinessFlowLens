import test from "node:test";
import assert from "node:assert/strict";
import type { ExtractionReview, ExtractionReviewStep, LensGraph } from "../lib/graph";
import { buildWorkflowReviewFromGraph } from "../lib/graph";
import { addReviewNote, appendReviewSource } from "../lib/review-addition";
import { diffReviews, editReviewStep, previewReviewGraph } from "../lib/review-workbench";
import { preserveRefinements } from "../lib/refinement";
import { resolveWorkflowReviewLocally } from "../lib/ai/provider";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteBusinessFlowRepository } from "../lib/storage/sqlite";

const task = (stepKey: string, name: string, order: number): ExtractionReviewStep => ({
  stepKey, name, action: name, order, actor: "物流担当", department: null, responsiblePerson: null,
  executionMode: "manual", executingSystem: null, certainty: "explicit", evidence: name, systems: [], data: [],
});
const blank: ExtractionReview = { summary: "船積手配", trigger: null, outcome: null, steps: [], transitions: [], dataFlows: [], questions: [], warnings: [],
  extraction: { method: "ai", provider: "test", completedAt: "2026-10-04T00:00:00Z" } };
const base: ExtractionReview = { ...blank, steps: [task("check", "船便の空きを確認する", 1), task("send", "倉庫へTeamsで連絡する", 2), {
  ...task("hold", "営業へ納期の再判断を依頼する", 3), meaning: { purpose: "", basis: "", result: "船積を保留", next: "", condition: "空きがない", halt: true, certainty: "confirmed", evidence: "空きがなければ保留" },
}], transitions: [
  { fromStepKey: "check", toStepKey: "send", condition: "空きがある", evidence: "空きがあれば倉庫へ連絡", certainty: "inferred" },
  { fromStepKey: "check", toStepKey: "hold", condition: "空きがない", evidence: "空きがなければ保留", certainty: "confirmed" },
] };

test("a short addition splits only the selected branch and preserves people, data and human corrections", () => {
  const before = editReviewStep(base, "send", { actor: "倉庫係長", data: [{ name: "重量", operation: "read", evidence: "重量は参照のみ" }] });
  const snapshot = JSON.stringify(before);
  const note = "物流担当がExcelで重量を確認する。";
  const added: ExtractionReview = { ...blank, organization: { title: "別の題名", activity: "別活動", capability: "", certainty: "inferred", evidence: note },
    steps: [{ ...task("check", note, 1), systems: [{ name: "Excel", interaction: "view", evidence: note }], data: [{ name: "重量", operation: "read", evidence: note }] }] };
  const result = addReviewNote(before, added, { afterStepKey: "check", transition: before.transitions[0] }, note, "test-1");
  assert.equal(result.review.summary, before.summary);
  assert.equal(result.review.organization, before.organization);
  assert.equal(result.review.steps.length, 4);
  assert.equal(result.review.steps[1].stepKey, result.addedKeys[0]);
  assert.deepEqual(result.review.steps.find(s => s.stepKey === "send")?.humanEdits, before.steps[1].humanEdits);
  assert.equal(result.review.steps.find(s => s.stepKey === "send")?.data[0].operation, "read");
  assert.deepEqual(result.review.transitions[0], before.transitions[1]);
  assert.equal(result.review.transitions[1].condition, "空きがある");
  assert.equal(result.review.transitions[1].certainty, "inferred", "choosing the insertion point does not confirm an inferred condition");
  assert.equal(result.review.transitions[1].humanEdits?.[0].evidence, note);
  assert.ok(result.review.transitions.some(t => t.fromStepKey === result.addedKeys[0] && t.toStepKey === "send"));
  assert.ok(!result.review.transitions.some(t => t.fromStepKey === "check" && t.toStepKey === "send"));
  assert.equal(JSON.stringify(before), snapshot);
  assert.equal(appendReviewSource("前の原文。\n曖昧な話。", note), `前の原文。\n曖昧な話。\n${note}`);
  const exception = addReviewNote(before, added, { afterStepKey: "check", transition: before.transitions[1] }, note, "exception");
  assert.deepEqual(exception.review.steps.map(s => s.stepKey), ["check", "send", exception.addedKeys[0], "hold"],
    "adding to the exception branch does not move the normal work behind it");
  assert.deepEqual(exception.review.transitions[0], before.transitions[0]);
});

test("hold or ambiguous new branches do not fabricate a resume to the old destination", () => {
  const addition: ExtractionReview = { ...blank, steps: [task("receive", "区間を確認する", 1), { ...base.steps[2], stepKey: "pause", order: 2 }],
    transitions: [{ fromStepKey: "receive", toStepKey: "pause", condition: "違う場合", evidence: "違う場合は保留", certainty: "confirmed" }] };
  const result = addReviewNote(base, addition, { afterStepKey: "check", transition: base.transitions[0] }, "区間が違うときは保留します。", "hold");
  assert.ok(!result.review.transitions.some(t => result.addedKeys.includes(t.fromStepKey) && t.toStepKey === "send"));
  assert.ok(result.review.questions.some(q => q.question.includes("倉庫へTeamsで連絡する")));
  assert.deepEqual(result.review.transitions[0], base.transitions[1]);
  const unconnected = addReviewNote(base, { ...blank, steps: [task("one", "確認する", 1), task("two", "別の作業をする", 2)] },
    { afterStepKey: "check", transition: base.transitions[0] }, "確認と別の作業があります。", "unknown");
  assert.deepEqual(unconnected.review.transitions, base.transitions);
  assert.ok(unconnected.review.questions.some(q => q.reason.includes("開始点")));
});

test("human-selected position survives graph projection, SQLite, resolution and a reread with new AI step keys", async () => {
  const note = "物流担当がExcelで重量を確認する。";
  const addition = { ...blank, steps: [task("weight", note, 1)] };
  const positioned = addReviewNote(base, addition, { afterStepKey: "check", transition: base.transitions[0] }, note, "storage").review;
  const original = editReviewStep(positioned, positioned.steps[1].stepKey, { actor: "物流係長" });
  const empty: LensGraph = { workflows: [], nodes: [], edges: [], dataFlows: [] };
  const workflow = { id: "shipping", name: "船積手配" };
  const projected = previewReviewGraph(empty, workflow, original);
  const repository = new SqliteBusinessFlowRepository(join(mkdtempSync(join(tmpdir(), "lens-addition-")), "test.sqlite"));
  const source = appendReviewSource("空きがあれば倉庫へ連絡する。", note);
  await repository.saveProject({ projectId: "test", projectName: "Test", graph: projected, transcripts: { [workflow.id]: source }, updatedAt: new Date().toISOString() });
  const loaded = (await repository.loadProject("test"))!;
  assert.equal(loaded.transcripts[workflow.id], source);
  const restored = buildWorkflowReviewFromGraph(loaded.graph, workflow.id);
  assert.equal(restored.transitions.filter(t => t.humanEdits?.length).length, 2);
  const resolved = resolveWorkflowReviewLocally({ graph: empty, workflow, review: original });
  assert.equal(resolved.patch.edges.filter(e => e.relation === "next" && e.humanEdits?.length).length, 2);
  const reread: ExtractionReview = { ...base, steps: original.steps.map((s, i) => ({ ...s, stepKey: `new-${i}`, humanEdits: undefined })),
    transitions: [{ ...base.transitions[0], fromStepKey: "new-0", toStepKey: "new-2" }, { ...base.transitions[1], fromStepKey: "new-0", toStepKey: "new-3" }] };
  reread.steps[1].actor = "物流担当";
  reread.warnings = ["原文を読んで担当を物流担当に戻しました。"];
  const retained = preserveRefinements(reread, restored);
  assert.equal(retained.steps.find(s => s.stepKey === "new-1")?.actor, "物流係長");
  assert.ok(retained.warnings.some(w => w === "人の訂正を反映する前の候補への注意：原文を読んで担当を物流担当に戻しました。"));
  assert.ok(retained.warnings.some(w => w.includes("担当する人") && w.includes("利用者の訂正を保持")));
  assert.ok(retained.transitions.some(t => t.fromStepKey === "new-0" && t.toStepKey === "new-1" && t.humanEdits?.length));
  assert.ok(retained.transitions.some(t => t.fromStepKey === "new-1" && t.toStepKey === "new-2" && t.humanEdits?.length));
  assert.ok(!retained.transitions.some(t => t.fromStepKey === "new-0" && t.toStepKey === "new-2"));
  assert.ok(retained.transitions.some(t => t.fromStepKey === "new-0" && t.toStepKey === "new-3"));
});

test("a stale arrow is rejected without changing the graph, and fact-only input keeps the original connection", () => {
  assert.throws(() => addReviewNote(base, { ...blank, steps: [task("new", "照会する", 1)] },
    { afterStepKey: "check", transition: { ...base.transitions[0], condition: "別の条件" } }, "照会する。", "stale"), /選び直し/);
  const fact = addReviewNote(base, { ...blank, questions: [{ question: "何を確認しますか？", reason: "作業は未確認", target: "scope" }] },
    { afterStepKey: "check", transition: base.transitions[0] }, "確認の詳細はまだ分かりません。", "fact");
  assert.deepEqual(fact.review.transitions, base.transitions);
  assert.equal(fact.addedKeys.length, 0);
  assert.equal(fact.review.questions.length, 1);
});

test("a platform-only addition and a dependency explanation update are distinct from adding or removing tasks and relations", () => {
  const note = "SharePointの認証にはEntra IDを使います。";
  const addition: ExtractionReview = { ...blank, systemDependencies: [{ system: "SharePoint", prerequisite: "Entra ID", reason: "契約フォルダの認証に必要", certainty: "confirmed", evidence: note }] };
  const added = addReviewNote(base, addition, { afterStepKey: "check", transition: base.transitions[0] }, note, "platform").review;
  const diff = diffReviews(base, added);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.changed.length, 0);
  assert.equal(diff.addedConnections.length, 1);
  const reworded: ExtractionReview = { ...added, systemDependencies: added.systemDependencies!.map(d => ({ ...d, reason: "契約フォルダの閲覧時にSSOで認証する" })) };
  const updated = diffReviews(added, reworded);
  assert.equal(updated.addedConnections.length, 0);
  assert.equal(updated.removedConnections.length, 0);
  assert.equal(updated.changedConnections.length, 1);
  assert.ok(updated.changedConnections[0].after.includes("閲覧時にSSO"));
  const excluded = diffReviews(reworded, { ...reworded, systemDependencies: reworded.systemDependencies!.map(d => ({ ...d, rejected: true })) });
  assert.equal(excluded.changedConnections.length, 1);
  assert.ok(excluded.changedConnections[0].after.includes("この関係を除外"));
});
