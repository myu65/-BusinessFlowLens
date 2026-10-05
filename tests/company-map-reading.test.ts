import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createChemicalCompany } from "../lib/chemical-company";
import { knowledgeIndex } from "../lib/knowledge";
import { activityRelationships } from "../lib/relationship-overview";
import { CompanyOrientation } from "../components/CompanyOrientation";

test("company orientation restores the chosen activity and relation without changing the source; its drill button precedes the diagram", () => {
  const graph = createChemicalCompany(), before = JSON.stringify(graph), view = knowledgeIndex(graph, "current");
  const workflowIds = view.rows.map(r => r.workflow.id), relation = activityRelationships(graph, workflowIds)[0];
  const html = renderToStaticMarkup(createElement(CompanyOrientation, {
    graph, scope: "current", workflowIds, rows: view.rows,
    onWorkflow: () => {}, onSystems: () => {}, onActivity: () => {}, onSystem: () => {},
    position: { activityId: relation.source, relationId: relation.id, page: 0, relationPage: 0 },
  }));
  assert.match(html, /aria-label="選んだ活動と前後の仕事"/);
  assert.match(html, /関係の根拠/);
  assert.equal((html.match(/この活動の仕事を見る/g) ?? []).length, 1);
  assert.ok(html.indexOf("この活動の仕事を見る") < html.indexOf('aria-label="活動の関係図"'));
  assert.equal((html.match(/システム・道具から調べる/g) ?? []).length, 1);
  assert.ok(html.indexOf("システム・道具から調べる") < html.indexOf('aria-label="活動の関係図"'));
  assert.equal(JSON.stringify(graph), before);

  const other = view.rows.filter(r => !r.capabilities.some(c => c.activity.id === relation.source));
  const narrowed = renderToStaticMarkup(createElement(CompanyOrientation, {
    graph, scope: "current", workflowIds: other.map(r => r.workflow.id), rows: other,
    onWorkflow: () => {}, onSystems: () => {}, onActivity: () => {}, onSystem: () => {},
    position: { activityId: relation.source, relationId: relation.id, page: 0, relationPage: 0 },
  }));
  assert.doesNotMatch(narrowed, /aria-label="選んだ活動と前後の仕事"|この活動の仕事を見る/);
});
