import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractGroundedLocal } from "../lib/local-review";
import { buildWorkflowReviewFromGraph, type LensGraph, type ReviewSystemDependency } from "../lib/graph";
import { previewReviewGraph, diffReviews } from "../lib/review-workbench";
import { preserveRefinements } from "../lib/refinement";
import { groundedDependency, validateSystemDependencies, editSystemDependency, inputSystemDependencies } from "../lib/system-dependencies";
import { knowledgeIndex, knowledgeReport } from "../lib/knowledge";
import { scopedAssetNodes } from "../lib/ai/asset-context";
import { SqliteBusinessFlowRepository } from "../lib/storage/sqlite";

const source = "TeamsとSharePointはEntra IDのSSOを使います。";
const dependency = (system = "Teams"): ReviewSystemDependency => ({ system, prerequisite: "Entra ID", reason: "ログイン認証", certainty: "confirmed", evidence: source });
const empty = (): LensGraph => ({ workflows: [], nodes: [], edges: [], dataFlows: [] });
function declaredGraph(scenario: "current" | "future" = "current") {
  const review = extractGroundedLocal("営業がTeamsで報告する。");
  review.systemDependencies = [dependency()];
  const graph = previewReviewGraph(empty(), { id: "platform-note", name: "認証の説明", scenario }, review);
  return { review, graph };
}

test("source-grounded platform dependencies need a direction, not co-use, transfer, negation or future assumptions", () => {
  assert(groundedDependency(dependency(), source));
  assert(groundedDependency(dependency("SharePoint"), source));
  const login = "TeamsとSharePointのログインはEntra IDのSSOを使っています。";
  for (const system of ["Teams", "SharePoint"]) {
    assert(groundedDependency({ ...dependency(system), evidence: login.slice(0, -1) }, `人事担当が一覧を保存します。${login}`));
    assert(!groundedDependency({ ...dependency(system), evidence: login.replace("使っています", "使っていません") }, login.replace("使っています", "使っていません")));
  }
  assert(groundedDependency({ ...dependency(), system: "VPN", evidence: "VPNのログインはEntra IDで認証します。" }, "VPNのログインはEntra IDで認証します。"));
  for (const evidence of ["TeamsとEntra IDを使います。", "TeamsはEntra IDと一緒に使います。", "TeamsはEntra IDの認証ログを参照します。", "TeamsはEntra IDから認証ログを受け取ります。", "TeamsからEntra IDへ記録を送ります。", "TeamsはEntra IDのSSOを使わない。", "TeamsはEntra IDのSSOを利用しません。", "TeamsはEntra IDのSSOを使う予定です。", "TeamsはEntra IDのSSOを使うか未確認です。"]) {
    assert(!groundedDependency({ ...dependency(), evidence }, evidence), evidence);
  }
  assert(!groundedDependency({ ...dependency(), system: "Entra ID", prerequisite: "Teams" }, source));
  assert(!groundedDependency(dependency(), "Teamsだけを使います。"));
  assert(!groundedDependency({ ...dependency(), evidence: "TeamsはEntra IDのSSOを使う" }, "TeamsはEntra IDのSSOを使うか未確認です。"));
  assert(!groundedDependency({ ...dependency(), evidence: "TeamsはEntra IDのSSOを使う" }, "TeamsはEntra IDのSSOを使う予定です。"));
  const review = extractGroundedLocal("営業がTeamsで報告する。");
  review.systemDependencies = [dependency()];
  const invalid = validateSystemDependencies(review, "営業がTeamsで報告する。");
  assert.equal(invalid.systemDependencies![0].certainty, "unknown");
  assert.equal(invalid.questions.at(-1)!.target, "system");
  assert.equal(invalid.steps.length, review.steps.length);
  const forged = validateSystemDependencies({ ...review, systemDependencies: [{ ...dependency(), origin: "human", rejected: true }] }, "Teamsだけを使います。", false);
  assert.equal(forged.systemDependencies![0].certainty, "unknown");
  assert.equal(forged.systemDependencies![0].origin, "ai");
  assert.equal(forged.systemDependencies![0].rejected, undefined);
});

test("a dependency creates first-class platforms without an invented task or direct use and retains its source through SQLite", async () => {
  const { review, graph } = declaredGraph();
  const entra = graph.nodes.find(n => n.label === "Entra ID")!;
  assert(entra);
  assert.equal(graph.nodes.filter(n => n.kind === "process").length, review.steps.length);
  assert(!graph.edges.some(e => e.target === entra.id || e.source === entra.id));
  const second = previewReviewGraph(graph, { id: "other-work", name: "品質連絡", scenario: "current" }, extractGroundedLocal("品質担当がTeamsで連絡する。"));
  const impact = knowledgeIndex(second, "current").systemProfile(entra.id);
  assert.equal(impact.direct.length, 0);
  assert.equal(impact.indirect.length, 2);
  const teams = second.nodes.find(n => n.label === "Teams")!;
  const d = knowledgeIndex(second, "current").systemProfile(teams.id).profile!.dependsOn[0];
  assert.equal(d.evidence, source);
  assert.equal(d.sourceWorkflowId, "platform-note");
  assert.deepEqual(knowledgeIndex(second, "future").systemProfile(entra.id).dependents, []);
  assert.equal(second.knowledge!.systems.some(s => s.dependsOn.length), false);
  const repo = new SqliteBusinessFlowRepository(join(mkdtempSync(join(tmpdir(), "platform-test-")), "test.sqlite"));
  await repo.saveProject({ projectId: "qa", projectName: "qa", graph: second, transcripts: {}, updatedAt: new Date().toISOString() });
  const restored = (await repo.loadProject("qa"))!.graph;
  assert.equal(buildWorkflowReviewFromGraph(restored, "platform-note").systemDependencies![0].evidence, source);
  assert.equal(knowledgeIndex(restored, "current").systemProfile(entra.id).indirect.length, 2);
});

