import test from "node:test";
import assert from "node:assert/strict";
import { buildExtractionContext } from "../lib/ai/context";
import type { LensGraph } from "../lib/graph";

function accumulated(): LensGraph {
  const graph: LensGraph = {
    workflows: [],
    nodes: [],
    edges: [],
    dataFlows: [],
  };
  for (let index = 0; index < 300; index++) {
    const id = `workflow-${index}`;
    graph.workflows.push({ id, name: `一般業務${index}`, scenario: "current" });
    graph.nodes.push({
      id: `process-${index}`,
      canonicalKey: `process:${id}:receive`,
      kind: "process",
      workflowId: id,
      label: `受付${index}`,
      description: "受付の説明",
      actor: "担当者",
      status: "confirmed",
      stepOrder: 1,
    });
    graph.nodes.push({
      id: `data-${index}`,
      canonicalKey: `data:record-${index}`,
      kind: "data",
      label: `記録${index}`,
      status: "confirmed",
      description: "入力された情報",
    });
    graph.edges.push({
      id: `edge-${index}`,
      source: `process-${index}`,
      target: `data-${index}`,
      relation: "reads",
      label: "receive",
      workflowIds: [id],
    });
  }
  const last = graph.workflows[299];
  last.name = "不足数量から製造必要量を決める";
  last.trigger = "需給調整から不足数量を受け取る";
  last.outcome = "製造必要量が決まりMRPが動く";
  graph.nodes[598].canonicalKey = "process:workflow-299:receive-shortage";
  graph.nodes[598].label = "不足数量を受け取る";
  graph.nodes[598].meaning = {
    purpose: "",
    basis: "不足数量",
    result: "製造必要量が決まる",
    next: "MRP",
    condition: "",
    halt: false,
    certainty: "confirmed",
    evidence: "聞いた説明",
  };
  graph.nodes[599].label = "不足数量";
  graph.nodes.push({
    id: "lims",
    canonicalKey: "system:lims",
    kind: "system",
    label: "LIMS 本番",
    aliases: ["品質DB"],
    description: "分析結果を記録",
    status: "confirmed",
  });
  graph.edges.push({
    id: "lims-use",
    source: "process-299",
    target: "lims",
    relation: "uses",
    workflowIds: [last.id],
  });
  return graph;
}

test("a late workflow among 300 is selected by the new story, with its receiving key and data operation", () => {
  const graph = accumulated();
  const context = buildExtractionContext(
    graph,
    { id: "new", name: "新しい話" },
    "不足数量から製造必要量を決める仕事へ、不足数量を渡している。品質DBも確認する。",
  );
  assert.equal(context.workflows[0].id, "workflow-299");
  assert.equal(context.workflows[0].steps[0].stepKey, "receive-shortage");
  assert.equal(context.workflows[0].steps[0].result, "製造必要量が決まる");
  assert.deepEqual(context.workflows[0].steps[0].data, [
    { name: "不足数量", operation: "receive" },
  ]);
  assert.equal(context.systems[0].canonicalKey, "system:lims");
  assert.ok(context.data.some((item) => item.name === "不足数量"));
  assert.equal(context.scope.totalWorkflows, 300);
  assert.equal(context.scope.omittedWorkflows, 288);
  assert.ok(context.workflows.length <= 12 && context.data.length <= 30);
  assert.equal(graph.workflows.length, 300);
});

test("current candidates exclude future-only workflows and assets; a future draft can reference its current baseline", () => {
  const graph = accumulated();
  graph.workflows.push({
    id: "future",
    name: "完全自動化の将来案",
    scenario: "future",
    basedOnWorkflowId: "workflow-299",
  });
  graph.nodes.push({
    id: "future-process",
    canonicalKey: "process:future:start",
    kind: "process",
    label: "自動化",
    workflowId: "future",
    description: "",
    status: "inferred",
  });
  graph.nodes.push({
    id: "future-tool",
    canonicalKey: "system:future-tool",
    kind: "system",
    label: "将来だけのツール",
    description: "未導入",
    status: "inferred",
  });
  graph.edges.push({
    id: "future-use",
    source: "future-process",
    target: "future-tool",
    relation: "uses",
    workflowIds: ["future"],
  });
  const current = buildExtractionContext(
    graph,
    { id: "new", name: "話" },
    "完全自動化の将来案を将来だけのツールで使う",
  );
  assert.ok(!current.workflows.some((w) => w.id === "future"));
  assert.ok(
    !current.systems.some((s) => s.canonicalKey === "system:future-tool"),
  );
  const future = buildExtractionContext(
    graph,
    graph.workflows.at(-1)!,
    "不足数量",
  );
  assert.equal(future.scope.scenario, "future");
  assert.equal(future.workflows[0].id, "workflow-299");
});

test("reference certainty and bounded steps survive retrieval without confirming a guessed relation", () => {
  const graph = accumulated();
  graph.nodes.find((n) => n.id === "lims")!.status = "unknown";
  for (let index = 0; index < 20; index++)
    graph.nodes.push({
      id: `extra-${index}`,
      canonicalKey: `process:workflow-299:extra-${index}`,
      kind: "process",
      workflowId: "workflow-299",
      label: `追加${index}`,
      description: "",
      status: "inferred",
      stepOrder: index + 2,
    });
  const context = buildExtractionContext(
    graph,
    { id: "new", name: "話" },
    "品質DBを使い、不足数量から製造必要量を決める",
  );
  assert.equal(context.systems[0].status, "unknown");
  assert.equal(context.workflows[0].totalSteps, 21);
  assert.equal(context.workflows[0].steps.length, 6);
  assert.equal(context.workflows[0].steps[0].stepKey, "receive-shortage");
  assert.equal(graph.edges.length, 301);
});
