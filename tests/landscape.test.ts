import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  branchWorkflowScenario,
  canonicalNodeId,
  replaceWorkflowGraph,
  type LensGraph,
  type LensNode,
} from "../lib/graph";
import {
  duplicateSiteWorkflow,
  emptyFilters,
  emptyLandscape,
  landscapeView,
  validateLandscape,
} from "../lib/landscape";
import { SqliteBusinessFlowRepository } from "../lib/storage/sqlite";
import { mergeAssets } from "../lib/refinement";
import { buildOverview } from "../lib/overview";

const node = (
  id: string,
  kind: LensNode["kind"],
  workflowId?: string,
): LensNode => ({
  id,
  kind,
  workflowId,
  canonicalKey: id,
  label: id,
  description: "",
  status: "unknown",
});
function fixture(): LensGraph {
  return {
    workflows: [
      {
        id: "design",
        name: "製品設計",
        landscape: {
          ...emptyLandscape(),
          domains: ["エンジニアリングチェーン", "研究開発"],
          site: "開発拠点",
          productId: "P100",
          productLabel: "製品A",
          perspective: "設計",
        },
      },
      {
        id: "a",
        name: "A工場検品",
        landscape: {
          ...emptyLandscape(),
          domains: ["サプライチェーン"],
          site: "A工場",
          productId: "P100",
          productLabel: "製品A",
          perspective: "製造",
          commonProcessId: "INSPECT",
          processRole: "site",
          variantNote: "バーコードで照合",
          materialHandoffs: [
            {
              id: "m",
              targetWorkflowId: "b",
              material: "加工部品",
              dataIds: [],
              dataContinuity: "unknown",
              evidence: "物だけ確認",
            },
          ],
        },
      },
      {
        id: "b",
        name: "B工場検品",
        landscape: {
          ...emptyLandscape(),
          domains: ["サプライチェーン"],
          site: "B工場",
          productId: "P200",
          productLabel: "製品A",
          commonProcessId: "INSPECT",
          processRole: "site",
          variantNote: "紙で照合",
        },
      },
      {
        id: "cost",
        name: "原価管理",
        landscape: {
          ...emptyLandscape(),
          domains: ["会計"],
          productId: "P200",
          perspective: "原価",
        },
      },
      {
        id: "future",
        name: "将来設計",
        scenario: "future",
        landscape: { ...emptyLandscape(), productId: "P100" },
      },
      { id: "unknown", name: "曖昧な業務" },
    ],
    nodes: [
      node("data:lot", "data"),
      node("data:old-lot", "data"),
      {
        ...node("process:a:check", "process", "a"),
        label: "検品",
        stepOrder: 1,
        detailSteps: [
          {
            id: "child",
            action: "スキャン",
            condition: null,
            evidence: "手順書",
          },
        ],
      },
    ],
    edges: [],
    dataFlows: [],
  };
}
test("同じ製品の視点と共通業務は別の理由。名前が同じ製品でもIDで区別", () => {
  const view = landscapeView(fixture(), "current", emptyFilters());
  assert(
    view.relations
      .find((r) => r.source === "a" && r.target === "design")
      ?.reasons.includes("同じ製品：P100"),
  );
  const factories = view.relations.find(
    (r) => r.source === "a" && r.target === "b",
  )!;
  assert(factories.reasons.includes("共通業務：INSPECT"));
  assert(!factories.reasons.some((r) => r.startsWith("同じ製品")));
  assert(!view.workflows.some((w) => w.id === "future"));
});
test("近い範囲は一段の関係に限定し、遠い業務へ伝播しない", () => {
  const view = landscapeView(fixture(), "current", {
    ...emptyFilters(),
    range: "nearby",
    anchorId: "design",
  });
  assert.deepEqual(
    view.workflows.map((w) => w.id),
    ["design", "a"],
  );
  assert(view.boundaryRelations.some((r) => r.target === "b"));
});
test("分類・工場・製品・視点・検索を同時適用し範囲外の関係を残す", () => {
  const filters = {
    ...emptyFilters(),
    domain: "サプライチェーン",
    site: "A工場",
    product: "P100",
    perspective: "製造",
    query: "バーコード",
  };
  const view = landscapeView(fixture(), "current", filters);
  assert.deepEqual(
    view.workflows.map((w) => w.id),
    ["a"],
  );
  assert.equal(view.materialFlows.length, 1);
  assert.equal(view.visible.has("b"), false);
  assert.equal(view.boundaryRelations.length, 2);
});
test("関心業務は複数選べ、空や削除済みのIDでも他業務を勝手に表示しない", () => {
  assert.equal(
    landscapeView(fixture(), "current", {
      ...emptyFilters(),
      range: "interests",
    }).workflows.length,
    0,
  );
  assert.equal(
    landscapeView(fixture(), "current", {
      ...emptyFilters(),
      range: "interests",
      pinnedIds: ["deleted"],
    }).workflows.length,
    0,
  );
  assert.deepEqual(
    landscapeView(fixture(), "current", {
      ...emptyFilters(),
      range: "interests",
      pinnedIds: ["design", "unknown"],
    }).workflows.map((w) => w.id),
    ["design", "a", "unknown"],
  );
  assert.deepEqual(
    landscapeView(fixture(), "current", {
      ...emptyFilters(),
      domain: "__unclassified",
    }).workflows.map((w) => w.id),
    ["unknown"],
  );
});
test("未記録のデータ対応は未確認のまま。確認・途切れは根拠が必要", () => {
  const graph = fixture();
  const value = graph.workflows[1].landscape!;
  assert.equal(validateLandscape(graph, "a", value), null);
  assert.equal(
    landscapeView(graph, "current", emptyFilters()).materialFlows[0]
      .dataContinuity,
    "unknown",
  );
  value.materialHandoffs[0].dataContinuity = "linked";
  assert.match(validateLandscape(graph, "a", value)!, /対応データ/);
  value.materialHandoffs[0].dataIds = ["data:lot"];
  value.materialHandoffs[0].evidence = "";
  assert.match(validateLandscape(graph, "a", value)!, /根拠/);
  value.materialHandoffs[0].dataContinuity = "broken";
  value.materialHandoffs[0].evidence = "ロット情報が次工程に渡らない";
  assert.equal(validateLandscape(graph, "a", value), null);
});
test("工場内で物だけ流れる場合も異なる場所を明記すれば登録可能", () => {
  const graph = fixture();
  const value = graph.workflows[1].landscape!;
  value.materialHandoffs[0].targetWorkflowId = "a";
  assert.match(validateLandscape(graph, "a", value)!, /場所/);
  Object.assign(value.materialHandoffs[0], {
    sourceLocation: "加工ライン",
    targetLocation: "部品倉庫",
  });
  assert.equal(validateLandscape(graph, "a", value), null);
});
test("SQLiteの既存業務を移行し、分類・差分・物の流れとデータ参照を再読込", async () => {
  const file = join(
    mkdtempSync(join(tmpdir(), "lens-landscape-")),
    "test.sqlite",
  );
  const legacy = new DatabaseSync(file);
  legacy.exec(
    "CREATE TABLE workflows (project_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, description TEXT, source_notes TEXT NOT NULL DEFAULT '', PRIMARY KEY (project_id,id))",
  );
  legacy.close();
  const repository = new SqliteBusinessFlowRepository(file);
  const graph = fixture();
  graph.workflows[1].landscape!.materialHandoffs[0].dataIds = ["data:lot"];
  await repository.saveProject({
    projectId: "test",
    projectName: "Test",
    graph,
    transcripts: { a: "原文" },
    updatedAt: new Date().toISOString(),
  });
  const loaded = (await repository.loadProject("test"))!;
  assert.equal(
    loaded.graph.workflows[1].landscape!.variantNote,
    "バーコードで照合",
  );
  assert.deepEqual(loaded.graph.workflows[0].landscape!.domains, [
    "エンジニアリングチェーン",
    "研究開発",
  ]);
  assert.equal(
    loaded.graph.workflows[1].landscape!.materialHandoffs[0].dataIds[0],
    canonicalNodeId("data:lot"),
  );
  assert.equal(loaded.graph.workflows[5].landscape, undefined);
  assert.equal(loaded.transcripts.a, "原文");
});
test("業務再抽出や共有データ統合でも物の流れの対応先を失わない", () => {
  const graph = fixture();
  graph.workflows[1].landscape!.materialHandoffs[0].dataIds = ["data:old-lot"];
  const replaced = replaceWorkflowGraph(
    graph,
    { id: "a", name: "更新業務" },
    { nodes: [], edges: [], dataFlows: [], questions: [] },
  );
  assert.equal(replaced.workflows[1].landscape!.site, "A工場");
  assert(replaced.nodes.some((n) => n.id === "data:old-lot"));
  // Merge against the original graph: unreferenced target is still present there.
  const merged = mergeAssets(graph, "data:old-lot", "data:lot");
  assert.deepEqual(merged.workflows[1].landscape!.materialHandoffs[0].dataIds, [
    "data:lot",
  ]);
});
test("工場別の実施は独立した手順を持ち、共通業務IDで関連づく", () => {
  const graph = fixture();
  const before = JSON.stringify(graph);
  const cloned = duplicateSiteWorkflow(graph, "a", "c", "C工場検品", "C工場");
  const workflow = cloned.workflows.find((w) => w.id === "c")!;
  assert.equal(workflow.landscape!.commonProcessId, "INSPECT");
  assert.equal(workflow.scenario, "current");
  assert.equal(workflow.familyId, "c");
  assert.deepEqual(workflow.landscape!.materialHandoffs, []);
  const step = cloned.nodes.find((n) => n.workflowId === "c")!;
  assert.notEqual(step.id, "process:a:check");
  assert.equal(step.detailSteps![0].action, "スキャン");
  step.detailSteps![0].action = "C工場で照合";
  assert.equal(graph.nodes.find(n => n.workflowId === "a")!.detailSteps![0].action, "スキャン");
  assert.equal(JSON.stringify(graph), before);
});
test("将来シナリオに現状の物の受け渡しを自動コピーしない", () => {
  const graph = fixture();
  const branched = branchWorkflowScenario(graph, "a", {
    id: "a-future",
    name: "将来検品",
  });
  const workflow = branched.workflows.at(-1)!;
  assert.equal(workflow.landscape!.productId, "P100");
  assert.deepEqual(workflow.landscape!.materialHandoffs, []);
  assert.equal(
    landscapeView(branched, "future", emptyFilters()).materialFlows.length,
    0,
  );
});

test("物との対応だけで記録されたデータも鳥瞰の利用関係に含む", () => {
  const graph = fixture();
  graph.workflows[1].landscape!.materialHandoffs[0].dataIds = ["data:lot"];
  const data = buildOverview(graph, "current").data[0];
  assert.deepEqual(
    data.workflows.map((w) => w.id),
    ["a", "b"],
  );
  assert.equal(data.materialLinks[0].dataContinuity, "unknown");
  assert.deepEqual(data.systems, []);
});