test("future-only platform identity, uncertain aliases, source corrections and human exclusions do not become company dependencies", () => {
  const { graph, review } = declaredGraph("future");
  const entra = graph.nodes.find(n => n.label === "Entra ID")!;
  assert(!scopedAssetNodes(graph, { id: "new", name: "現在", scenario: "current" }).some(n => n.id === entra.id));
  assert(scopedAssetNodes(graph, { id: "new", name: "将来", scenario: "future" }).some(n => n.id === entra.id));
  const ambiguous = { ...graph, nodes: [...graph.nodes, { ...entra, id: "different-identity", canonicalKey: "system:different-identity" }] };
  assert.deepEqual(inputSystemDependencies(ambiguous, ["platform-note"]), []);
  const fresh = { ...review, systemDependencies: [] };
  assert.deepEqual(preserveRefinements(fresh, review).systemDependencies, []);
  const corrected = { ...review, systemDependencies: [editSystemDependency(review.systemDependencies![0], { rejected: true })] };
  const reasonEdit = editSystemDependency(review.systemDependencies![0], { reason: "社内ログイン", rejected: false });
  assert.deepEqual(reasonEdit.humanEdits!.map(e => e.field), ["reason"]);
  const reread = preserveRefinements(review, corrected);
  assert.equal(reread.systemDependencies![0].rejected, true);
  assert.equal(reread.systemDependencies![0].evidence, source);
  assert.equal(reread.systemDependencies![0].humanEdits![0].field, "rejected");
  const excluded = previewReviewGraph(graph, graph.workflows[0], reread);
  assert.equal(knowledgeIndex(excluded, "future").systemProfile(entra.id).indirect.length, 0);
  assert(diffReviews(review, corrected).addedConnections.some(s => s.includes("除外")));
});

test("a platform-only story remains searchable and visible without counting its declaration as performed business use", () => {
  const review = { ...extractGroundedLocal(""), steps: [], systemDependencies: [dependency()] };
  const graph = previewReviewGraph(empty(), { id: "only-platforms", name: "認証の説明", scenario: "current" }, review);
  const current = knowledgeIndex(graph, "current", "Entra ID");
  assert.equal(current.rows.length, 1);
  assert.equal(current.systemDeclarations.length, 1);
  const entra = graph.nodes.find(n => n.label === "Entra ID")!;
  const impact = current.systemProfile(entra.id);
  assert.equal(impact.direct.length, 0);
  assert.equal(impact.indirect.length, 0);
  assert.equal(impact.declarations[0].sourceWorkflowName, "認証の説明");
  assert.equal(knowledgeIndex(graph, "future").systemDeclarations.length, 0);
  assert(knowledgeReport(graph, "current", "", "", undefined, entra.id).includes(`原文: ${source}`));
  assert(!knowledgeReport(graph, "future", "", "", undefined, entra.id).includes(`原文: ${source}`));
});

test("a manual registered dependency keeps its reason and declaration sources obey scenario rather than exploration department", () => {
  const { graph } = declaredGraph();
  const teams = graph.nodes.find(n => n.label === "Teams")!, entra = graph.nodes.find(n => n.label === "Entra ID")!;
  graph.knowledge!.systems.push({ systemId: teams.id, categoryId: "", purpose: "", owner: "", dependsOn: [{ systemId: entra.id, reason: "人が確認した依存" }] });
  const result = knowledgeIndex(graph, "current").systemProfile(teams.id).profile!;
  assert.equal(result.dependsOn.length, 1);
  assert.equal(result.dependsOn[0].reason, "人が確認した依存");
  assert.equal(result.dependsOn[0].sourceWorkflowId, undefined);
  graph.knowledge!.systems = [];
  graph.nodes.filter(n => n.kind === "process").forEach(n => n.department = "営業");
  const other = previewReviewGraph(graph, { id: "quality", name: "品質", scenario: "current" }, extractGroundedLocal("品質担当がTeamsで連絡する。"));
  other.nodes.filter(n => n.workflowId === "quality").forEach(n => n.department = "品質");
  assert.equal(knowledgeIndex(other, "current", "", "品質").systemProfile(entra.id).indirect.length, 1);
});
