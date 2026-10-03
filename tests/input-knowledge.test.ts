import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildWorkflowReviewFromGraph,
  type LensGraph,
  type Workflow,
} from "../lib/graph";
import { extractGroundedLocal } from "../lib/local-review";
import {
  previewReviewGraph,
  applyReviewConnections,
} from "../lib/review-workbench";
import {
  applyInputOrganization,
  retainRegisteredGrouping,
  inputSystemRoles,
} from "../lib/input-knowledge";
import { preserveRefinements } from "../lib/refinement";
import { SqliteBusinessFlowRepository } from "../lib/storage/sqlite";
import {
  validateReviewConnections,
  validateAITransitions,
} from "../lib/review-connections";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InputReviewFlow } from "../components/InputReviewFlow";
import { WorkflowReading } from "../components/WorkflowReading";
import { stepContext, traceData, handoffJourney } from "../lib/flow-context";

const empty = (): LensGraph => ({
  workflows: [],
  nodes: [],
  edges: [],
  dataFlows: [],
});
const workflow: Workflow = {
  id: "order-input",
  name: "入力した話：営業の話",
  scenario: "current",
};
function first() {
  const review = extractGroundedLocal("営業がTeamsで不足数量を送る。");
  review.steps[0].data = [
    { name: "不足数量", operation: "send", evidence: "不足数量を送る" },
  ];
  review.organization = {
    title: "不足数量の連絡",
    activity: "注文に応える",
    capability: "不足の調整",
    certainty: "inferred",
    evidence: "営業がTeamsで不足数量を送る",
    origin: "ai",
  };
  review.systemProfiles = [
    {
      name: "Teams",
      category: "共同作業・連絡",
      purpose: "不足数量を連絡する",
      certainty: "inferred",
      evidence: "Teamsで不足数量を送る",
    },
  ];
  return { review, graph: previewReviewGraph(empty(), workflow, review) };
}

test("a reviewed input grows editable grouping and system role without inventing a company, dependencies or business order", () => {
  const { graph, review } = first();
  assert.equal(graph.workflows[0].name, "不足数量の連絡");
  assert.equal(graph.knowledge?.activities[0].name, "注文に応える");
  assert.deepEqual(graph.knowledge?.activities[0].capabilities[0].workflowIds, [
    workflow.id,
  ]);
  assert.equal(graph.knowledge?.activities[0].certainty, "inferred");
  assert.equal(graph.knowledge?.categories[0].name, "共同作業・連絡");
  assert.equal(graph.knowledge?.systems[0].purpose, "不足数量を連絡する");
  assert.deepEqual(graph.knowledge?.systems[0].dependsOn, []);
  assert.equal(graph.knowledge?.systems[0].owner, "");
  assert.equal(
    graph.nodes.filter((n) => n.kind === "process").length,
    review.steps.length,
  );
  assert(!graph.knowledge?.name.includes("化学"));
});

test("ambiguous grouping stays unclassified and a later AI proposal cannot replace manual placement or manual system role", () => {
  const { graph, review } = first();
  graph.knowledge!.activities[0].name = "人がまとめた会社の活動";
  delete graph.knowledge!.systems[0].sourceWorkflowId;
  graph.knowledge!.systems[0].purpose = "人が確認した役割";
  const next = {
    ...review,
    organization: {
      ...review.organization!,
      activity: "AIが新しく推定した活動",
    },
    systemProfiles: [{ ...review.systemProfiles![0], purpose: "別の推定" }],
  };
  const applied = applyInputOrganization(graph, graph.workflows[0], next);
  assert.deepEqual(applied.knowledge, graph.knowledge);
  const retained = retainRegisteredGrouping(next, graph, graph.workflows[0]);
  assert.equal(retained.organization?.activity, "人がまとめた会社の活動");
  assert.equal(retained.organization?.origin, "existing");
  const unknown = previewReviewGraph(empty(), workflow, {
    ...review,
    organization: null,
    systemProfiles: [],
  });
  assert(!unknown.knowledge?.activities.length);
});

