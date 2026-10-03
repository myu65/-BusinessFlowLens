import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractGroundedLocal } from "../lib/local-review";
import { previewReviewGraph, diffReviews, editReviewStep } from "../lib/review-workbench";
import { createQuestionReferenceFinder, referenceAnswer, effectiveFollowUpAnswers, scopeReferenceDataFlows, groundedReferenceReading, referencePromptAnswer } from "../lib/question-evidence";
import { SqliteBusinessFlowRepository } from "../lib/storage/sqlite";
import { preserveRefinements } from "../lib/refinement";
import type { ExtractionQuestion, FollowUpAnswer } from "../lib/graph";

const question: ExtractionQuestion = { question: "購買依頼案はどの手段で渡し、誰がどの方法で回答しますか？", reason: "受渡し方法は未確認", target: "handoff" };
function fixture() {
  const parent = { id: "mrp", name: "製造計画" }, child = { id: "purchase", name: "原料の購買" };
  const before = extractGroundedLocal("生産計画担当がSAPで購買依頼案を作る。");
  before.steps[0].data = [{ name: "購買依頼案", operation: "create", evidence: before.steps[0].evidence }];
  before.questions = [question];
  let graph = previewReviewGraph({ workflows: [], nodes: [], edges: [], dataFlows: [] }, parent, before);
  const received = extractGroundedLocal("購買担当がSAPから購買依頼案を受け取る。");
  received.steps[0].data = [{ name: "購買依頼案", operation: "receive", evidence: received.steps[0].evidence }];
  received.incomingHandoffs = [{ sourceWorkflowId: parent.id, sourceStepKey: before.steps[0].stepKey,
    toStepKey: received.steps[0].stepKey, data: ["購買依頼案"], description: "購買依頼案を受け取る", evidence: received.steps[0].evidence, certainty: "confirmed" }];
  graph = previewReviewGraph(graph, child, received);
  graph.workflows[0].reviewContext = { summary: before.summary, trigger: before.trigger, outcome: before.outcome, questions: before.questions, warnings: [] };
  const sources = { mrp: "生産計画担当がSAPで購買依頼案を作る。", purchase: "購買担当がSAPから購買依頼案を受け取り、Teamsで調達可否を回答する。" };
  return { graph, sources, before };
}

test("a recorded shared topic suggests the saved peer story without answering or confirming a question", () => {
  const { graph, sources, before } = fixture();
  graph.workflows.push({ id: "unrelated", name: "Teamsで話す仕事" });
  const lookup = createQuestionReferenceFinder(graph, { ...sources, unrelated: "購買依頼案についてTeamsで話す。" });
  const references = lookup("mrp", question);
  assert.deepEqual(references.map(r => r.workflow.id), ["purchase"]);
  assert.equal(references[0].sourceNotes, sources.purchase);
  assert.deepEqual(before.questions, [question]);
  assert.equal(lookup("mrp", { ...question, question: "入金の判断者は誰ですか？" }).length, 0);
  assert.equal(createQuestionReferenceFinder(graph, { mrp: sources.mrp })("mrp", question).length, 0);
  graph.workflows.find(w => w.id === "purchase")!.scenario = "future";
  assert.equal(createQuestionReferenceFinder(graph, sources)("mrp", question).length, 0);
});

test("reference snapshots keep original text and attribution, while a later use supersedes only that same reference", () => {
  const { graph, sources } = fixture();
  const reference = createQuestionReferenceFinder(graph, sources)("mrp", question)[0];
  const first = referenceAnswer(question.question, reference);
  const revised = referenceAnswer(question.question, { ...reference, sourceNotes: "Teamsではなくメールで回答する。" });
  const manual: FollowUpAnswer = { question: question.question, answer: "利用者が確認した担当は購買課長です。" };
  const history = [first, manual, revised];
  const original = structuredClone(history);
  assert.deepEqual(effectiveFollowUpAnswers(history), [manual, revised]);
  assert.deepEqual(history, original);
  assert.equal(first.answer, sources.purchase);
  assert.equal(first.reference?.workflowId, "purchase");
  assert.equal(first.reference?.workflowName, "原料の購買");
  assert(first.reference?.usedAt);
});

