import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractGroundedLocal } from "../lib/local-review";
import {
  applyReviewConnections,
  diffReviews,
  editReviewStep,
  stepToolsFromText,
  previewReviewGraph,
  recordReviewEdits,
  describeHumanEdit,
  transcriptsForSave,
} from "../lib/review-workbench";
import {
  buildWorkflowReviewFromGraph,
  replaceWorkflowGraph,
  type LensGraph,
  type ExtractionReviewStep,
} from "../lib/graph";
import { handoffEntry, stepContext } from "../lib/flow-context";
import { SqliteBusinessFlowRepository } from "../lib/storage/sqlite";
import { resolveWorkflowReviewLocally } from "../lib/ai/provider";
import { preserveRefinements } from "../lib/refinement";
import { createChemicalCompany } from "../lib/chemical-company";
import {
  compareWorkflow,
  knowledgeIndex,
  knowledgeReport,
} from "../lib/knowledge";

const empty: LensGraph = { workflows: [], nodes: [], edges: [], dataFlows: [] };
const workflow = {
  id: "ambiguous-note",
  name: "入力した話",
  scenario: "current" as const,
};
const notes =
  "営業部の佐藤さんがメールで「注文書」を受け取る。\n佐藤さんがExcelで「受注確認リスト」を作成する。\n佐藤さんがExcelから「受注確認リスト」をSAPへ手動で転記する。\nSAPが自動で在庫を確認する。\n在庫が不足する場合、佐藤さんはTeamsで生産管理部に納期の調整を依頼する。\n在庫がある場合、SAPから「出荷指示」をWMSへAPIで自動送信する。";

test("a question-only memo survives storage and reconstruction without fabricated work", async () => {
  const source = "購買の仕事を整理したいが、作業内容はまだ分からない。";
  const question = { question: "最初に届く情報はありますか？", reason: "まだ具体的な作業が説明されていません。", target: "scope" as const };
  const review = { summary: source, trigger: null, outcome: null, steps: [], transitions: [], dataFlows: [], questions: [question], warnings: [] };
  const repository = new SqliteBusinessFlowRepository(join(mkdtempSync(join(tmpdir(), "lens-unknown-")), "test.sqlite"));
  await repository.saveProject({ projectId: "test", projectName: "Test", graph: previewReviewGraph(empty, workflow, review),
    transcripts: { [workflow.id]: source }, updatedAt: new Date().toISOString() });
  const loaded = (await repository.loadProject("test"))!;
  const restored = buildWorkflowReviewFromGraph(loaded.graph, workflow.id);
  assert.deepEqual(restored.questions, [question]);
  assert.deepEqual(restored.steps, []);
  assert.deepEqual(loaded.graph.nodes, []);
  assert.equal(loaded.transcripts[workflow.id], source);
});

test("first memo previews people, groupware, data and branches without saving or inventing outcomes", () => {
  const review = extractGroundedLocal(notes);
  const graph = previewReviewGraph(empty, workflow, review);
  assert.equal(empty.nodes.length, 0);
  assert.equal(empty.workflows.length, 0);
  assert.equal(review.steps.length, 6);
  assert.equal(review.steps[0].actor, "営業部の佐藤さん");
  assert.equal(review.steps[0].department, "営業部");
  assert.equal(review.steps[0].data[0].operation, "receive");
  assert.equal(review.steps[1].data[0].operation, "create");
  assert.equal(review.steps[4].actor, "佐藤さん");
  assert.equal(review.steps[5].data[0].operation, "send");
  assert.equal(review.steps[5].executingSystem, "SAP");
  assert.equal(review.steps[3].meaning?.result, "");
  assert.ok(graph.nodes.some((n) => n.label === "Teams"));
  assert.ok(graph.dataFlows.some((f) => f.transferType === "manual"));
  const check = graph.nodes.find(
    (n) => n.action === "SAPが自動で在庫を確認する",
  )!;
  const context = stepContext(graph, workflow.id, check.id);
  assert.equal(context.outgoing.length, 2);
  assert.equal(context.next, undefined);
  assert.ok(
    context.outgoing.every(
      (o) => o.edge.label && o.edge.evidence && o.edge.status === "inferred",
    ),
  );
  assert.ok(
    !review.transitions.some(
      (t) =>
        t.fromStepKey === review.steps[4].stepKey &&
        t.toStepKey === review.steps[5].stepKey,
    ),
  );
});