test("a known system purpose survives an unknown category without inventing a category or owner", () => {
  const { review } = first();
  review.systemProfiles![0].category = "";
  const graph = previewReviewGraph(empty(), workflow, review);
  assert.equal(graph.knowledge?.systems[0].purpose, "不足数量を連絡する");
  assert.equal(graph.knowledge?.systems[0].categoryId, "");
  assert.deepEqual(graph.knowledge?.categories, []);
  assert.equal(graph.knowledge?.systems[0].owner, "");
  const systemId = graph.nodes.find((n) => n.kind === "system")!.id;
  assert.equal(
    inputSystemRoles(graph, systemId, [workflow.id])[0].purpose,
    "不足数量を連絡する",
  );
  assert.deepEqual(inputSystemRoles(graph, systemId, []), []);
  graph.nodes.push({
    ...graph.nodes.find((n) => n.id === systemId)!,
    id: "another-teams",
    canonicalKey: "system:another-teams",
  });
  assert.deepEqual(inputSystemRoles(graph, systemId, [workflow.id]), []);
});

test("editing one proposed grouping preserves other manually registered memberships, and clearing it really unclassifies that grouping", () => {
  const { graph, review } = first();
  graph.knowledge!.activities.push({
    id: "manual",
    name: "別の手動分類",
    description: "",
    capabilities: [
      {
        id: "manual-type",
        name: "別の仕事の種類",
        description: "",
        workflowIds: [workflow.id],
      },
    ],
  });
  const corrected = {
    ...review,
    organization: {
      ...review.organization!,
      activity: "変更した活動",
      origin: "human" as const,
    },
  };
  const applied = applyInputOrganization(graph, graph.workflows[0], corrected);
  assert(
    applied
      .knowledge!.activities.find((a) => a.id === "manual")!
      .capabilities[0].workflowIds.includes(workflow.id),
  );
  assert(
    !applied
      .knowledge!.activities.find(
        (a) => a.name === review.organization!.activity,
      )!
      .capabilities[0].workflowIds.includes(workflow.id),
  );
  const cleared = applyInputOrganization(graph, graph.workflows[0], {
    ...review,
    organization: { ...review.organization!, activity: "", origin: "human" },
  });
  assert(
    !cleared.knowledge!.activities[0].capabilities[0].workflowIds.includes(
      workflow.id,
    ),
  );
  assert(
    cleared
      .knowledge!.activities.find((a) => a.id === "manual")!
      .capabilities[0].workflowIds.includes(workflow.id),
  );
});