test("question differences show which candidate questions changed, without calling removals confirmed answers", () => {
  const { before } = fixture();
  const next = { ...before, questions: [{ ...question, question: "調達不可の後は誰が計画を見直しますか？" }] };
  const diff = diffReviews(before, next);
  assert.deepEqual(diff.removedQuestions, [question]);
  assert.deepEqual(diff.addedQuestions, next.questions);
  assert.equal(diff.changed.length, 0);
});

test("the reference snapshot and an operation correction survive SQLite history and subsequent AI candidates", async () => {
  const { graph, sources, before } = fixture();
  const reference = referenceAnswer(question.question, createQuestionReferenceFinder(graph, sources)("mrp", question)[0]);
  const edited = editReviewStep(before, before.steps[0].stepKey, {
    data: before.steps[0].data.map(d => ({ ...d, operation: "receive" as const })),
  });
  const reread = preserveRefinements(before, edited);
  assert.equal(reread.steps[0].data[0].operation, "receive");
  assert(reread.steps[0].humanEdits?.some(e => e.field === "data"));
  const repository = new SqliteBusinessFlowRepository(join(mkdtempSync(join(tmpdir(), "bfl-question-reference-")), "test.sqlite"));
  await repository.saveProject({ projectId: "test", projectName: "Test", graph,
    transcripts: sources, updatedAt: new Date().toISOString() });
  const summary = await repository.appendWorkflowRevision({ projectId: "test", workflowId: "mrp", workflowName: "製造計画",
    sourceNotes: sources.mrp, followUpAnswers: [reference], review: edited, updatedBy: "test", createdAt: new Date().toISOString() });
  const loaded = (await repository.getWorkflowRevision("test", summary.id))!;
  assert.deepEqual(loaded.followUpAnswers, [reference]);
  assert.equal(loaded.sourceNotes, sources.mrp);
  assert.deepEqual(loaded.review.questions, before.questions);
  assert.equal(loaded.review.steps[0].data[0].operation, "receive");
});

test("reading a purchasing reference does not import its SAP to Excel export into MRP", () => {
  const { graph, sources, before } = fixture();
  const purchase = extractGroundedLocal("購買担当がSAPから購買依頼案をCSVでExcelに出す。");
  const source = referenceAnswer(question.question, { workflow: graph.workflows.find(w => w.id === "purchase")!,
    sourceNotes: sources.purchase, score: 50 });
  const foreign = { sourceSystem: "SAP", targetSystem: "Excel", data: ["購買依頼案"],
    transferType: "file" as const, direction: "push" as const, automation: "manual" as const,
    frequency: null, evidence: "SAPから購買依頼案をCSVでExcelに出す", certainty: "explicit" as const,
    relatedStepKeys: [before.steps[0].stepKey] };
  purchase.dataFlows = [{ ...foreign, relatedStepKeys: [purchase.steps[0].stepKey] }];
  const withPurchase = previewReviewGraph(graph, graph.workflows.find(w => w.id === "purchase")!, purchase);
  const draft = { ...before, dataFlows: [foreign] };
  const original = structuredClone(draft);
  const scoped = scopeReferenceDataFlows(draft, withPurchase, "mrp", sources.mrp, [source]);
  assert.deepEqual(scoped.dataFlows, []);
  assert(scoped.warnings.some(w => w.includes("補足元") && w.includes("SAP → Excel")));
  assert.deepEqual(scoped.questions, before.questions);
  assert.deepEqual(draft, original);
  assert(withPurchase.dataFlows.some(f => f.workflowIds.includes("purchase")));
  // Its own new source, an ordinary answer, or actual local steps can state a
  // transfer. A reference alone cannot take away a recorded local transfer.
  assert.equal(scopeReferenceDataFlows(draft, graph, "mrp", foreign.evidence, [source]).dataFlows.length, 1);
  assert.equal(scopeReferenceDataFlows(draft, graph, "mrp", sources.mrp,
    [source, { question: "転記について", answer: foreign.evidence }]).dataFlows.length, 1);
  const local = structuredClone(draft);
  local.steps[0].systems.push({ name: "Excel", interaction: "input", evidence: "Excelで受け取る" });
  assert.equal(scopeReferenceDataFlows(local, graph, "mrp", sources.mrp, [source]).dataFlows.length, 1);
  const savedLocal = previewReviewGraph(graph, graph.workflows[0], draft);
  assert.equal(scopeReferenceDataFlows(draft, savedLocal, "mrp", sources.mrp, [source]).dataFlows.length, 1);
  const unknown = scopeReferenceDataFlows(draft, graph, "mrp", sources.mrp, [source]);
  assert(unknown.questions.some(q => q.target === "scope"));
  assert.deepEqual(scopeReferenceDataFlows(draft, graph, "mrp", sources.mrp, []), draft);
});

