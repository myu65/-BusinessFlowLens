import test from "node:test";
import assert from "node:assert/strict";
import type { ExtractionReview, ExtractionReviewStep, ReviewSystemDependency } from "../lib/graph";
import { distinguishRegistrationInputs, separateDependencyDescriptions } from "../lib/review-source-semantics";
import { supplementSourceDependencies, validateSystemDependencies } from "../lib/system-dependencies";
import { preserveRefinements } from "../lib/refinement";
import { previewReviewGraph } from "../lib/review-workbench";
import { knowledgeIndex } from "../lib/knowledge";

const statement = "VPNはログイン時にEntra IDの認証を使います。";
const dep = (): ReviewSystemDependency => ({ system: "VPN", prerequisite: "Entra ID", reason: "認証", evidence: statement, certainty: "confirmed" });
const step = (key: string, evidence: string, patch: Partial<ExtractionReviewStep> = {}): ExtractionReviewStep => ({
  stepKey: key, name: evidence, action: evidence, evidence, order: Number(key), actor: null,
  department: null, responsiblePerson: null, executingSystem: null, executionMode: "unknown",
  certainty: "explicit", systems: [], data: [], ...patch,
});
const review = (steps: ExtractionReviewStep[]): ExtractionReview => ({ summary: "接続の設定", trigger: null, outcome: null,
  steps, transitions: [], dataFlows: [], questions: [], warnings: [] });
function fixture() {
  const r = review([step("1", "情報システム担当がVPN利用者を登録します。", { actor: "情報システム担当", executionMode: "manual",
    meaning: { purpose: "", basis: "", result: "利用者を登録する", next: "VPNログイン時の認証に進む", condition: "", halt: false, certainty: "confirmed", evidence: "VPN利用者を登録します" } }),
  step("2", statement, { systems: [{ name: "VPN", interaction: "other", evidence: statement }, { name: "Entra ID", interaction: "other", evidence: statement }] }),
  step("3", "情報システム担当が接続テストを確認します。", { actor: "情報システム担当", executionMode: "manual" })]);
  r.transitions = [{ fromStepKey: "1", toStepKey: "2", condition: "VPNログイン時", evidence: statement },
    { fromStepKey: "2", toStepKey: "3", condition: null, evidence: statement }];
  return r;
}

test("an omitted literal dependency is supplemented without product assumptions or short-name splitting", () => {
  const r = fixture();
  const source = r.steps.map(s => s.evidence).join("");
  const result = supplementSourceDependencies(r, source);
  assert.equal(result.systemDependencies!.length, 1);
  assert.equal(result.systemDependencies![0].system, "VPN");
  assert.equal(result.systemDependencies![0].prerequisite, "Entra ID");
  assert.equal(result.systemDependencies![0].evidence, statement);
  assert.equal(result.systemDependencies![0].certainty, "confirmed");
  assert.equal(r.systemDependencies, undefined);
  const sap = "SAP S/4HANAはEntra IDのSSOを使います。";
  const longest = supplementSourceDependencies(review([]), sap, ["SAP", "SAP S/4HANA", "Entra ID"]);
  assert.deepEqual(longest.systemDependencies!.map(d => d.system), ["SAP S/4HANA"]);
});

test("negative, planned, uncertain, log-reading, co-use, transfer and unstated names do not become dependencies", () => {
  for (const source of ["VPNとEntra IDを使います。", "VPNはEntra IDと一緒に使います。", "VPNはEntra IDの認証を使っていません。",
    "VPNはEntra IDの認証を使うか未確認です。", "VPNはEntra IDの認証を使う予定です。",
    "VPNはEntra IDから認証ログを受け取ります。", "VPNはEntra IDの認証ログを参照します。",
    "VPNからEntra IDへ記録を渡します。", "VPNは認証を使います。"]) {
    assert.deepEqual(supplementSourceDependencies(review([]), source, ["VPN", "Entra ID"]).systemDependencies, [], source);
  }
  assert.deepEqual(supplementSourceDependencies(review([]), statement).systemDependencies, []);
});

