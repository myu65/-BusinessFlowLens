import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildOverview } from "../lib/overview";
import { overviewDataWindow, readingPage, OVERVIEW_DATA_PAGE, OVERVIEW_WORKFLOW_PAGE } from "../lib/overview-reading";
import { OverviewDataMatrix } from "../components/OverviewDataMatrix";
import type { LensGraph, LensNode } from "../lib/graph";

const node = (id: string, kind: LensNode["kind"], workflowId?: string): LensNode => ({ id, kind, workflowId, canonicalKey: id, label: id, description: "", status: "confirmed" });
function fixture(count = 300): LensGraph {
  const workflows = Array.from({ length: count }, (_, i) => ({ id: `w${i}`, name: `業務 ${i}` }));
  return { workflows, nodes: [node("共通情報", "data"), node("SAP", "system"), node("Excel", "system"),
    ...workflows.flatMap(w => [node(`p${w.id}`, "process", w.id), node(`d${w.id}`, "data")])],
    edges: workflows.flatMap(w => [
      { id: `common:${w.id}`, source: `p${w.id}`, target: "共通情報", relation: "reads" as const, workflowIds: [w.id] },
      { id: `individual:${w.id}`, source: `p${w.id}`, target: `d${w.id}`, relation: "writes" as const, workflowIds: [w.id] },
    ]), dataFlows: workflows.map(w => ({ id: `f${w.id}`, sourceSystemId: "SAP", targetSystemId: "Excel", dataIds: ["共通情報"],
      transferType: "manual", direction: "push", automation: "manual", status: "confirmed", workflowIds: [w.id], processIds: [] })) };
}

test("300 workflows render at most 12 columns and 20 data rows, preserving full totals and recorded roles", () => {
  const graph = fixture(), before = JSON.stringify(graph), view = buildOverview(graph, "current");
  const html = renderToStaticMarkup(createElement(OverviewDataMatrix, { graph, view, onOpen: () => {} }));
  const table = html.match(/<table[\s\S]*?<\/table>/)?.[0] ?? "";
  assert.equal((table.match(/<td\b/g) ?? []).length, OVERVIEW_DATA_PAGE * OVERVIEW_WORKFLOW_PAGE);
  assert.equal((table.match(/scope="col"/g) ?? []).length, 13);
  assert.equal((table.match(/scope="row"/g) ?? []).length, 20);
  assert.match(table, /参照 \/ 受け渡し/);
  assert.match(html, /業務 <b>300<\/b>/);
  assert.match(html, /個別データ <b>300<\/b>/);
  assert.match(html, /記録済み受け渡し <b>300<\/b>/);
  assert.equal(JSON.stringify(graph), before);
});

test("all workflows and information remain reachable, searches only change the display window, and empty or stale pages clamp", () => {
  const view = buildOverview(fixture(301), "current"), before = JSON.stringify(view);
  const workflows = new Set<string>(), data = new Set<string>();
  for (let page = 0; page < 26; page++) {
    const window = overviewDataWindow(view, page, page);
    window.workflows.items.forEach(w => workflows.add(w.id));
    window.data.items.forEach(d => data.add(d.asset.id));
    assert.ok(window.workflows.items.length <= 12 && window.data.items.length <= 20);
  }
  assert.equal(workflows.size, 301); assert.equal(data.size, 302);
  const filtered = overviewDataWindow(view, 99, 99, " 業務 300 ", "DW300");
  assert.deepEqual(filtered.workflows.items.map(w => w.id), ["w300"]);
  assert.deepEqual(filtered.data.items.map(d => d.asset.id), ["dw300"]);
  assert.equal(filtered.workflows.page, 0);
  const empty = overviewDataWindow(view, -1, NaN, "該当なし", "該当なし");
  assert.equal(empty.data.start, 0); assert.equal(empty.data.end, 0); assert.equal(empty.workflows.last, 0);
  assert.equal(JSON.stringify(view), before);
});

test("a data selected from another reading view opens its page, with bounded evidence and links while keeping the full row", () => {
  const graph = fixture(), view = buildOverview(graph, "current");
  const html = renderToStaticMarkup(createElement(OverviewDataMatrix, { graph, view, initialSelectedId: "共通情報", onOpen: () => {} }));
  const focus = html.match(/<aside[\s\S]*?<\/aside>/)?.[0] ?? "";
  assert.equal((focus.match(/<li\b/g) ?? []).length, 8);
  assert.equal((focus.match(/の手順へ/g) ?? []).length, 6);
  assert.match(focus, /1–8 \/ 600根拠/);
  assert.match(focus, /1–6 \/ 300関連業務/);
  assert.equal(view.data[0].usages.length, 300);
  assert.equal(view.data[0].transfers.length, 300);
  const row = view.data[47];
  const selected = renderToStaticMarkup(createElement(OverviewDataMatrix, { graph, view, initialSelectedId: row.asset.id, onOpen: () => {} }));
  assert.match(selected, /41–60 \/ 301情報/);
  assert.match(selected, new RegExp(`aria-pressed="true">${row.asset.label}`));
});

test("evidence, relation and workflow windows keep every item, including the last partial page", () => {
  const items = Array.from({ length: 301 }, (_, i) => i);
  for (const size of [6, 8, 12, 20]) {
    const read: number[] = [];
    for (let p = 0; p <= readingPage(items, 0, size).last; p++) read.push(...readingPage(items, p, size).items);
    assert.deepEqual(read, items);
    assert.equal(readingPage(items, Infinity, size).page, 0);
    assert.equal(readingPage(items, 999, size).end, 301);
  }
});
