import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LensGraph } from "../lib/graph";
import { termExplanations } from "../lib/knowledge-guide";
import { knowledgeReport } from "../lib/knowledge";
import { exploreSavedStory } from "../lib/exploration";
import { WorkflowReading } from "../components/WorkflowReading";
import { KnowledgeExplorer } from "../components/KnowledgeExplorer";

const graph: LensGraph = {
  workflows: [{ id: "publish", name: "配合版を公開する" }, { id: "plan", name: "製造指図を準備する" }],
  nodes: [
    { id: "reflect", canonicalKey: "process:publish:reflect", workflowId: "publish", kind: "process", stepOrder: 1,
      label: "PLMが承認済み配合版をSAPへ反映する", action: "承認済み配合版を反映する", description: "", status: "confirmed",
      executionMode: "automatic", evidence: "PLMが承認済み配合版をSAPへ反映する",
      meaning: { purpose: "", basis: "承認済み配合版", result: "SAPへ配合版が反映される", next: "", condition: "", halt: false,
        evidence: "PLMが承認済み配合版をSAPへ反映する", certainty: "confirmed" } },
    { id: "read", canonicalKey: "process:plan:read", workflowId: "plan", kind: "process", stepOrder: 1,
      label: "承認済み配合版を参照する", description: "", status: "confirmed" },
    { id: "recipe", canonicalKey: "data:recipe", kind: "data", label: "承認済み配合版", description: "", status: "confirmed" },
    { id: "plm", canonicalKey: "system:plm", kind: "system", label: "PLM", description: "", status: "confirmed" },
  ],
  edges: [{ id: "exec", source: "plm", target: "reflect", relation: "executes", workflowIds: ["publish"] },
    { id: "read-recipe", source: "recipe", target: "read", relation: "reads", workflowIds: ["plan"] }],
  dataFlows: [],
  knowledge: { name: "会社", description: "", activities: [], categories: [], systems: [], criticalWorkflows: [],
    handoffs: [{ id: "reference", sourceWorkflowId: "publish", targetWorkflowId: "plan", sourceProcessId: "reflect", targetProcessId: "read",
      dataIds: ["recipe"], description: "公開された承認済み配合版を参照する", kind: "information", via: "reference",
      evidence: "公開業務の承認済み配合版をPLMで参照する", status: "confirmed" }] },
};

function companyHtml(id: string, source = graph) {
  return renderToStaticMarkup(createElement(KnowledgeExplorer, { graph: source, projectId: "test", onGraphApply: () => {},
    onOpenWorkflow: () => {}, onWorkflowFocus: () => {}, exploration: exploreSavedStory(source, id) }));
}

test("an action containing several systems keeps its business result and puts named generic definitions in a separate disclosure", () => {
  const before = JSON.stringify(graph);
  const html = renderToStaticMarkup(createElement(WorkflowReading, { graph, workflowId: "publish", onDetail: () => {} }));
  assert.match(html, /<details class="kg-term"><summary>用語の補足<\/summary>/);
  assert.match(html, /<strong>SAP<\/strong>/);
  assert.match(html, /<strong>PLM<\/strong>/);
  assert.ok(html.includes("用語の一般的な説明です"));
  assert.ok(html.includes("SAPへ配合版が反映される"));
  assert.equal(termExplanations("Games Capitalと未知の道具").length, 0);
  assert.equal(JSON.stringify(graph), before);
});

test("company and report distinguish a reference from delivery, preserve its direction, and do not fill unknown relationship kinds", () => {
  const before = JSON.stringify(graph);
  assert.ok(companyHtml("publish").includes("この情報を参照する業務（情報の参照）"));
  assert.ok(companyHtml("plan").includes("情報をつくる業務（情報の参照）"));
  assert.ok(knowledgeReport(graph, "current", "", "", ["publish"]).includes("この情報を参照する業務: 製造指図を準備する"));
  const delivered = structuredClone(graph);
  delivered.knowledge!.handoffs![0].via = "handoff";
  assert.ok(companyHtml("publish", delivered).includes("受け取る業務（情報の受渡し）"));
  assert.ok(companyHtml("plan", delivered).includes("渡す業務（情報の受渡し）"));
  delete delivered.knowledge!.handoffs![0].via;
  assert.ok(companyHtml("publish", delivered).includes("関係する業務（情報の受渡し・参照）"));
  delivered.knowledge!.handoffs![0].kind = "material";
  assert.ok(companyHtml("publish", delivered).includes("受け取る業務（物の受渡し）"));
  assert.equal(JSON.stringify(graph), before);
});

test("tracing the same information exposes matching and non-matching alternatives with the held state", () => {
  const branched = structuredClone(graph);
  for (const [id, condition, halt] of [["accept", "照合が一致した場合", false], ["notify", "照合が不一致の場合", true]] as const) {
    branched.nodes.push({ id, canonicalKey: `process:publish:${id}`, workflowId: "publish", kind: "process",
      label: halt ? "取り込まず通知する" : "結果候補を保存する", stepOrder: halt ? 3 : 2, description: "", status: "confirmed",
      meaning: { purpose: "", basis: "", result: "", next: "", condition, halt, evidence: condition, certainty: "confirmed" } });
    branched.edges.push({ id: `read-${id}`, source: "recipe", target: id, relation: "reads", workflowIds: ["publish"] });
  }
  const before = JSON.stringify(branched);
  const html = renderToStaticMarkup(createElement(WorkflowReading, { graph: branched, workflowId: "publish",
    initialStepId: "reflect", initialDataId: "recipe", initialLens: "data", onDetail: () => {} }));
  const trace = html.slice(html.indexOf('<ol class="flow-data-trace">'), html.indexOf("</ol>") + 5);
  assert.ok(trace.includes("条件：照合が一致した場合"));
  assert.ok(trace.includes("条件：照合が不一致の場合"));
  assert.ok(trace.includes("停止・保留"));
  assert.equal(JSON.stringify(branched), before);
});