test("saving one memo uses persisted sources and cannot publish another unsaved memo", () => {
  const saved = { order: "保存した受注の原文", plan: "保存した計画の原文" };
  const result = transcriptsForSave(saved, "order", "今回確認した受注の原文");
  assert.deepEqual(result, {
    order: "今回確認した受注の原文",
    plan: "保存した計画の原文",
  });
  assert.equal(saved.order, "保存した受注の原文");
  assert.deepEqual(transcriptsForSave(saved, "new-memo", "まだ名前のない話"), {
    ...saved,
    "new-memo": "まだ名前のない話",
  });
});

test("ambiguous memo retains unknown actors and outcomes while showing a comma-less condition as inferred", () => {
  const review = extractGroundedLocal(
    "注文がメールで届く。担当の人がExcelで確認する。足りなければ別の部署に相談している。",
  );
  assert.equal(review.steps.length, 3);
  assert.ok(
    review.steps.every(
      (s) => !s.actor && !s.department && !s.meaning?.result && !s.data.length,
    ),
  );
  assert.equal(review.steps[2].meaning?.condition, "足りなければ");
  assert.equal(review.transitions[1].condition, "足りなければ");
  assert.equal(review.transitions[1].certainty, "inferred");
});

test("AI re-extraction cannot silently discard a handoff confirmed by a person", () => {
  const before = extractGroundedLocal(notes);
  before.handoffs = [
    {
      fromStepKey: before.steps[4].stepKey,
      targetWorkflowId: "plan",
      targetStepKey: "receive",
      data: ["不足リスト"],
      description: "生産計画に不足を渡す",
      evidence: "担当者が接続を確認",
      certainty: "confirmed",
    },
  ];
  const next = { ...structuredClone(before), handoffs: [] };
  const after = preserveRefinements(next, before);
  assert.deepEqual(after.handoffs, before.handoffs);
  assert.ok(after.warnings.some((w) => w.includes("受渡しを保持")));
});

test("answers do not freeze the old draft when the source is corrected", () => {
  const before = extractGroundedLocal(notes);
  const revised = notes.replace(
    "SAPが自動で在庫を確認する",
    "SAPが自動で「在庫判定」を確定する",
  );
  const after = extractGroundedLocal(revised, before, empty, [
    { question: before.questions[0].question, answer: "不足の時だけ依頼する" },
  ]);
  assert.equal(after.steps.length, 6);
  assert.ok(after.steps.some((s) => s.action.includes("「在庫判定」を確定")));
  assert.ok(!after.steps.some((s) => s.action === "SAPが自動で在庫を確認する"));
  assert.equal(
    diffReviews(before, after).changed.length +
      diffReviews(before, after).added.length,
    1,
  );
  assert.ok(after.warnings.some((w) => w.includes("追加回答")));
});

test("append and removal produce a reviewable delta with stable unaffected identities", () => {
  const before = extractGroundedLocal(
    "営業担当がメールで「注文」を受け取る。営業担当がExcelで「受注表」を作成する。営業担当がSAPで登録する。",
  );
  const after = extractGroundedLocal(
    "営業担当がメールで「注文」を受け取る。営業担当がTeamsで「注文」を送信する。営業担当がExcelで「受注表」を作成する。",
    before,
  );
  const diff = diffReviews(before, after);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.removed.length, 1);
  assert.equal(after.steps[0].stepKey, before.steps[0].stepKey);
  assert.equal(after.steps[2].stepKey, before.steps[1].stepKey);
  assert.equal(diff.changed.length, 0);
  assert.ok(diff.addedConnections.length);
  assert.ok(diff.removedConnections.length);
});

test("human corrections retain their field value and source; new contradictions become warnings", () => {
  const base = extractGroundedLocal("営業担当がExcelで「確認表」を作成する。");
  const edited = editReviewStep(base, base.steps[0].stepKey, {
    actor: "生産計画担当",
    meaning: {
      purpose: "工場の制約を反映",
      basis: "設備能力表",
      result: "納期を確定",
      next: "顧客への納期回答",
      condition: "承認後",
      halt: false,
      certainty: "confirmed",
      evidence: "担当者の補足",
    },
  });
  const after = extractGroundedLocal(
    "営業担当がExcelで「確認表」を更新する。",
    edited,
  );
  assert.equal(after.steps[0].actor, "生産計画担当");
  assert.equal(after.steps[0].meaning?.result, "納期を確定");
  assert.ok(after.steps[0].humanEdits?.length);
  assert.ok(after.steps[0].evidence.includes("更新"));
  assert.ok(after.warnings.some((w) => w.includes("利用者が訂正")));
});

