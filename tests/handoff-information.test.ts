import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { extractGroundedLocal } from "../lib/local-review";
import { buildWorkflowReviewFromGraph, type LensGraph } from "../lib/graph";
import { previewReviewGraph, diffReviews } from "../lib/review-workbench";
import { confirmHandoffInformation, handoffInformationText, handoffSourceInformation, resolveHandoffInformation } from "../lib/handoff-information";
import { preserveRefinements } from "../lib/refinement";
import { handoffJourney, stepContext, traceData } from "../lib/flow-context";
import { SqliteBusinessFlowRepository } from "../lib/storage/sqlite";
import { InputReviewFlow } from "../components/InputReviewFlow";

function example() {
  const producer = { id: "quality", name: "返品の再利用可否を判断する" };
  const produced = extractGroundedLocal("品質担当がQMSに再利用可否を記録する。");
  produced.steps[0].stepKey = "decide";
  produced.steps[0].data = [{ name: "再利用可否", operation: "create", evidence: produced.steps[0].evidence }];
  const empty: LensGraph = { workflows: [], nodes: [], edges: [], dataFlows: [] };
  const graph = previewReviewGraph(empty, producer, produced);
  const consumer = { id: "billing", name: "返品の請求を訂正する" };
  const read = extractGroundedLocal("経理担当が返品の再利用可否を判断する仕事の判定を参照する。");
  read.steps[0].stepKey = "reference";
  read.steps[0].data = [{ name: "再利用可否の判定", operation: "read", evidence: read.steps[0].evidence }];
  read.incomingHandoffs = [{ sourceWorkflowId: producer.id, sourceStepKey: "decide", toStepKey: "reference", via: "reference",
    data: ["再利用可否の判定"], description: "前の仕事の判定を参照する", evidence: read.steps[0].evidence, certainty: "confirmed", origin: "ai" }];
  read.extraction = { method: "ai", provider: "test", model: "test", completedAt: "2026-10-05T00:00:00Z" };
  return { graph, producer, produced, consumer, read, data: handoffSourceInformation(graph, producer.id, "decide")[0].data };
}

test("a named reference with unresolved information survives SQLite, reconstruction and another save", async () => {
  const { graph, producer, consumer, read } = example();
  const candidate = previewReviewGraph(graph, consumer, read);
  const handoff = candidate.knowledge!.handoffs![0];
  assert.equal(handoff.status, "confirmed");
  assert.deepEqual(handoff.dataIds, []);
  assert.deepEqual(handoff.dataNames, ["再利用可否の判定"]);
  assert.match(handoffInformationText(candidate, handoff), /候補名：再利用可否の判定・情報の対応は要確認/);
  const repo = new SqliteBusinessFlowRepository(join(mkdtempSync(join(tmpdir(), "lens-ref-")), "qa.sqlite"));
  await repo.saveProject({ projectId: "qa", projectName: "QA", graph: candidate, transcripts: { [consumer.id]: read.steps[0].evidence }, updatedAt: "2026-10-05T00:00:00Z" });
  const loaded = (await repo.loadProject("qa"))!;
  const restored = buildWorkflowReviewFromGraph(loaded.graph, consumer.id);
  assert.deepEqual(restored.incomingHandoffs, read.incomingHandoffs);
  const savedAgain = previewReviewGraph(loaded.graph, consumer, restored);
  assert.deepEqual(savedAgain.knowledge!.handoffs![0].dataNames, handoff.dataNames);
  assert.equal(savedAgain.knowledge!.handoffs![0].sourceWorkflowId, producer.id);
});

