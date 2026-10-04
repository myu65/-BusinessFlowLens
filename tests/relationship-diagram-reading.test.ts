import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LensGraph } from "../lib/graph";
import type { OverviewRelation } from "../lib/relationship-overview";
import { overviewWindow } from "../lib/relationship-overview";
import { overviewDiagramLayout, overviewEdgeGeometry, overviewRelationCaption } from "../lib/relationship-reading";
import { RelationshipDiagram } from "../components/RelationshipDiagram";

const nodes = [{ id: "customer", label: "顧客対応", subtitle: "2業務" }, { id: "price", label: "販売価格の設定", subtitle: "2業務" }];
const edge: OverviewRelation = { id: "original-relation", source: "customer", target: "price", kind: "handoff", certainty: "confirmed", references: [{
  id: "original-reference", kind: "handoff", source: "w1", target: "w2", workflowIds: ["w1", "w2"], processIds: ["p1", "p2"],
  dataIds: ["request"], via: "reference", evidence: "相談番号をCRMで参照する", description: "相談番号の参照", certainty: "confirmed",
}] };

test("group arrows show recorded information and reference semantics without turning a reference into a handoff or changing evidence", () => {
  const before = JSON.stringify(edge), caption = overviewRelationCaption(edge, new Map([["request", "相談番号"]]));
  assert.equal(caption.text, "参照 相談番号"); assert.equal(caption.type, "情報の参照");
  const graph: LensGraph = { nodes: [{ id: "request", label: "相談番号", canonicalKey: "request", kind: "data", status: "confirmed", description: "" }], workflows: [], edges: [], dataFlows: [] };
  const html = renderToStaticMarkup(createElement(RelationshipDiagram, { nodes, edges: [edge], graph, label: "図", onNode: () => {}, onEdge: () => {} }));
  assert.match(html, /参照 相談番号/); assert.match(html, /顧客対応 → 販売価格の設定・情報の参照・相談番号・1件・確認済み・根拠を見る/);
  assert.doesNotMatch(html, /受渡し 1|仕事の受渡し/);
  assert.equal(JSON.stringify(edge), before);
});

test("partial captions remain bounded, preserve separate data identities and never expose an unnamed data ID as a name", () => {
  const copy = { ...edge, references: [{ ...edge.references[0], dataIds: ["request", "private-id", "same-label-id"] }] };
  const caption = overviewRelationCaption(copy, new Map([["request", "とても長い顧客相談の識別番号"], ["same-label-id", "とても長い顧客相談の識別番号"]]));
  assert.ok([...caption.text].length <= 11); assert.match(caption.text, /…ほか$/);
  assert.match(caption.information, /ほか1情報/); assert.match(caption.information, /情報名が未登録/); assert.doesNotMatch(caption.information, /private-id/);
  const missing = overviewRelationCaption(copy, new Map());
  assert.equal(missing.text, "参照 1件"); assert.equal(missing.information, "情報名は未登録");
  const mixed = { ...edge, references: [...edge.references, { ...edge.references[0], via: "handoff" as const }] };
  assert.equal(overviewRelationCaption(mixed, new Map([["request", "相談番号"]])).type, "受渡し・参照");
  const dependency = overviewRelationCaption({ ...edge, kind: "dependency" }, new Map([["request", "相談番号"]]));
  assert.equal(dependency.text, "稼働に必要"); assert.equal(dependency.type, "稼働の依存"); assert.equal(dependency.information, "");
});

test("qualified names use a shared recorded ending, so unrelated information does not all appear as the same product prefix", () => {
  const copy = { ...edge, references: [{ ...edge.references[0], dataIds: ["resin-forecast", "solvent-forecast"] }] };
  const names = new Map([["resin-forecast", "機能性樹脂 販売予測策定記録"], ["solvent-forecast", "工業用溶剤 販売予測策定記録"]]);
  const before = JSON.stringify(copy), caption = overviewRelationCaption(copy, names);
  assert.match(caption.text, /販売予測/); assert.match(caption.text, /ほか$/); assert.ok([...caption.text].length <= 11);
  assert.equal(caption.information, "機能性樹脂 販売予測策定記録 / 工業用溶剤 販売予測策定記録");
  names.set("solvent-forecast", "工業用溶剤 顧客仕様確認記録");
  assert.doesNotMatch(overviewRelationCaption(copy, names).text, /販売予測/);
  names.delete("solvent-forecast");
  assert.doesNotMatch(overviewRelationCaption(copy, names).text, /販売予測/);
  assert.equal(JSON.stringify(copy), before);
  const mixed = { ...edge, references: [{ ...edge.references[0], dataIds: ["resin-forecast", "solvent-forecast", "order"] }] };
  const varied = new Map([["resin-forecast", "機能性樹脂 販売予測策定記録"], ["solvent-forecast", "工業用溶剤 販売予測策定記録"], ["order", "受注登録記録"]]);
  const example = overviewRelationCaption(mixed, varied);
  assert.match(example.text, /販売予測.*ほか/); assert.match(example.information, /ほか1情報/);
});