test("a hold never gets an invented normal successor or resume point", () => {
  const review = extractGroundedLocal(
    "SAPが自動で「与信判定」を確定する。与信限度を超えた場合、営業担当が受注を保留する。営業担当が経理担当へ解除を依頼する。",
  );
  assert.ok(review.steps[1].meaning?.halt);
  assert.ok(
    !review.transitions.some(
      (t) =>
        t.fromStepKey === review.steps[1].stepKey &&
        t.toStepKey === review.steps[2].stepKey,
    ),
  );
  assert.ok(review.questions.some((q) => q.target === "exception"));
  assert.ok(
    review.questions.some((q) => q.question.includes("どの条件・手順")),
  );
});

test("human result corrections protect only edited meaning fields while the latest source updates other facts", () => {
  const before = extractGroundedLocal("営業担当が「旧価格表」を参照する。");
  const edited = editReviewStep(before, before.steps[0].stepKey, {
    meaning: {
      ...before.steps[0].meaning!,
      result: "承認後に価格が確定",
      certainty: "confirmed",
      evidence: "人の補足",
    },
  });
  const after = extractGroundedLocal(
    "営業担当が「新価格表」を参照する。",
    edited,
  );
  assert.equal(after.steps[0].meaning?.result, "承認後に価格が確定");
  assert.equal(after.steps[0].meaning?.basis, "新価格表");
  assert.deepEqual(
    edited.steps[0].humanEdits?.map((e) => e.field),
    ["meaning.result"],
  );
  assert.ok(
    describeHumanEdit(edited.steps[0].humanEdits![0])[0].includes(
      "決まる・変わること：未確認 → 承認後に価格が確定",
    ),
  );
});

test("clearing an inferred tool preserves other steps and human correction after save, reload and re-extraction", async () => {
  const original = extractGroundedLocal("営業担当がFormsに要件を入力する。技術営業がFormsで要求条件を確認する。");
  original.steps.forEach(step => { step.systems = [{ name: "Forms", interaction: "view", evidence: step.evidence }]; });
  const target = original.steps[1];
  const edited = editReviewStep(original, target.stepKey, { systems: stepToolsFromText(target.systems, "") });
  const graph = previewReviewGraph(empty, workflow, edited);
  assert(original.steps[0].systems.some(s => s.name === "Forms"));
  assert.equal(graph.edges.filter(e => e.source.includes(target.stepKey) && e.relation === "uses").length, 0);
  const repository = new SqliteBusinessFlowRepository(join(mkdtempSync(join(tmpdir(), "lens-tools-")), "test.sqlite"));
  await repository.saveProject({ projectId: "tool-correction", projectName: "Test", graph, transcripts: {}, updatedAt: new Date().toISOString() });
  const loaded = (await repository.loadProject("tool-correction"))!.graph;
  const restored = buildWorkflowReviewFromGraph(loaded, workflow.id);
  const reread = preserveRefinements(original, restored);
  assert.deepEqual(reread.steps[1].systems, []);
  assert(reread.steps[0].systems.some(s => s.name === "Forms"));
  assert.deepEqual(restored.steps[1].humanEdits?.find(e => e.field === "systems")?.after, []);
});

test("editing tools keeps unchanged source evidence, exact environment names and separately added human evidence", () => {
  const original: ExtractionReviewStep["systems"] = [{ name: "SAP 本番", interaction: "input", evidence: "本番SAPで登録" }, { name: "SAP 検証", interaction: "view", evidence: "検証SAPで試す" }];
  const tools = stepToolsFromText(original, "SAP 本番\n\nSAP 検証\nTeams\nTeams\n");
  assert.deepEqual(tools.slice(0, 2), original);
  assert.equal(tools.length, 3);
  assert.equal(tools[2].evidence, "利用者が構造の確認中に補足");
  assert.equal(tools[2].interaction, "other");
});

test("a human exclusion survives re-extraction and reload, with no invented bridge across it", () => {
  const original = extractGroundedLocal(
    "営業担当がメールで注文を受け取る。営業担当がExcelで内容を確認する。営業担当がSAPで登録する。",
  );
  const excluded = original.steps[1];
  const review = {
    ...original,
    steps: original.steps.filter((s) => s !== excluded),
    excludedSteps: [excluded],
    transitions: [],
  };
  const refined = extractGroundedLocal(
    original.steps.map((s) => s.evidence).join("。"),
    review,
  );
  assert.equal(refined.steps.length, 2);
  assert.equal(refined.transitions.length, 0);
  assert.equal(refined.excludedSteps?.[0].evidence, excluded.evidence);
  assert.equal(
    buildWorkflowReviewFromGraph(
      previewReviewGraph(empty, workflow, refined),
      workflow.id,
    ).excludedSteps?.length,
    1,
  );
  assert.ok(refined.warnings.some((w) => w.includes("除外を維持")));
});

