import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOverview } from "../lib/overview";
import type { LensGraph, LensNode } from "../lib/graph";

const node = (id: string, kind: LensNode["kind"], workflowId?: string): LensNode => ({ id, kind, workflowId, canonicalKey: id, label: id, description: "", status: "confirmed" });
function fixture(): LensGraph {
  return { workflows: [{ id: "current", name: "現状" }, { id: "future", name: "将来", scenario: "future" }, { id: "second", name: "別業務" }], nodes: [node("p1", "process", "current"), node("p2", "process", "future"), node("p3", "process", "second"), node("order", "data"), node("sap", "system"), node("crm", "system")], edges: [
    { id: "read", source: "p1", target: "order", relation: "reads", workflowIds: ["current"] },
    { id: "write", source: "p2", target: "order", relation: "writes", workflowIds: ["future"] },
    { id: "use", source: "p1", target: "sap", relation: "uses", workflowIds: ["current"] },
  ], dataFlows: [] };
}
test("現状に将来案の利用を混ぜず、未指定のシナリオは現状とする", () => {
  const view = buildOverview(fixture(), "current");
  assert.equal(view.workflows.length, 2);
  assert.deepEqual(view.data[0].workflows.map(w => w.id), ["current"]);
  assert.equal(view.data[0].usages[0].relation, "reads");
  assert.equal(buildOverview(fixture(), "future").data[0].usages[0].relation, "writes");
});
test("同時利用したシステムをデータの管理先として推定しない", () => {
  assert.deepEqual(buildOverview(fixture(), "current").data[0].systems, []);
});
test("受け渡しだけで関わる業務も共通データの接点に含む", () => {
  const graph = fixture();
  graph.dataFlows.push({ id: "flow", sourceSystemId: "sap", targetSystemId: "crm", dataIds: ["order"], transferType: "unknown", direction: "unknown", automation: "unknown", status: "unknown", workflowIds: ["second"], processIds: [] });
  const row = buildOverview(graph, "current").data[0];
  assert.equal(row.workflows.length, 2);
  assert.deepEqual(row.systems.map(s => s.id), ["sap", "crm"]);
  assert.equal(row.transfers[0].direction, "unknown");
  assert.equal(buildOverview(graph, "future").flows.length, 0);
});
test("不正な順序線や別シナリオの直接関連を根拠にしない", () => {
  const graph = fixture();
  graph.edges.push({ id: "bad", source: "p3", target: "order", relation: "next", workflowIds: ["second"] }, { id: "direct", source: "order", target: "crm", relation: "writes", workflowIds: ["future"] });
  assert.equal(buildOverview(graph, "current").data[0].workflows.length, 1);
  assert.equal(buildOverview(graph, "current").data[0].systems.length, 0);
  assert.equal(buildOverview(graph, "future").data[0].systems[0].id, "crm");
});
test("全案は比較として表示し、空の対象と入力グラフを保持する", () => {
  const graph = fixture(); const before = JSON.stringify(graph);
  assert.equal(buildOverview(graph, "all").data[0].workflows.length, 2);
  assert.equal(buildOverview(graph, "alternative").data.length, 0);
  assert.equal(JSON.stringify(graph), before);
});
test("システムとデータの直接関連だけでも対象業務の接点を表示する", () => {
  const graph = fixture();
  graph.edges = [{ id: "direct", source: "sap", target: "order", relation: "writes", workflowIds: ["current"] }];
  const row = buildOverview(graph, "current").data[0];
  assert.equal(row.workflows[0].id, "current");
  assert.equal(row.systems[0].id, "sap");
  assert.equal(row.usages.length, 0);
  assert.equal(row.direct.length, 1);
});