test("connection differences use readable names, while a title correction alone does not change topology", () => {
  const { graph, before } = fixture();
  const next = { ...before, incomingHandoffs: [{ sourceWorkflowId: "purchase", sourceStepKey: graph.nodes.find(n => n.kind === "process" && n.workflowId === "purchase")!.canonicalKey.split(":").at(-1),
    toStepKey: before.steps[0].stepKey, data: ["調達可否"], description: "回答で計画を再開", certainty: "inferred" as const, evidence: "Teamsで回答する" }] };
  const diff = diffReviews(before, next, graph);
  assert(diff.addedConnections[0].includes("原料の購買"));
  assert(diff.addedConnections[0].includes(before.steps[0].name));
  assert(!diff.addedConnections[0].includes("業務:purchase"));
  assert(!diff.addedConnections[0].includes(before.steps[0].stepKey));
  const renamed = { ...next, steps: next.steps.map(s => ({ ...s, name: "計画入力という題名に訂正" })) };
  assert.deepEqual(diffReviews(next, renamed, graph).addedConnections, []);
  assert.deepEqual(diffReviews(next, renamed, graph).removedConnections, []);
});

test("a question-specific AI reading keeps source quotes and uncertainty without sending the unrelated neighboring narrative", () => {
  const { graph } = fixture();
  const snapshot = "購買担当がSAPからCSVでExcelへ出す。購買担当が製造計画の担当へTeamsで調達可否を回答する。再開条件は未確認。";
  const answer = referenceAnswer(question.question, { workflow: graph.workflows[1], sourceNotes: snapshot, score: 50 });
  const reading = groundedReferenceReading(answer, { model: "test-model", facts: [
    { text: "購買担当は製造計画の担当へTeamsで回答する。", evidence: ["購買担当が製造計画の担当へTeamsで調達可否を回答する"], certainty: "explicit" },
    { text: "SAPから自動でメール回答する。", evidence: ["SAPから自動でメール回答する"], certainty: "explicit" },
  ], unanswered: ["計画の再開条件"] });
  assert.equal(reading.facts.length, 1);
  assert(reading.unanswered.some(text => text.includes("原文の引用")));
  const enriched = { ...answer, referenceReading: reading };
  const prompt = referencePromptAnswer(enriched);
  assert(prompt.answer.includes("Teams"));
  assert(!prompt.answer.includes("CSV"));
  assert(prompt.answer.includes("計画の再開条件"));
  assert.equal(enriched.answer, snapshot);
  assert.equal(enriched.referenceReading.model, "test-model");
  assert.equal(groundedReferenceReading(answer, {}).facts.length, 0);
  assert(groundedReferenceReading(answer, {}).unanswered.length > 0);
});