test("incoming information connects an existing producer to a new receiving step and survives persistence and later source edits", async () => {
  const { graph: source } = first();
  // This fixture uses confirmed named data to exercise identity, not AI quality.
  source.nodes
    .filter((n) => n.kind !== "process")
    .forEach((n) => (n.status = "confirmed"));
  const sender = source.nodes.find((n) => n.kind === "process")!;
  const data = source.nodes.find((n) => n.kind === "data")!;
  const target: Workflow = {
    id: "mrp-input",
    name: "必要量から計画する",
    scenario: "current",
  };
  const review = extractGroundedLocal("生産管理がSAPに必要量を登録する。");
  review.incomingHandoffs = [
    {
      via: "handoff",
      sourceWorkflowId: workflow.id,
      sourceStepKey: sender.canonicalKey.split(":").at(-1),
      toStepKey: review.steps[0].stepKey,
      data: [data.label],
      description: "不足数量を受けて計画を始める",
      evidence: "営業から不足数量を受け取る",
      certainty: "confirmed",
      origin: "ai",
    },
  ];
  const connected = previewReviewGraph(source, target, review);
  const handoff = connected.knowledge!.handoffs![0];
  assert.equal(handoff.sourceProcessId, sender.id);
  assert(handoff.targetProcessId);
  assert.deepEqual(handoff.dataIds, [data.id]);
  const repository = new SqliteBusinessFlowRepository(
    join(mkdtempSync(join(tmpdir(), "bfl-incoming-")), "test.sqlite"),
  );
  await repository.saveProject({
    projectId: "test",
    projectName: "Test",
    graph: connected,
    transcripts: {},
    updatedAt: new Date().toISOString(),
  });
  const loaded = (await repository.loadProject("test"))!.graph;
  const restored = buildWorkflowReviewFromGraph(loaded, target.id);
  assert.deepEqual(restored.incomingHandoffs, review.incomingHandoffs);
  const outgoingSourceReview = buildWorkflowReviewFromGraph(
    loaded,
    workflow.id,
  );
  assert.equal(outgoingSourceReview.handoffs?.length, 0);
  const sourceMarkup = renderToStaticMarkup(
    createElement(InputReviewFlow, {
      workflowId: workflow.id,
      review: outgoingSourceReview,
      selected: outgoingSourceReview.steps[0],
      graph: loaded,
      busy: false,
      choose: () => {},
      onEdit: () => {},
      onExclude: () => {},
      onWorkflow: () => {},
    }),
  );
  assert(sourceMarkup.includes("次の業務：必要量から計画する"));
  const context = stepContext(loaded, target.id, handoff.targetProcessId!);
  assert(context.inputs.some((n) => n.id === data.id));
  assert.equal(context.incomingHandoffs.length, 1);
  assert(
    traceData(loaded, target.id, data.id).some((t) =>
      t.operations.includes("業務間の受取"),
    ),
  );
  const readerMarkup = renderToStaticMarkup(
    createElement(WorkflowReading, {
      graph: loaded,
      workflowId: workflow.id,
      initialStepId: sender.id,
      onDetail: () => {},
    }),
  );
  assert(readerMarkup.includes("次の業務：必要量から計画する"));
  assert(!readerMarkup.includes("次の接続は未登録です"));
  const journey = handoffJourney(loaded, handoff, workflow.id, sender.id, {
    workflowId: workflow.id,
    stepId: sender.id,
    trail: [],
    entryKnown: true,
    depth: "detail",
  });
  const resumedMarkup = renderToStaticMarkup(
    createElement(WorkflowReading, {
      graph: loaded,
      workflowId: target.id,
      journey,
      onDetail: () => {},
    }),
  );
  assert.equal(journey.depth, "detail");
  assert(resumedMarkup.includes("同じ手順の判断と個別作業"));
  assert(resumedMarkup.includes("受取元：不足数量の連絡"));
  const referenceGraph = structuredClone(loaded);
  referenceGraph.knowledge!.handoffs![0].via = "reference";
  await repository.saveProject({
    projectId: "reference",
    projectName: "Reference",
    graph: referenceGraph,
    transcripts: {},
    updatedAt: new Date().toISOString(),
  });
  const referenceLoaded = (await repository.loadProject("reference"))!.graph;
  const referenceReview = buildWorkflowReviewFromGraph(
    referenceLoaded,
    target.id,
  );
  assert.equal(referenceReview.incomingHandoffs?.[0].via, "reference");
  const referenceMarkup = renderToStaticMarkup(
    createElement(InputReviewFlow, {
      workflowId: target.id,
      review: referenceReview,
      selected: referenceReview.steps[0],
      graph: referenceLoaded,
      busy: false,
      choose: () => {},
      onEdit: () => {},
      onExclude: () => {},
      onWorkflow: () => {},
    }),
  );
  assert(referenceMarkup.includes("情報の作成元：不足数量の連絡"));
  assert(!referenceMarkup.includes("受取元："));
  assert.equal(
    applyReviewConnections(loaded, workflow, {
      ...outgoingSourceReview,
      handoffs: [],
    }).knowledge!.handoffs!.length,
    1,
  );
  const future = previewReviewGraph(
    source,
    { ...target, scenario: "future" },
    review,
  );
  assert.equal(future.knowledge?.handoffs?.length, 0);
});