test("a small graph uses half the old height while preserving direction, both endpoints and room for node labels", () => {
  const layout = overviewDiagramLayout(nodes, [edge], "price");
  assert.equal(layout.height, 180); assert.ok(layout.width < 920);
  assert.ok(layout.positions.get("customer")!.x < layout.positions.get("price")!.x);
  for (const p of layout.positions.values()) {
    assert.ok(p.x >= 110 && p.x <= layout.width - 110); assert.ok(p.y >= 55 && p.y <= layout.height - 55);
  }
  assert.equal(overviewDiagramLayout([], []).positions.size, 0);
  assert.equal(overviewDiagramLayout(nodes.slice(0, 1), []).height, 180);
});

test("crossing dependencies keep their distinct captions on their original curves and out of the group cards", () => {
  const positions = new Map([["collaboration", { x: 130, y: 189 }], ["infrastructure", { x: 460, y: 189 }],
    ["local-tool", { x: 460, y: 314 }], ["unclassified", { x: 130, y: 64 }]]);
  const relations: OverviewRelation[] = [{ ...edge, id: "identity", kind: "dependency", source: "collaboration", target: "infrastructure" },
    { ...edge, id: "connection", kind: "dependency", source: "local-tool", target: "unclassified" }];
  const before = JSON.stringify(relations), geometry = overviewEdgeGeometry(positions, relations, new Map());
  const first = geometry.get("identity")!, crossing = geometry.get("connection")!;
  assert.ok(Math.abs(first.lx - crossing.lx) >= (first.labelWidth + crossing.labelWidth) / 2 || Math.abs(first.ly - crossing.ly) >= 22);
  for (const caption of geometry.values()) for (const p of positions.values()) {
    assert.ok(Math.abs(caption.lx - p.x) >= caption.labelWidth / 2 + 97 || Math.abs(caption.ly - p.y) >= 83);
  }
  assert.notEqual(crossing.ly, first.ly); assert.equal(first.caption.type, "稼働の依存");
  assert.equal(JSON.stringify(relations), before);
});

test("changing relation pages preserves cropped dimensions and node positions in a dense 300-group structure", () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ id: `n${i}`, label: `まとまり${i}`, subtitle: "" }));
  const relations: OverviewRelation[] = many.slice(0, 8).flatMap(s => many.slice(0, 8).filter(t => t.id !== s.id).map(t => ({ ...edge, id: `${s.id}:${t.id}`, source: s.id, target: t.id })));
  const first = overviewWindow(many, relations, "", 0, 8, { relationLimit: 6 });
  const layout = overviewDiagramLayout(first.nodes, first.layoutEdges);
  for (const p of layout.positions.values()) assert.ok(p.y >= 64 && p.y <= layout.height - 64, "leave space for a tool group's wrapping note");
  for (let page = 0; page <= first.lastRelationPage; page++) {
    const current = overviewWindow(many, relations, "", 0, 8, { relationLimit: 6, relationPage: page });
    assert.deepEqual(overviewDiagramLayout(current.nodes, current.layoutEdges), layout);
    const html = renderToStaticMarkup(createElement(RelationshipDiagram, { nodes: current.nodes, edges: current.edges, layoutEdges: current.layoutEdges, label: "図", onNode: () => {}, onEdge: () => {} }));
    assert.equal((html.match(/class="relationship-node/g) ?? []).length, 8);
    assert.ok((html.match(/role="button"/g) ?? []).length <= 6);
  }
});