test("human correspondence keeps the original words and data identity, and carries information across the work boundary", () => {
  const { graph, producer, consumer, read, data } = example();
  const before = structuredClone(read);
  const incoming = read.incomingHandoffs![0];
  incoming.dataBindings = confirmHandoffInformation(graph, producer.id, "decide", incoming.data, undefined, incoming.data[0], data.id);
  const connected = previewReviewGraph(graph, consumer, read);
  const handoff = connected.knowledge!.handoffs![0];
  assert.deepEqual(handoff.dataIds, [data.id]);
  assert.deepEqual(handoff.dataNames, before.incomingHandoffs![0].data);
  assert.equal(handoff.evidence, before.incomingHandoffs![0].evidence);
  assert.match(handoff.dataBindings![0].evidence, /利用者が情報の対応を確認/);
  assert.match(handoffInformationText(connected, handoff), /再利用可否の判定 → 再利用可否（利用者が確認）/);
  assert.equal(connected.nodes.filter(n => n.kind === "data").length, 2);
  assert.deepEqual(connected.nodes.find(n => n.id === data.id)?.aliases, data.aliases);
  const step = connected.nodes.find(n => n.id === handoff.targetProcessId)!;
  assert.ok(stepContext(connected, consumer.id, step.id).inputs.some(n => n.id === data.id));
  assert.deepEqual(stepContext(connected, consumer.id, step.id).inputs.map(n => n.label), ["再利用可否"]);
  assert.ok(traceData(connected, consumer.id, data.id)[0].operations.includes("reads"));
  assert.ok(traceData(connected, consumer.id, data.id)[0].operations.includes("業務間の参照"));
  const journey = handoffJourney(connected, handoff, consumer.id, step.id);
  assert.equal(journey.workflowId, producer.id);
  assert.equal(journey.stepId, handoff.sourceProcessId);
  assert.equal(journey.dataId, data.id);
  assert.equal(diffReviews(before, read, graph).changedConnections.length, 1);
  assert.match(diffReviews(before, read, graph).changedConnections[0].after, /利用者が確認/);
  const restored = buildWorkflowReviewFromGraph(connected, consumer.id);
  assert.deepEqual(restored.incomingHandoffs![0].dataBindings, incoming.dataBindings);
  assert.deepEqual(preserveRefinements({ ...before, incomingHandoffs: [] }, restored).incomingHandoffs![0].dataBindings, incoming.dataBindings);
  assert.ok(preserveRefinements({ ...before, incomingHandoffs: [] }, restored).warnings.some(warning => warning.includes("この業務の接続も確認")));
  incoming.dataBindings = confirmHandoffInformation(graph, producer.id, "decide", incoming.data, incoming.dataBindings, incoming.data[0], "");
  const reset = previewReviewGraph(graph, consumer, read);
  assert.deepEqual(reset.knowledge!.handoffs![0].dataIds, []);
  const resetReview = buildWorkflowReviewFromGraph(reset, consumer.id);
  assert.match(resetReview.incomingHandoffs![0].dataBindings![0].evidence, /未確認に戻した/);
  assert.equal(preserveRefinements(before, resetReview).incomingHandoffs![0].dataBindings![0].dataId, "");
  assert.match(handoffInformationText(connected, { dataIds: [data.id], dataNames: [data.label],
    dataBindings: [{ name: data.label, dataId: "", evidence: "利用者が未確認へ戻した" }] }), /情報の対応は要確認/);
});

test("similar names, unrelated data and stale bindings stay pending instead of merging or guessing", () => {
  const { graph, producer, consumer, read, data } = example();
  const candidate = previewReviewGraph(graph, consumer, read);
  const unrelated = candidate.nodes.find(n => n.kind === "data" && n.id !== data.id)!;
  assert.deepEqual(confirmHandoffInformation(candidate, producer.id, "decide", read.incomingHandoffs![0].data, undefined, "再利用可否の判定", unrelated.id), []);
  assert.deepEqual(confirmHandoffInformation(candidate, producer.id, "unknown", read.incomingHandoffs![0].data, undefined, "再利用可否の判定", data.id), []);
  assert.deepEqual(resolveHandoffInformation(candidate, producer.id, "decide", ["判定"]).dataIds, []);
  const bindings = [{ name: "再利用可否の判定", dataId: unrelated.id, evidence: "前の確認" }];
  const resolution = resolveHandoffInformation(candidate, producer.id, "decide", ["再利用可否の判定"], bindings);
  assert.deepEqual(resolution.dataIds, []);
  assert.deepEqual(resolution.unresolved, ["再利用可否の判定"]);
  assert.equal(JSON.stringify(graph).includes("利用者が情報の対応"), false);
});

test("exact names resolve within the specified source even if another work owns data with the same name", () => {
  const { graph, producer, read, data } = example();
  const duplicate = { ...data, id: "independent-decision", canonicalKey: "data:independent-decision" };
  const withDuplicate = { ...graph, nodes: [...graph.nodes, duplicate] };
  assert.deepEqual(resolveHandoffInformation(withDuplicate, producer.id, "decide", ["再利用可否"]).dataIds, [data.id]);
  assert.deepEqual(resolveHandoffInformation(withDuplicate, producer.id, "decide", read.incomingHandoffs![0].data).dataIds, []);
});

test("the input preview distinguishes a known business connection from pending information beside a simple confirmation control", () => {
  const { graph, consumer, read } = example();
  const html = renderToStaticMarkup(createElement(InputReviewFlow, { review: read, selected: read.steps[0], graph: previewReviewGraph(graph, consumer, read),
    workflowId: consumer.id, busy: false, choose: () => {}, onEdit: () => {}, onExclude: () => {}, onWorkflow: () => {}, onConfirmIncomingData: () => {} }));
  assert.ok(html.includes("情報の対応は要確認"));
  assert.ok(html.includes("「再利用可否の判定」にあたる情報"));
  assert.ok(html.includes("情報の対応は未確認のままにする"));
  assert.ok(html.includes("この情報を確認：再利用可否の判定"));
  assert.ok(html.includes("情報の作成元：返品の再利用可否を判断する"));
});
