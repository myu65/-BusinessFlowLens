import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DataFlowExplorer } from "../components/DataFlowExplorer";
import { createChemicalCompany } from "../lib/chemical-company";
import { aggregateDataFlows, scopedDataFlows } from "../lib/knowledge";

const graph = createChemicalCompany();
function render(initialWorkflowId: string) {
  return renderToStaticMarkup(createElement(DataFlowExplorer, {
    graph, initialWorkflowId,
    onGraphApply: () => {}, onEdit: () => {}, onSelectWorkflow: () => {},
  }));
}

test("entering data flows from a new memo shows the current company paths rather than an empty nonexistent workflow", () => {
  const html = render("__new_memo__");
  const flows = scopedDataFlows(graph, "current");
  assert.ok(html.includes(`${aggregateDataFlows(flows).length}経路 / ${flows.length}受渡し`));
  assert.match(html, /value="" selected=""/);
  assert.doesNotMatch(html, /この業務の手順はまだ登録されていません/);
  const paths = html.match(/<div class="flow-paths">([\s\S]*?)<\/div>/)![1];
  assert.equal((paths.match(/<button /g) ?? []).length, 8);
});

test("entering with an existing future workflow preserves its scope and selected work", () => {
  const workflow = graph.workflows.find(w => w.scenario === "future")!;
  const html = render(workflow.id);
  assert.ok(html.includes(`value="${workflow.id}" selected=""`));
  assert.match(html, /value="future" selected=""/);
  assert.doesNotMatch(html, /システム間の経路を、業務へつないで読む/);
  assert.ok(html.includes(workflow.name));
});
