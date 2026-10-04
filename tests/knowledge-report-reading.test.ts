import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { knowledgeIndex, knowledgeReport, knowledgeReportDocument, knowledgeReportText } from "../lib/knowledge";
import { createChemicalCompany } from "../lib/chemical-company";
import type { LensGraph } from "../lib/graph";
import { KnowledgeReportPreview } from "../components/KnowledgeReportPreview";

const source = '営業担当がTeamsの「受付記録」をQMSへ転記する。\n画面には「manual」と表示された。';
const graph: LensGraph = {
  workflows: [{ id: "receive", name: "受付を登録する", scenario: "current" },
    { id: "future", name: "将来の別業務", scenario: "future" }],
  nodes: [
    { id: "transfer", canonicalKey: "process:receive:transfer", workflowId: "receive", kind: "process",
      label: "受付を転記する", description: "", action: "Teamsの受付をQMSへ転記する", status: "confirmed",
      stepOrder: 1, executionMode: "manual", actor: "営業担当", department: "", evidence: source,
      meaning: { purpose: "", basis: "受付記録", result: "案件が登録される", next: "", condition: "", halt: false,
        certainty: "inferred", evidence: "結果は入力された話からの推定" },
      humanEdits: [{ field: "actor", before: "担当", after: "営業担当", evidence: "現場で補足" }] },
    { id: "teams", canonicalKey: "system:teams", kind: "system", label: "Teams", description: "", status: "confirmed" },
    { id: "qms", canonicalKey: "system:qms", kind: "system", label: "QMS", description: "", status: "confirmed" },
    { id: "receipt", canonicalKey: "data:receipt", kind: "data", label: "受付記録", description: "", status: "confirmed" },
  ],
  edges: [
    { id: "read", source: "receipt", target: "transfer", relation: "reads", workflowIds: ["receive"] },
    { id: "use", source: "transfer", target: "qms", relation: "uses", workflowIds: ["receive"] },
  ],
  dataFlows: [{ id: "flow", sourceSystemId: "teams", targetSystemId: "qms", dataIds: ["receipt"], transferType: "manual",
    direction: "push", automation: "manual", status: "inferred", workflowIds: ["receive"], processIds: ["transfer"], evidence: "TeamsからQMSへ転記する" }],
};

test("a report describes actors separately from unknown departments and retains sources, inference and human corrections", () => {
  const before = JSON.stringify(graph), document = knowledgeReportDocument(graph, "current", "", "");
  assert.deepEqual(document.counts, { workflows: 1, steps: 1, tools: 2, data: 1 });
  const text = knowledgeReportText(document);
  assert.ok(text.includes("対象: 現在の仕事"));
  assert.ok(text.includes("部署: 未確認"));
  assert.ok(text.includes("担当: 営業担当"));
  assert.ok(text.includes("担当・実行主体: 営業担当 / 人が行う"));
  assert.ok(text.includes("手順の確かさ: 確認済み / 処理結果の確かさ: 推定"));
  assert.ok(text.includes("- 人の訂正: 担当する人：担当 → 営業担当 / 根拠: 現場で補足"));
  assert.ok(text.includes(source.split("\n").map(line => `> ${line}`).join("\n")), "raw English in a source must be preserved");
  assert.ok(text.includes("結果は入力された話からの推定"));
  assert.ok(!text.includes("(manual)") && !text.includes("確度: inferred"));
  assert.ok(!text.includes("## 将来の別業務"));
  assert.equal(JSON.stringify(graph), before);
});

test("report scope retains explicit empty selections rather than silently exporting every workflow", () => {
  const doc = knowledgeReportDocument(graph, "current", "", "", []);
  assert.equal(doc.counts.workflows, 0);
  assert.deepEqual(doc.workflows, []);
  assert.ok(knowledgeReportText(doc).includes("業務数: 0"));
  const filtered = knowledgeReportDocument(graph, "current", "一致しない名前", "");
  assert.equal(filtered.counts.workflows, 0);
});

test("report tool counts include the platforms supporting selected work and exclude an unrelated workflow", () => {
  const supported = structuredClone(graph);
  supported.nodes.push(...["cloud", "identity", "future-only"].map(id => ({ id, canonicalKey: `system:${id}`,
    kind: "system" as const, label: id, description: "", status: "confirmed" as const })));
  supported.nodes.push({ id: "future-step", canonicalKey: "process:future:only", workflowId: "future", kind: "process",
    label: "別の案の仕事", description: "", status: "confirmed" });
  supported.edges.push({ id: "future-use", source: "future-step", target: "future-only", relation: "uses", workflowIds: ["future"] });
  supported.knowledge = { name: "会社", description: "", activities: [], categories: [], criticalWorkflows: [], systems: [
    { systemId: "qms", categoryId: "", owner: "", purpose: "", dependsOn: [{ systemId: "cloud", reason: "実行環境" }] },
    { systemId: "cloud", categoryId: "", owner: "", purpose: "", dependsOn: [{ systemId: "identity", reason: "認証" }] },
  ] };
  const current = knowledgeReportDocument(supported, "current", "", "", ["receive"]);
  assert.equal(current.counts.tools, 4, "two directly used tools plus cloud and its identity dependency");
  assert.ok(current.introduction.some(line => line.includes("稼働を支える登録済みの基盤依存")));
  assert.equal(knowledgeReportDocument(supported, "future", "", "").counts.tools, 1);
  assert.equal(knowledgeReportDocument(supported, "current", "", "", []).counts.tools, 0);
});

test("a system report uses the selected workflows for direct, step and transfer counts", () => {
  const sample = createChemicalCompany(), snow = sample.nodes.find(n => n.label === "Snowflake DWH")!;
  const impact = knowledgeIndex(sample, "current").systemProfile(snow.id);
  const onlyFlow = impact.flowUse.find(r => !impact.stepUse.some(s => s.workflow.id === r.workflow.id))!;
  const doc = knowledgeReportDocument(sample, "current", "", "", [onlyFlow.workflow.id], snow.id);
  assert.equal(doc.counts.workflows, 1);
  assert.ok(doc.context[0].body.includes("直接関連: 1業務 / 基盤依存を介した間接影響: 0業務"));
  assert.ok(doc.context[0].body.some(line => line.includes("手順で使う0業務 / 受渡しで関わる1業務")));
  assert.ok(doc.context[0].body.some(line => line.includes("件数と受渡しは出力した業務の範囲")));
});

test("a 300-workflow preview keeps all report content but initially renders six titles and no detailed body", () => {
  const doc = knowledgeReportDocument(createChemicalCompany(), "current", "", "");
  const text = knowledgeReportText(doc);
  assert.equal(doc.workflows.length, 300);
  assert.equal((text.match(/^## /gm) ?? []).length, 300);
  const html = renderToStaticMarkup(createElement(KnowledgeReportPreview, { document: doc, text, url: "/api/report", onClose: () => {} }));
  assert.equal((html.match(/<summary>/g) ?? []).length, 7);
  assert.ok(html.includes("次の6業務"));
  assert.ok(!html.includes("レポート本文"), "the large raw text is opened on demand");
  assert.ok(html.length < 20000, "the preview DOM is bounded independently of report length");
  assert.equal(knowledgeReport(createChemicalCompany(), "current", "", "").split("\n").filter(l => l.startsWith("## ")).length, 300);
});
