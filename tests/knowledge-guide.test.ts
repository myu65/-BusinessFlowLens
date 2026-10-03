import test from "node:test";
import assert from "node:assert/strict";
import { createChemicalCompany } from "../lib/chemical-company";
import { getWorkflowProcesses } from "../lib/graph";
import {
  companyConnections,
  overviewPath,
  termExplanation,
  workflowChapters,
} from "../lib/knowledge-guide";

const graph = createChemicalCompany();
test("reading chapters preserve every ordered step and only combine the same execution mode and department", () => {
  for (const workflow of graph.workflows) {
    const chapters = workflowChapters(graph, workflow.id);
    assert.deepEqual(
      chapters.flatMap((c) => c.steps.map((s) => s.id)),
      getWorkflowProcesses(graph, workflow.id).map((s) => s.id),
    );
    for (const chapter of chapters)
      assert.ok(
        chapter.steps.every(
          (s) => (s.department ?? "担当部署未登録") === chapter.department,
        ),
      );
  }
  assert.ok(
    workflowChapters(graph, "chemical-1-0-0").some((c) =>
      c.steps.some((s) => s.meaning?.halt),
    ),
    "exception chapters remain part of the complete reading structure",
  );
});
test("company bird view shows only actual cross-activity handoffs inside the chosen scenario and scope", () => {
  const ids = graph.workflows
    .filter((w) => w.scenario === "current")
    .map((w) => w.id);
  const connections = companyConnections(graph, ids);
  assert.ok(
    connections.some(
      (c) => c.source.includes("受注") && c.target.includes("計画"),
    ),
  );
  assert.ok(
    connections.every(
      (c) => c.source !== c.target && ids.includes(c.workflowId),
    ),
  );
  assert.equal(companyConnections(graph, ["chemical-1-0-0"]).length, 0);
  assert.equal(
    companyConnections(
      graph,
      graph.workflows.filter((w) => w.scenario === "future").map((w) => w.id),
    ).length,
    0,
  );
});
test("business and system acronyms are explained without inventing unknown definitions", () => {
  assert.match(termExplanation("ATPチェック")!, /在庫/);
  assert.match(termExplanation("MRPへ反映")!, /原料/);
  assert.match(termExplanation("SAP S/4HANA")!, /受注/);
  assert.match(termExplanation("Microsoft Teams")!, /連絡/);
  assert.doesNotMatch(
    termExplanation(
      "受注管理部担当がExcelから「記録」をTeamsへ手動で転記する",
    )!,
    /設備/,
  );
  assert.match(termExplanation("EAM 設備保全")!, /設備/);
  assert.equal(termExplanation("Games Capital"), undefined);
  assert.equal(termExplanation("登録されていない用語"), undefined);
});

test("overview uses a short path of registered handoffs, preserves direction, and respects scope", () => {
  const ids = graph.workflows
    .filter((w) => w.scenario === "current")
    .map((w) => w.id);
  const connections = companyConnections(graph, ids);
  const path = overviewPath(connections, "activity:1");
  assert.equal(path[0].sourceId, "activity:1");
  assert.ok(path.length > 2 && path.length <= 5);
  for (let i = 0; i < path.length; i++) {
    assert.ok(connections.includes(path[i]));
    if (i) assert.equal(path[i - 1].targetId, path[i].sourceId);
  }
  assert.equal(
    new Set([path[0].sourceId, ...path.map((e) => e.targetId)]).size,
    path.length + 1,
  );
  assert.deepEqual(
    overviewPath(companyConnections(graph, ["chemical-1-0-0"])),
    [],
  );
  assert.deepEqual(
    overviewPath(
      companyConnections(
        graph,
        graph.workflows.filter((w) => w.scenario === "future").map((w) => w.id),
      ),
    ),
    [],
  );
});

test("overview remains bounded on dense cyclic graphs and keeps activity identity with duplicate names", () => {
  const dense = Array.from({ length: 40 }, (_, s) =>
    Array.from({ length: 40 }, (_, t) => ({
      sourceId: `a${s}`,
      targetId: `a${t}`,
      source: "同名の活動",
      target: "同名の活動",
      workflowId: "example",
      description: "登録された接続",
      count: 1,
      status: "confirmed" as const,
    })),
  ).flat();
  const path = overviewPath(dense, "a2");
  assert.equal(path.length, 5);
  assert.equal(path[0].sourceId, "a2");
  assert.equal(
    new Set([path[0].sourceId, ...path.map((e) => e.targetId)]).size,
    6,
  );
  const renamed = structuredClone(graph);
  renamed.knowledge!.activities[1].name = renamed.knowledge!.activities[3].name;
  const connections = companyConnections(
    renamed,
    renamed.workflows.filter((w) => w.scenario === "current").map((w) => w.id),
  );
  assert.ok(
    connections.some(
      (c) => c.sourceId === "activity:1" && c.targetId === "activity:3",
    ),
  );
});
