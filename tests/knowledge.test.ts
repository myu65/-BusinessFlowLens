import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChemicalCompany } from "../lib/chemical-company";
import {
  knowledgeIndex,
  knowledgeReport,
  compareWorkflow,
  scopedDataFlows,
  scenarioGraph,
  aggregateDataFlows,
} from "../lib/knowledge";
import {
  branchWorkflowScenario,
  buildWorkflowReviewFromGraph,
  replaceWorkflowGraph,
  canonicalNodeId,
} from "../lib/graph";
import { resolveWorkflowReviewLocally } from "../lib/ai/provider";
import { mergeAssets } from "../lib/refinement";
import { SqliteBusinessFlowRepository } from "../lib/storage/sqlite";

const graph = createChemicalCompany();
const sys = (key: string) => canonicalNodeId(`system:${key}`);

test("300 current workflows are reachable through 12 activities / 60 capabilities with valid graph references", () => {
  assert.equal(
    graph.workflows.filter((w) => w.scenario === "current").length,
    300,
  );
  assert.equal(
    graph.workflows.filter((w) => w.scenario === "future").length,
    3,
  );
  assert.equal(graph.knowledge!.activities.length, 12);
  assert.equal(
    graph.knowledge!.activities.flatMap((a) => a.capabilities).length,
    60,
  );
  const workflows = new Set(graph.workflows.map((w) => w.id));
  const nodes = new Set(graph.nodes.map((n) => n.id));
  assert.equal(nodes.size, graph.nodes.length);
  for (const e of graph.edges) {
    assert.ok(nodes.has(e.source));
    assert.ok(nodes.has(e.target));
    assert.ok(e.workflowIds.every((id) => workflows.has(id)));
  }
  for (const f of graph.dataFlows) {
    assert.ok(nodes.has(f.sourceSystemId));
    assert.ok(nodes.has(f.targetSystemId));
    assert.ok(f.dataIds.every((id) => nodes.has(id)));
    assert.ok(f.processIds.every((id) => nodes.has(id)));
  }
  for (const s of graph.knowledge!.systems) {
    assert.ok(nodes.has(s.systemId));
    assert.ok(s.dependsOn.every((d) => nodes.has(d.systemId)));
  }
  const view = knowledgeIndex(graph, "current");
  assert.equal(view.rows.length, 300);
  assert.ok(
    view.rows.every(
      (r) => r.capabilities.length === 1 && r.processes.length >= 6,
    ),
  );
  assert.ok(view.activities.every((a) => a.rows.length === 25));
});

test("SAP and groupware reverse navigation identifies activity, department, automation, data and handoffs", () => {
  const view = knowledgeIndex(graph, "current");
  for (const key of ["sap", "teams", "sharepoint", "snowflake"]) {
    const impact = view.systemProfile(sys(key));
    assert.ok(impact.direct.length > 0);
    assert.ok(
      impact.direct.every((r) => r.capabilities.length && r.departments.length),
    );
    assert.ok(impact.flows.length > 0);
  }
  const row = view.rows.find((r) => r.workflow.id === "chemical-1-0-0")!;
  for (const name of [
    "価格条件を決定",
    "与信チェック",
    "ATPチェック",
    "MRPへ反映",
    "在庫・所要量を更新",
  ]) {
    const p = row.processes.find((n) => n.label.includes(name))!;
    assert.equal(p.executionMode, "automatic");
    assert.ok(
      graph.edges.some(
        (e) =>
          e.relation === "executes" &&
          e.source === sys("sap") &&
          e.target === p.id,
      ),
    );
    assert.ok(p.executionContext?.rule && p.executionContext.exception);
  }
  const handoff = graph.knowledge!.handoffs!.find(
    (h) => h.sourceWorkflowId === row.workflow.id,
  )!;
  const downstream = view.rows.find(
    (r) => r.workflow.id === handoff.targetWorkflowId,
  )!;
  assert.ok(downstream.assets.some((n) => handoff.dataIds.includes(n.id)));
});

test("infrastructure transitive impact is distinct from direct usage and handles cycles", () => {
  const view = knowledgeIndex(graph, "current");
  const impact = view.systemProfile(sys("network"));
  assert.equal(impact.direct.length, 0);
  assert.equal(impact.indirect.length, 300);
  assert.equal(
    knowledgeIndex(graph, "current", "拠点ネットワーク").rows.length,
    300,
  );
  const cyclic = structuredClone(graph);
  cyclic
    .knowledge!.systems.find((s) => s.systemId === sys("network"))!
    .dependsOn.push({ systemId: sys("identity"), reason: "cyclic test" });
  const result = knowledgeIndex(cyclic, "current").systemProfile(
    sys("network"),
  );
  assert.equal(result.indirect.length, 300);
  assert.ok(!result.dependents.some((n) => n.id === sys("network")));
});

