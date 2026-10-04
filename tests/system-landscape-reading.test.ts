import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SystemLandscapeCards } from "../components/SystemLandscapeCards";
import { createChemicalCompany } from "../lib/chemical-company";
import { knowledgeIndex } from "../lib/knowledge";
import type { LensGraph } from "../lib/graph";

function render(graph: LensGraph, page = 0, scope: "current" | "future" = "current", query = "") {
  const view = knowledgeIndex(graph, scope, query);
  const systems = graph.nodes.filter(n => n.kind === "system" && (!query || n.label.includes(query)));
  return renderToStaticMarkup(createElement(SystemLandscapeCards, {
    graph, systems, view, page, onPage: () => {}, onSelect: () => {},
  }));
}

test("a company landscape is limited to six cards and every registered tool remains reachable", () => {
  const graph = createChemicalCompany();
  const tools = graph.nodes.filter(n => n.kind === "system");
  const names: string[] = [];
  for (let page = 0; page < Math.ceil(tools.length / 6); page++) {
    const html = render(graph, page);
    const shown = [...html.matchAll(/<strong>(.*?)<\/strong>/g)].map(m => m[1]);
    assert.ok(shown.length > 0 && shown.length <= 6);
    names.push(...shown);
  }
  assert.deepEqual(new Set(names), new Set(tools.map(n => n.label)));
  assert.equal(names.length, tools.length);
  const filtered = render(graph, 8, "current", "Snowflake");
  assert.match(filtered, /1道具 \/ 1–1を表示/);
  assert.match(filtered, /<strong>Snowflake DWH<\/strong>/);
  assert.doesNotMatch(filtered, /<strong>Microsoft Teams<\/strong>/);
});

test("widely used tools appear before an unused tool and counts keep direct and platform impact separate", () => {
  const graph = createChemicalCompany();
  const unused = { ...graph.nodes.find(n => n.kind === "system")!, id: "unused", label: "利用未確認の道具", status: "unknown" as const };
  graph.nodes.unshift(unused);
  const html = render(graph);
  assert.match(html, /<strong>Outlook \/ Mail \/ Calendar<\/strong>/);
  assert.doesNotMatch(html, /<strong>利用未確認の道具<\/strong>/);
  assert.match(html, /直接 300業務/);
  assert.match(html, /直接 10業務 · 間接 290業務/);
  assert.match(html, /直接・間接の業務数は、何を数えている/);
  assert.match(render(graph, 0, "current", "利用未確認の道具"), /同じ道具か、対応づけは要確認/);
});

test("a profile drawn from one input is a use example and its current-only purpose does not describe the future", () => {
  const graph = createChemicalCompany();
  const profile = graph.knowledge!.systems.find(s => s.systemId === "system:snowflake")!;
  profile.sourceWorkflowId = graph.workflows.find(w => w.scenario === "current")!.id;
  profile.purpose = "現在の一つの話だけで確認した役割";
  const current = render(graph, 0, "current", "Snowflake");
  assert.match(current, /現在の一つの話だけで確認した役割/);
  assert.match(current, /入力で分かった使い方の一例/);
  assert.doesNotMatch(render(graph, 0, "future", "Snowflake"), /現在の一つの話だけで確認した役割/);
});