test("separate conditions to the same destination survive projection, SQLite and reconstruction", async () => {
  const review = extractGroundedLocal(
    "営業担当が与信を確認する。営業担当が出荷を依頼する。",
  );
  const base = review.transitions[0];
  review.transitions = [
    { ...base, condition: "限度内", certainty: "confirmed" },
    { ...base, condition: "事前承認済み", certainty: "confirmed" },
  ];
  const rebuilt = buildWorkflowReviewFromGraph(
    previewReviewGraph(empty, workflow, review),
    workflow.id,
  );
  assert.deepEqual(
    rebuilt.transitions.map((t) => t.condition).sort(),
    ["事前承認済み", "限度内"].sort(),
  );
  const repo = new SqliteBusinessFlowRepository(
    join(mkdtempSync(join(tmpdir(), "conditions-")), "test.sqlite"),
  );
  await repo.saveProject({
    projectId: "test",
    projectName: "Test",
    graph: previewReviewGraph(empty, workflow, review),
    transcripts: {},
    updatedAt: new Date().toISOString(),
  });
  const loaded = (await repo.loadProject("test"))!;
  assert.deepEqual(
    buildWorkflowReviewFromGraph(loaded.graph, workflow.id)
      .transitions.map((t) => t.condition)
      .sort(),
    rebuilt.transitions.map((t) => t.condition).sort(),
  );
});

test("advanced corrections are tracked and reused without silently selecting an ambiguous asset", () => {
  const before = extractGroundedLocal("営業担当がExcelで登録する。");
  const after = recordReviewEdits(before, {
    ...before,
    steps: before.steps.map((s) => ({ ...s, actor: "購買担当" })),
  });
  assert.equal(
    extractGroundedLocal("営業担当がExcelで更新する。", after).steps[0].actor,
    "購買担当",
  );
  const graph = previewReviewGraph(empty, workflow, before);
  const excel = graph.nodes.find((n) => n.kind === "system")!;
  graph.nodes.push({
    ...excel,
    id: "system:excel-department",
    canonicalKey: "system:excel-department",
  });
  const preview = previewReviewGraph(
    graph,
    { id: "other", name: "別の話" },
    before,
  );
  assert.ok(
    preview.nodes.some(
      (n) => n.canonicalKey === "system:unresolved:excel:other",
    ),
  );
});

test("save, SQLite reload and reconstruction retain meaning, human edits and branch evidence", async () => {
  const review = extractGroundedLocal(notes);
  const edited = editReviewStep(review, review.steps[3].stepKey, {
    meaning: {
      purpose: "納期の回答前に不足を確認する",
      basis: "利用可能在庫",
      result: "不足なら製造が必要と判定",
      next: "生産計画の調整",
      condition: "受注入力後",
      halt: false,
      certainty: "confirmed",
      evidence: "人の補足",
    },
  });
  const resolution = resolveWorkflowReviewLocally({
    graph: empty,
    workflow,
    review: edited,
  });
  const graph = replaceWorkflowGraph(empty, workflow, resolution.patch);
  const repo = new SqliteBusinessFlowRepository(
    join(mkdtempSync(join(tmpdir(), "input-structure-")), "test.sqlite"),
  );
  await repo.saveProject({
    projectId: "test",
    projectName: "Test",
    graph,
    transcripts: { [workflow.id]: notes },
    updatedAt: new Date().toISOString(),
  });
  const loaded = (await repo.loadProject("test"))!;
  const rebuilt = buildWorkflowReviewFromGraph(loaded.graph, workflow.id);
  assert.deepEqual(rebuilt.steps[3].meaning, edited.steps[3].meaning);
  assert.deepEqual(rebuilt.steps[3].humanEdits, edited.steps[3].humanEdits);
  assert.deepEqual(
    rebuilt.transitions.map((t) => [t.condition, t.evidence, t.certainty]),
    edited.transitions.map((t) => [t.condition, t.evidence, t.certainty]),
  );
  assert.equal(
    diffReviews(edited, rebuilt).changed.length,
    0,
    "storage reconstruction changes field order and shared evidence, not the interpreted structure",
  );
  assert.equal(loaded.transcripts[workflow.id], notes);
});