test("scenario, department and search scopes also constrain impacts and reports", () => {
  assert.equal(knowledgeIndex(graph, "future").rows.length, 3);
  const view = knowledgeIndex(graph, "current", "千葉", "品質保証部");
  assert.equal(view.rows.length, 6);
  const impact = view.systemProfile(sys("teams"));
  assert.equal(impact.direct.length, 5);
  const report = knowledgeReport(
    graph,
    "current",
    "千葉",
    "品質保証部",
    impact.direct.map((r) => r.workflow.id),
    sys("teams"),
  );
  assert.ok(report.includes("業務数: 5"));
  assert.ok(!report.includes("品質逸脱CAPA｜川崎"));
  assert.equal(
    knowledgeIndex(graph, "current", "does-not-exist").rows.length,
    0,
  );
  const comparison = compareWorkflow(graph, "chemical-1-0-0")[0];
  assert.equal(comparison.workflow.scenario, "future");
  assert.ok(comparison.afterManual < comparison.beforeManual);
  assert.ok(comparison.removed.some((n) => n.label.includes("転記")));
});

test("data-flow projections bound the graph by scenario/workflow and aggregate paths without losing transfer identity", () => {
  const flows = scopedDataFlows(graph, "current", "chemical-1-0-0");
  assert.ok(flows.length > 0);
  assert.ok(
    flows.every(
      (f) =>
        f.workflowIds.every((id) => id === "chemical-1-0-0") &&
        f.processIds.every(
          (id) =>
            graph.nodes.find((n) => n.id === id)?.workflowId ===
            "chemical-1-0-0",
        ),
    ),
  );
  const projection = scenarioGraph(graph, "current", "chemical-1-0-0");
  assert.equal(projection.workflows.length, 1);
  assert.ok(
    projection.nodes
      .filter((n) => n.kind === "process")
      .every((n) => n.workflowId === "chemical-1-0-0"),
  );
  assert.ok(
    projection.edges.every((e) =>
      e.workflowIds.every((id) => id === "chemical-1-0-0"),
    ),
  );
  const all = scopedDataFlows(graph, "current");
  const groups = aggregateDataFlows(all);
  assert.ok(groups.length < 100);
  assert.equal(
    groups.reduce((n, g) => n + g.flowIds.length, 0),
    all.length,
  );
  assert.ok(
    all.every((f) => f.workflowIds.every((id) => !id.endsWith("-future"))),
  );
  assert.ok(
    scopedDataFlows(graph, "future").some(
      (f) =>
        f.sourceSystemId === sys("sharepoint") &&
        f.targetSystemId === sys("sap") &&
        f.automation === "automatic",
    ),
  );
  assert.equal(
    scopedDataFlows(graph, "current", "chemical-1-0-0", {
      department: "研究開発部",
    }).length,
    0,
  );
});

test("SQLite round trip, workflow save, branch and asset merge preserve company metadata and execution context", async () => {
  const repo = new SqliteBusinessFlowRepository(
    join(mkdtempSync(join(tmpdir(), "knowledge-")), "graph.sqlite"),
  );
  await repo.saveProject({
    projectId: "chemical",
    projectName: "Chemical",
    graph,
    transcripts: {},
    updatedAt: new Date().toISOString(),
  });
  const loaded = (await repo.loadProject("chemical"))!.graph;
  assert.deepEqual(loaded.knowledge, graph.knowledge);
  assert.equal(knowledgeIndex(loaded, "current").rows.length, 300);
  const workflow = loaded.workflows.find((w) => w.id === "chemical-1-0-0")!;
  const review = buildWorkflowReviewFromGraph(loaded, workflow.id);
  const patch = resolveWorkflowReviewLocally({
    graph: loaded,
    review,
    workflow,
  }).patch;
  const saved = replaceWorkflowGraph(loaded, workflow, patch);
  assert.deepEqual(saved.knowledge, graph.knowledge);
  assert.ok(
    saved.nodes.some(
      (n) => n.workflowId === workflow.id && n.executionContext?.rule,
    ),
  );
  assert.ok(saved.nodes.some((n) => n.id === sys("network")));
  const branch = branchWorkflowScenario(saved, workflow.id, {
    id: "future-test",
    name: "Future test",
    scenario: "future",
  });
  assert.ok(
    branch
      .knowledge!.activities.flatMap((a) => a.capabilities)
      .some((c) => c.workflowIds.includes("future-test")),
  );
  const merged = mergeAssets(branch, sys("csv"), sys("excel"));
  assert.ok(
    !merged.knowledge!.systems.some(
      (s) =>
        s.systemId === sys("csv") ||
        s.dependsOn.some((d) => d.systemId === sys("csv")),
    ),
  );
  await repo.saveProject({
    projectId: "chemical",
    projectName: "Chemical",
    graph: merged,
    transcripts: {},
    updatedAt: new Date().toISOString(),
  });
  assert.deepEqual(
    (await repo.loadProject("chemical"))!.graph.knowledge,
    merged.knowledge,
  );
});