test("invalid or future-only connection IDs become questions and unknown step keys remain visibly unresolved", () => {
  const { graph, review } = first();
  graph.workflows.push({
    id: "future",
    name: "将来の別案",
    scenario: "future",
  });
  const target = { id: "new", name: "新しい話", scenario: "current" as const };
  review.incomingHandoffs = [
    {
      sourceWorkflowId: "future",
      toStepKey: review.steps[0].stepKey,
      data: [],
      description: "案",
      evidence: "入力",
      certainty: "inferred",
    },
    {
      sourceWorkflowId: workflow.id,
      sourceStepKey: "invented",
      toStepKey: review.steps[0].stepKey,
      data: [],
      description: "受取",
      evidence: "入力",
      certainty: "confirmed",
    },
  ];
  const checked = validateReviewConnections(review, graph, target);
  assert.equal(checked.incomingHandoffs?.length, 1);
  assert.equal(checked.incomingHandoffs?.[0].sourceStepKey, undefined);
  assert.equal(checked.incomingHandoffs?.[0].certainty, "unknown");
  assert(checked.questions.some((q) => q.target === "handoff"));
  assert(checked.warnings.length >= 2);
});

test("an AI stop cannot become a self-loop, while an explicitly quoted retry stays connected", () => {
  const { review } = first();
  const key = review.steps[0].stepKey;
  review.steps[0].meaning = {
    purpose: "",
    basis: "",
    result: "着手を止めて確認を頼む",
    next: "",
    condition: "原料が使用不可",
    halt: true,
    certainty: "confirmed",
    evidence: "使用不可なら着手を止める",
  };
  review.transitions = [
    {
      fromStepKey: key,
      toStepKey: key,
      condition: "原料が使用不可",
      certainty: "confirmed",
      evidence: "使用不可なら着手を止める",
    },
  ];
  const stopped = validateAITransitions(review, "使用不可なら着手を止める。");
  assert.equal(stopped.transitions.length, 0);
  assert.equal(
    stopped.steps[0].meaning?.result,
    review.steps[0].meaning.result,
  );
  assert(stopped.questions.some((q) => q.target === "exception"));
  const retry = {
    ...review,
    transitions: [
      { ...review.transitions[0], evidence: "失敗したらもう一度送る" },
    ],
  };
  assert.equal(
    validateAITransitions(retry, "失敗したらもう一度送る。").transitions.length,
    1,
  );
  assert.equal(
    validateAITransitions(retry, "使用不可なら着手を止める。").transitions
      .length,
    0,
  );
});

test("human grouping and receiving corrections survive AI refinement while source-derived handoffs can be corrected", () => {
  const { review } = first();
  review.extraction = {
    method: "ai",
    provider: "test",
    completedAt: "2026-10-03",
  };
  review.organization = {
    ...review.organization!,
    origin: "human",
    activity: "人が確認した活動",
  };
  review.incomingHandoffs = [
    {
      sourceWorkflowId: "source",
      toStepKey: review.steps[0].stepKey,
      data: [],
      description: "人が訂正した受取",
      evidence: "補足",
      certainty: "confirmed",
      origin: "human",
    },
  ];
  review.handoffs = [
    {
      fromStepKey: review.steps[0].stepKey,
      targetWorkflowId: "old",
      data: [],
      description: "旧AIの接続",
      evidence: "旧原文",
      certainty: "confirmed",
      origin: "ai",
    },
  ];
  const next = preserveRefinements(
    {
      ...review,
      organization: {
        ...review.organization,
        origin: "ai",
        activity: "別の推定",
      },
      handoffs: [],
      incomingHandoffs: [],
    },
    review,
  );
  assert.equal(next.organization?.activity, "人が確認した活動");
  assert.equal(next.incomingHandoffs?.length, 1);
  assert.equal(next.handoffs?.length, 0);
});