test("source supplementation resolves an AI unknown pair but retains a human exclusion, reason and evidence", () => {
  const r = { ...review([]), systemDependencies: [{ ...dep(), certainty: "unknown" as const }] };
  assert.equal(supplementSourceDependencies(r, statement).systemDependencies![0].certainty, "confirmed");
  const human = { ...dep(), origin: "human" as const, rejected: true, reason: "確認して除外した" };
  const kept = supplementSourceDependencies({ ...r, systemDependencies: [human] }, statement).systemDependencies!;
  assert.deepEqual(kept, [human]);
  const forged = validateSystemDependencies({ ...r, systemDependencies: [{ ...human, evidence: "存在しない根拠" }] }, statement, false);
  assert.equal(forged.systemDependencies![0].origin, "ai");
  assert.equal(forged.systemDependencies![0].rejected, undefined);
});

test("a dependency specification leaves the work sequence without bridging or losing its original source", () => {
  const r = fixture(), source = r.steps.map(s => s.evidence).join("");
  r.dataFlows = [{ sourceSystem: "VPN", targetSystem: "Entra ID", data: ["認証情報"], transferType: "api", direction: "push",
    automation: "automatic", frequency: null, certainty: "inferred", evidence: statement, relatedStepKeys: ["2"] }];
  r.dataFlows.push({ ...r.dataFlows[0], relatedStepKeys: [] }, { ...r.dataFlows[0], relatedStepKeys: ["1", "2"] });
  r.handoffs = [{ fromStepKey: "2", targetWorkflowId: "other", data: [], description: "次へ", evidence: statement, certainty: "inferred" }];
  r.incomingHandoffs = [{ sourceWorkflowId: "other", toStepKey: "2", data: [], description: "受け取る", evidence: statement, certainty: "inferred" }];
  const result = separateDependencyDescriptions(supplementSourceDependencies(r, source), source);
  assert.deepEqual(result.steps.map(s => s.stepKey), ["1", "3"]);
  assert.equal(result.transitions.length, 0);
  assert.equal(result.dataFlows.length, 0);
  assert.equal(result.handoffs!.length, 0);
  assert.equal(result.incomingHandoffs!.length, 0);
  assert.equal(result.steps[0].meaning!.next, "");
  assert(result.questions.some(q => q.question.includes("後は")));
  assert.equal(result.systemDependencies![0].evidence, statement);
  const graph = previewReviewGraph({ workflows: [], nodes: [], edges: [], dataFlows: [] }, { id: "setting", name: "利用設定" }, result);
  assert.equal(graph.nodes.filter(n => n.kind === "process").length, 2);
  const vpn = graph.nodes.find(n => n.label === "VPN")!;
  const entra = graph.nodes.find(n => n.label === "Entra ID")!;
  const impact = knowledgeIndex(graph, "current").systemProfile(entra.id);
  assert.equal(impact.direct.length, 0);
  assert.equal(impact.indirect.length, 0);
  assert.equal(knowledgeIndex(graph, "current").systemProfile(vpn.id).profile!.dependsOn[0].systemId, entra.id);
  const onlyDependency = { ...r, steps: [], transitions: [], systemDependencies: [dep()] };
  assert.equal(separateDependencyDescriptions(onlyDependency, source).dataFlows.length, 0);
});

test("narrated login, automatic business work, compound action and human corrections remain tasks", () => {
  for (const patch of [{ actor: "利用者", executionMode: "manual" as const },
    { executingSystem: "VPN", executionMode: "automatic" as const },
    { humanEdits: [{ field: "action", before: "仕様", after: "利用者がログインする", evidence: "利用者が補足" }] }]) {
    const r = { ...review([step("1", statement, patch)]), systemDependencies: [dep()] };
    assert.equal(separateDependencyDescriptions(r, statement).steps.length, 1);
  }
  for (const quote of ["利用者がVPNにログインしてEntra IDで認証します。", `${statement}情報システム担当がテストを確認します。`,
    "VPNはEntra IDの認証を使いますが、担当が結果を確認します。", "VPNはEntra IDの認証を使い、担当へ結果を送ります。", "VPNはログイン時にEntra IDの認証を使うか未確認です。"]) {
    assert.equal(separateDependencyDescriptions({ ...review([step("1", quote)]), systemDependencies: [dep()] }, quote).steps.length, 1, quote);
  }
  const source = "利用者がVPNにログインしてEntra IDで認証します。";
  const actual = review([step("1", source, { actor: "利用者", executionMode: "manual" })]);
  assert.equal(separateDependencyDescriptions(supplementSourceDependencies(actual, source, ["VPN", "Entra ID"]), source).steps.length, 1);
});

