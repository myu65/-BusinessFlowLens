import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanyOrientation } from "../components/CompanyOrientation";
import { createChemicalCompany } from "../lib/chemical-company";
import { knowledgeIndex } from "../lib/knowledge";
import type { LensGraph } from "../lib/graph";

function render(graph: LensGraph, ids: string[]) {
  const rows = knowledgeIndex(graph, "current").rows.filter((r) =>
    ids.includes(r.workflow.id),
  );
  return renderToStaticMarkup(
    createElement(CompanyOrientation, {
      graph,
      scope: "current",
      workflowIds: ids,
      rows,
      onWorkflow: () => {},
      onSystems: () => {},
      onActivity: () => {},
      onSystem: () => {},
      onInput: () => {},
    }),
  );
}

test("a saved story is visible with its actual people, tools and information before activities are classified", () => {
  const graph = { ...createChemicalCompany(), knowledge: undefined };
  const id = graph.workflows[0].id;
  const row = knowledgeIndex(graph, "current").rows.find(
    (r) => r.workflow.id === id,
  )!;
  const html = render(graph, [id]);
  assert.match(html, /保存した仕事のつながり/);
  assert.ok(html.includes(row.workflow.name));
  assert.ok(html.includes(row.processes.find((p) => p.actor)!.actor!));
  assert.ok(html.includes(row.assets.find((n) => n.kind === "system")!.label));
  assert.ok(html.includes(row.assets.find((n) => n.kind === "data")!.label));
  assert.doesNotMatch(html, /まだ、会社の話が入っていません/);
});

test("an empty filtered view explains the filter instead of suggesting saved work is absent", () => {
  const graph = createChemicalCompany();
  const html = render(graph, []);
  assert.match(html, /この条件に合う仕事がありません/);
  assert.doesNotMatch(html, /まだ、会社の話が入っていません/);
});