test("cross-workflow handoffs carry the data and specified receiving step; ambiguity stays unresolved", () => {
  const second = { id: "plan", name: "需給調整", scenario: "current" as const };
  const targetReview = extractGroundedLocal(
    "生産計画担当がTeamsで依頼を受け取る。生産計画担当がSAPで「不足リスト」を参照する。",
  );
  const graph = previewReviewGraph(empty, second, targetReview);
  const review = extractGroundedLocal(
    "営業担当がExcelで「不足リスト」を作成する。",
  );
  review.handoffs = [
    {
      fromStepKey: review.steps[0].stepKey,
      targetWorkflowId: second.id,
      targetStepKey: targetReview.steps[1].stepKey,
      data: ["不足リスト"],
      description: "不足を生産計画へ渡す",
      evidence: "担当者が確認",
      certainty: "confirmed",
    },
  ];
  const connected = applyReviewConnections(
    previewReviewGraph(graph, workflow, review),
    workflow,
    review,
  );
  const handoff = connected.knowledge!.handoffs![0];
  const entry = handoffEntry(connected, handoff);
  assert.equal(
    entry.stepId,
    connected.nodes.find((n) => n.workflowId === "plan" && n.stepOrder === 2)
      ?.id,
  );
  assert.ok(entry.entryKnown);
  assert.equal(
    connected.nodes.find((n) => n.id === entry.dataId)?.label,
    "不足リスト",
  );
  const ambiguous = structuredClone(connected);
  handoff.targetProcessId = undefined;
  const p = ambiguous.nodes.find(
    (n) => n.workflowId === "plan" && n.stepOrder === 1,
  )!;
  ambiguous.edges.push({
    id: "also-reads",
    source: p.id,
    target: entry.dataId!,
    relation: "reads",
    workflowIds: ["plan"],
  });
  assert.equal(handoffEntry(ambiguous, handoff).entryKnown, false);
});

test("integration-only use is counted alongside step use in one scenario, with clear breakdown", () => {
  const graph = createChemicalCompany();
  const view = knowledgeIndex(graph, "current");
  const snowflake = graph.nodes.find((n) => n.label === "Snowflake DWH")!;
  const impact = view.systemProfile(snowflake.id);
  assert.equal(impact.direct.length, 300);
  assert.ok(impact.stepUse.length < impact.direct.length);
  assert.equal(impact.flowUse.length, 300);
  assert.ok(impact.direct.every((r) => r.workflow.scenario === "current"));
  assert.equal(
    knowledgeIndex(graph, "future").systemProfile(snowflake.id).direct.length,
    3,
  );
});

test("300-workflow reporting includes the results and conditions of new future steps and removed manual work", () => {
  const graph = createChemicalCompany();
  const report = knowledgeReport(graph, "current", "", "");
  assert.equal((report.match(/^## /gm) ?? []).length, 300);
  assert.ok(
    report.includes(
      "追加する処理の結果: API連携で承認済み確定値を業務システムへ反映する",
    ),
  );
  assert.ok(
    report.includes("版の照合に成功した値だけが正式記録へ自動反映される"),
  );
  assert.ok(report.includes("正式記録を更新せず連携が保留される"));
  assert.ok(
    report.includes(
      "除外する処理の結果: Excelの確定値を業務システムへ転記する",
    ),
  );
});

test("comparison and reports describe changes in business results, evidence and branches", () => {
  let graph = previewReviewGraph(
    empty,
    { ...workflow, familyId: "family" },
    extractGroundedLocal("営業担当がExcelで「価格表」を作成する。"),
  );
  const review = extractGroundedLocal(
    "営業担当がExcelで「価格表」を作成する。",
  );
  review.steps[0].meaning = {
    purpose: "転記を減らす",
    basis: "承認済み価格条件",
    result: "受注価格を自動反映",
    next: "与信判定",
    condition: "価格承認後",
    halt: false,
    certainty: "inferred",
    evidence: "将来案として入力",
  };
  graph = previewReviewGraph(
    graph,
    { id: "future", name: "改善後", familyId: "family", scenario: "future" },
    review,
  );
  assert.equal(compareWorkflow(graph, workflow.id)[0].resultChanges.length, 1);
  const report = knowledgeReport(graph, "current", "", "", [workflow.id]);
  assert.ok(report.includes("受注価格を自動反映"));
  assert.ok(report.includes("将来案として入力"));
  assert.ok(report.includes("結果の比較"));
});