test("source guards run before human corrections are restored during rereading", () => {
  const fresh = { ...fixture(), systemDependencies: [dep()] }, source = fresh.steps.map(s => s.evidence).join("");
  const previous = { ...fresh, steps: fresh.steps.map(s => s.stepKey !== "2" ? s : { ...s,
    humanEdits: [{ field: "action", before: s.action, after: "利用者がログインする", evidence: "本人の補足" }] }) };
  const result = preserveRefinements(separateDependencyDescriptions(fresh, source), previous);
  assert(result.steps.some(s => s.stepKey === "2" && s.humanEdits!.length));
});

test("registering people and existing identifiers uses values and keeps the result without inventing a record", () => {
  for (const names of [["機器番号", "利用者"], ["VPN利用者"], ["社員コード", "担当者"]]) {
    const source = `情報システム担当が端末管理システムへ${names.join("と")}を登録します。`;
    const r = review([step("1", source, { actor: "情報システム担当", executionMode: "manual", data: names.map(name => ({ name, operation: "create", evidence: source })),
      meaning: { purpose: "", basis: "", result: `${names.join("と")}を登録する`, next: "", condition: "", halt: false, evidence: source, certainty: "confirmed" } })]);
    const result = distinguishRegistrationInputs(r, source);
    assert.deepEqual(result.steps[0].data.map(d => d.operation), names.map(() => "read"));
    assert.deepEqual(result.steps[0].data.map(d => d.name), names);
    assert.equal(result.steps[0].meaning!.result, r.steps[0].meaning!.result);
    assert.equal(result.steps[0].certainty, "inferred");
    assert.equal(result.steps[0].evidence, source);
    assert.equal(r.steps[0].data[0].operation, "create");
  }
});

test("stated generation, real registration records, unmatched evidence and human data changes stay authoritative", () => {
  for (const [name, source] of [["機器番号", "端末管理システムが機器番号を採番して登録します。"],
    ["社員コード", "担当が社員コードを生成して登録します。"], ["VPN利用者", "担当がVPN利用者のアカウントを作成して登録します。"],
    ["登録記録", "担当が登録記録を入力します。"], ["機器番号", "担当が機器番号を確認します。"]]) {
    const r = review([step("1", source, { data: [{ name, operation: "create", evidence: source }] })]);
    assert.equal(distinguishRegistrationInputs(r, source).steps[0].data[0].operation, "create", source);
  }
  const source = "担当が機器番号を登録します。";
  const r = review([step("1", source, { data: [{ name: "機器番号", operation: "create", evidence: source }] })]);
  assert.equal(distinguishRegistrationInputs(r, "機器番号は未確認です。").steps[0].data[0].operation, "create");
  const edited = { ...r, steps: r.steps.map(s => ({ ...s, humanEdits: [{ field: "data", before: [], after: s.data, evidence: "手動の訂正" }] })) };
  assert.equal(distinguishRegistrationInputs(edited, source).steps[0].data[0].operation, "create");
  const restored = preserveRefinements(distinguishRegistrationInputs(r, source), edited);
  assert.equal(restored.steps[0].data[0].operation, "create");
  const short = { ...r, steps: r.steps.map(s => ({ ...s, data: [{ ...s.data[0], evidence: "機器番号を登録" }] })) };
  assert.equal(distinguishRegistrationInputs(short, source).steps[0].data[0].operation, "read");
  for (const ending of ["する予定です。", "するか未確認です。", "しません。", "する前に採番します。"]) {
    assert.equal(distinguishRegistrationInputs(short, `担当が機器番号を登録${ending}`).steps[0].data[0].operation, "create", ending);
  }
});

test("a record name implied by registration is a reviewable inference rather than a literal source fact", () => {
  const source = "情報システム担当が端末管理システムへ機器番号と利用者を登録します。";
  const r = review([step("1", source, { data: [{ name: "端末の機器番号・利用者登録情報", operation: "update", evidence: source }] })]);
  const result = distinguishRegistrationInputs(r, source);
  assert.equal(result.steps[0].certainty, "inferred");
  assert.equal(result.steps[0].data[0].operation, "update");
  assert.equal(result.steps[0].evidence, source);
  assert(result.warnings[0].includes("推定"));
  const explicit = "担当が端末登録情報を更新して機器番号を入力します。";
  assert.equal(distinguishRegistrationInputs(review([step("1", explicit, { data: [{ name: "端末登録情報", operation: "update", evidence: explicit }] })]), explicit).steps[0].certainty, "explicit");
});
