import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LensGraph, LensNode } from "../lib/graph";
import { handoffJourney, journeyEntryExplanation, type WorkflowHandoff } from "../lib/flow-context";
import { WorkflowReading } from "../components/WorkflowReading";

const process = (id: string, workflowId: string, stepOrder: number, label = id): LensNode => ({ id, workflowId, stepOrder, label, canonicalKey: id, kind: "process", status: "confirmed", description: "" });
function fixture() {
  const h: WorkflowHandoff = { id: "reference", sourceWorkflowId: "source", targetWorkflowId: "target", targetProcessId: "t1", dataIds: ["master"],
    description: "原料マスタを参照する", evidence: "登録済みの原料マスタを使う", kind: "information", via: "reference", status: "inferred" };
  const graph: LensGraph = { workflows: [{ id: "source", name: "原料情報を整備する" }, { id: "target", name: "代替候補を検討する" }],
    nodes: [process("s1", "source", 1), process("s2", "source", 2), process("s3", "source", 3, "原料マスタを登録する"), process("t1", "target", 1),
      { id: "master", label: "原料マスタ", canonicalKey: "master", kind: "data", description: "", status: "confirmed" }],
    edges: [{ id: "update", source: "s3", target: "master", relation: "writes", workflowIds: ["source"] }, { id: "read", source: "t1", target: "master", relation: "reads", workflowIds: ["target"] }],
    dataFlows: [], knowledge: { name: "", description: "", activities: [], categories: [], systems: [], criticalWorkflows: [], handoffs: [h] } };
  return { graph, h };
}

test("reading backwards to an unknown source explains the actual reference step and keeps information, original evidence and return context", () => {
  const { graph, h } = fixture(), before = JSON.stringify(graph);
  const journey = handoffJourney(graph, h, "target", "t1", undefined, "master");
  assert.equal(journey.entryKnown, false); assert.equal(journey.entrySide, "source"); assert.equal(journey.stepId, undefined);
  assert.equal(journey.dataId, "master"); assert.equal(journey.trail[0].evidence, h.evidence); assert.equal(journey.trail[0].stepId, "t1");
  const html = renderToStaticMarkup(createElement(WorkflowReading, { graph, workflowId: "source", journey, initialDataId: "master", initialLens: "data", onDetail: () => {} }));
  assert.match(html, /送り出す手順は未確認です/); assert.match(html, /手順3「原料マスタを登録する」を参考表示しています/);
  assert.doesNotMatch(html, /受取手順は未確認|業務の先頭を参考表示/);
  assert.match(html, /代替候補を検討する/); assert.match(html, /この手順が接続先とは確認できていません/);
  assert.equal(JSON.stringify(graph), before);
});

test("known, ambiguous and legacy entries describe the direction without claiming a reference position is a confirmed handoff", () => {
  const { graph, h } = fixture();
  const known = handoffJourney(graph, { ...h, sourceProcessId: "s3" }, "target", "t1");
  assert.equal(known.entryKnown, true); assert.equal(known.stepId, "s3");
  assert.equal(journeyEntryExplanation(known, graph.nodes[2], 2), null);
  const invalid = handoffJourney(graph, { ...h, sourceProcessId: "t1" }, "target", "t1");
  assert.equal(invalid.entryKnown, false); assert.equal(invalid.stepId, undefined, "a different workflow's node cannot confirm a source");
  const unknown = handoffJourney({ ...graph, edges: [] }, { ...h, targetProcessId: undefined }, "source", "s3");
  assert.equal(unknown.entrySide, "target"); assert.equal(unknown.entryKnown, false);
  assert.match(journeyEntryExplanation(unknown, graph.nodes[3], 0)!, /受け取る手順は未確認.*手順1/);
  assert.match(journeyEntryExplanation({ ...unknown, entrySide: undefined }, graph.nodes[3], 0)!, /接続する手順は未確認/);
});
