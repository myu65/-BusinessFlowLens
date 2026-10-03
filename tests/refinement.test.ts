import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  buildWorkflowReviewFromGraph,
  createDemoGraph,
  replaceWorkflowGraph,
  type ExtractionReview,
  type LensGraph,
} from "../lib/graph";
import { extractGroundedLocal } from "../lib/local-review";
import {
  findConfirmedAsset,
  mergeAssets,
  preserveRefinements,
} from "../lib/refinement";
import {
  extractWorkflowReviewWithAI,
  resolveWorkflowReviewLocally,
  resolveWorkflowReviewWithAI,
} from "../lib/ai/provider";
import { createServer } from "node:http";
import { SqliteBusinessFlowRepository } from "../lib/storage/sqlite";

const detail = {
  system: "SAP 本番",
  module: "入力された領域",
  transaction: "Z_ORDER",
  hanaArea: "BUSINESS",
  objects: "ORDER_VIEW",
  evidence: "利用者の確認メモ",
};

test("grounded fallback distinguishes explicit internal automation from vague system use", () => {
  const review = extractGroundedLocal(
    "SAPが自動で在庫を引き当てる。SAPで受注を確認する。",
  );
  assert.equal(review.steps[0].executionMode, "automatic");
  assert.equal(review.steps[0].executingSystem, "SAP");
  assert.equal(review.steps[1].executionMode, "unknown");
  assert.equal(review.steps[1].executingSystem, null);
  assert.deepEqual(review.dataFlows, []);
});
function fixture() {
  const graph = createDemoGraph();
  graph.nodes.push({
    id: "system:sap-prod",
    canonicalKey: "system:sap-prod",
    kind: "system",
    label: "SAP 本番",
    description: "本番環境",
    status: "confirmed",
  });
  return graph;
}
function refinedReview(): ExtractionReview {
  const review = buildWorkflowReviewFromGraph(createDemoGraph(), "order");
  review.steps[0].technicalDetails = [detail];
  review.steps[0].detailSteps = [
    {
      id: "operation-1",
      action: "入力を確認",
      condition: "入力が揃った場合",
      evidence: "手動追記",
    },
  ];
  return review;
}

test("vague input stays grounded without invented owners, transactions or tables", () => {
  const review = extractGroundedLocal(
    "ERPで登録する。あとは担当の人がいい感じに処理する。",
  );
  assert.equal(review.steps.length, 2);
  assert.ok(
    review.steps.every(
      (step) =>
        step.actor === null &&
        step.technicalDetails?.length === 0 &&
        step.certainty === "inferred",
    ),
  );
  assert.equal(review.dataFlows.length, 0);
  assert.ok(review.questions.length);
});

test("technical labels are extracted only when stated, keeping ERP and SAP distinct", () => {
  const review = extractGroundedLocal(
    "SAPで登録、トランザクション: Z_ORDER、スキーマ: BUSINESS、ビュー: ORDER_VIEW。ERPで確認。",
  );
  assert.equal(review.steps[0].technicalDetails?.[0].transaction, "Z_ORDER");
  assert.equal(review.steps[0].technicalDetails?.[0].hanaArea, "BUSINESS");
  assert.equal(review.steps[1].systems[0].name, "ERP");
  assert.equal(review.steps[0].data.length, 0);
});

test("local extraction distinguishes explicitly named SAP environments", () => {
  const review = extractGroundedLocal(
    "SAP本番環境で登録する。SAP 開発で検証する。",
  );
  assert.equal(review.steps[0].systems[0].name, "SAP本番環境");
  assert.equal(review.steps[1].systems[0].name, "SAP 開発");
});

test("local re-extraction retains human edits without duplicating unchanged notes", () => {
  const notes = "ERPで登録する。担当が確認する。";
  const prior = extractGroundedLocal(notes);
  prior.steps[0].technicalDetails = [detail];
  const updated = extractGroundedLocal(notes, prior);
  assert.equal(updated.steps.length, 2);
  assert.deepEqual(updated.steps[0].technicalDetails, [detail]);
});

test("merge rewires all shared references without changing process identity or branches", () => {
  const graph = fixture();
  const before = structuredClone(graph);
  const merged = mergeAssets(graph, "system:erp", "system:sap-prod");
  assert.deepEqual(graph, before, "merge must be pure");
  assert.deepEqual(
    merged.nodes.filter((node) => node.kind === "process"),
    graph.nodes.filter((node) => node.kind === "process"),
  );
  assert.deepEqual(
    merged.edges.filter(
      (edge) => edge.relation === "next" && edge.source.startsWith("process:"),
    ),
    graph.edges.filter(
      (edge) => edge.relation === "next" && edge.source.startsWith("process:"),
    ),
  );
  assert.ok(
    !merged.edges.some(
      (edge) => edge.source === "system:erp" || edge.target === "system:erp",
    ),
  );
  assert.ok(
    merged.dataFlows.some((flow) => flow.targetSystemId === "system:sap-prod"),
  );
  assert.equal(
    findConfirmedAsset(merged, "system", "ＥＲＰ")?.id,
    "system:sap-prod",
  );
});

test("invalid or cross-kind merges are rejected; separate SAP environments stay separate", () => {
  const graph = fixture();
  assert.throws(() => mergeAssets(graph, "system:erp", "data:order"));
  assert.throws(() => mergeAssets(graph, "system:erp", "system:erp"));
  assert.throws(() => mergeAssets(graph, "missing", "system:erp"));
  assert.equal(findConfirmedAsset(graph, "system", "SAP 開発"), undefined);
});

test("alias ambiguity does not choose a canonical asset", () => {
  const graph = fixture();
  graph.nodes.find((node) => node.id === "system:sap-prod")!.aliases = ["ERP"];
  assert.equal(findConfirmedAsset(graph, "system", "ERP"), undefined);
  const result = resolveWorkflowReviewLocally({
    graph,
    workflow: graph.workflows[0],
    review: extractGroundedLocal("ERPで登録"),
  });
  assert.ok(
    result.patch.nodes.some(
      (node) =>
        node.kind === "system" &&
        node.status === "unknown" &&
        node.canonicalKey !== "system:erp",
    ),
  );
});

test("saving with an old alias reuses the confirmed asset without changing its name", () => {
  const graph = mergeAssets(fixture(), "system:erp", "system:sap-prod");
  const workflow = graph.workflows[0];
  const review = extractGroundedLocal("ERPで登録する。");
  const result = resolveWorkflowReviewLocally({ graph, workflow, review });
  const saved = replaceWorkflowGraph(graph, workflow, result.patch);
  assert.ok(!saved.nodes.some((node) => node.id === "system:erp"));
  assert.equal(
    saved.nodes.find((node) => node.id === "system:sap-prod")?.label,
    "SAP 本番",
  );
  assert.deepEqual(
    saved.nodes.find((node) => node.id === "system:sap-prod")?.aliases,
    ["ERP"],
  );
});

test("AI refinement retains human details and warns on conflicting details", () => {
  const previous = refinedReview();
  const raw = structuredClone(previous);
  raw.steps[0].technicalDetails = [{ ...detail, transaction: "Z_NEW" }];
  raw.steps[0].detailSteps = [
    { ...previous.steps[0].detailSteps![0], action: "AIの変更案" },
  ];
  const result = preserveRefinements(raw, previous);
  assert.equal(result.steps[0].technicalDetails?.length, 2);
  assert.equal(result.steps[0].detailSteps?.[0].action, "入力を確認");
  assert.ok(result.warnings.length >= 2);
});

test("AI omission cannot silently remove a step with manually recorded detail", () => {
  const previous = refinedReview();
  const result = preserveRefinements(
    { ...previous, steps: previous.steps.slice(1) },
    previous,
  );
  assert.ok(
    result.steps.some((step) => step.stepKey === previous.steps[0].stepKey),
  );
});

test("source correction updates AI-generated detail and execution context while keeping only the human-edited result", () => {
  const previous = extractGroundedLocal("営業担当がExcelで確認する。");
  previous.extraction = {
    method: "ai",
    provider: "codex-chatgpt:gpt-6-luna",
    model: "gpt-6-luna",
    completedAt: "2026-10-03T00:00:00Z",
  };
  previous.steps[0].detailSteps = [
    {
      id: "transfer",
      action: "Excelへ転記する",
      condition: null,
      evidence: "Excelで確認",
    },
  ];
  previous.steps[0].technicalDetails = [
    { ...detail, system: "Excel", transaction: null },
  ];
  previous.steps[0].executionContext = {
    trigger: "旧説明",
    rule: "旧規則",
    exception: "旧例外",
  };
  previous.steps[0].meaning = {
    purpose: "",
    basis: "在庫表",
    result: "人が不足数量を確定した",
    next: "",
    condition: "",
    halt: false,
    certainty: "confirmed",
    evidence: "人の補足",
  };
  previous.steps[0].humanEdits = [
    {
      field: "meaning.result",
      before: "",
      after: "人が不足数量を確定した",
      evidence: "利用者の訂正",
    },
  ];
  const raw = structuredClone(previous);
  raw.steps[0].systems = [
    { name: "SharePoint", interaction: "input", evidence: "SharePointに訂正" },
  ];
  raw.steps[0].detailSteps![0].action = "SharePointへ転記する";
  raw.steps[0].technicalDetails = [];
  raw.steps[0].executionContext = {
    trigger: "新説明",
    rule: "新規則",
    exception: "新例外",
  };
  raw.steps[0].meaning!.result = "新しい抽出案";
  const updated = preserveRefinements(raw, previous);
  assert.equal(updated.steps[0].detailSteps![0].action, "SharePointへ転記する");
  assert.deepEqual(updated.steps[0].technicalDetails, []);
  assert.equal(updated.steps[0].executionContext!.trigger, "新説明");
  assert.equal(updated.steps[0].meaning!.result, "人が不足数量を確定した");
  assert.equal(updated.steps[0].systems[0].name, "SharePoint");
});

test("removing source-derived detail does not retain an unedited AI step, but old details with unknown origin stay protected across revisions", () => {
  const source = refinedReview();
  source.extraction = {
    method: "ai",
    provider: "test",
    completedAt: "2026-10-03T00:00:00Z",
  };
  const omitted = { ...source, steps: source.steps.slice(1) };
  assert.ok(
    !preserveRefinements(omitted, source).steps.some(
      (s) => s.stepKey === source.steps[0].stepKey,
    ),
  );
  const legacy = refinedReview();
  const once = preserveRefinements(
    { ...legacy, extraction: source.extraction, steps: legacy.steps.slice(1) },
    legacy,
  );
  assert.ok(
    once.protectedDetails?.some((p) => p.stepKey === legacy.steps[0].stepKey),
  );
  const twice = preserveRefinements(
    {
      ...once,
      steps: once.steps.filter((s) => s.stepKey !== legacy.steps[0].stepKey),
    },
    once,
  );
  assert.ok(twice.steps.some((s) => s.stepKey === legacy.steps[0].stepKey));
});

test("saving technical details and child conditions reconstructs the same review", () => {
  const graph = createDemoGraph();
  const review = refinedReview();
  const workflow = graph.workflows[0];
  const { patch } = resolveWorkflowReviewLocally({ review, workflow, graph });
  const saved = replaceWorkflowGraph(graph, workflow, patch);
  const reconstructed = buildWorkflowReviewFromGraph(saved, workflow.id);
  assert.deepEqual(
    reconstructed.steps[0].technicalDetails,
    review.steps[0].technicalDetails,
  );
  assert.deepEqual(
    reconstructed.steps[0].detailSteps,
    review.steps[0].detailSteps,
  );
});

test("SQLite migrates an existing graph_nodes table and persists details, aliases, revisions", async () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "flow-lens-test-")),
    "legacy.sqlite",
  );
  const legacy = new DatabaseSync(path);
  legacy.exec(
    `CREATE TABLE graph_nodes (project_id TEXT NOT NULL, id TEXT NOT NULL, canonical_key TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL, workflow_id TEXT, actor TEXT, department TEXT, responsible_person TEXT, evidence TEXT, step_order INTEGER, action TEXT, PRIMARY KEY(project_id,id), UNIQUE(project_id,canonical_key));`,
  );
  legacy.close();
  const repository = new SqliteBusinessFlowRepository(path);
  const review = refinedReview();
  const base = mergeAssets(fixture(), "system:erp", "system:sap-prod");
  const { patch } = resolveWorkflowReviewLocally({
    review,
    workflow: base.workflows[0],
    graph: base,
  });
  const graph = replaceWorkflowGraph(base, base.workflows[0], patch);
  await repository.saveProject({
    projectId: "test",
    projectName: "Test",
    graph,
    transcripts: { order: "原文" },
    updatedAt: new Date().toISOString(),
  });
  const saved = (await repository.loadProject("test"))!;
  assert.equal(
    findConfirmedAsset(saved.graph, "system", "ERP")?.id,
    "system:sap-prod",
  );
  assert.deepEqual(
    buildWorkflowReviewFromGraph(saved.graph, "order").steps[0]
      .technicalDetails,
    [detail],
  );
  const revision = await repository.appendWorkflowRevision({
    projectId: "test",
    workflowId: "order",
    workflowName: "受注業務",
    sourceNotes: "原文",
    review,
    followUpAnswers: [],
    updatedBy: "test",
    createdAt: new Date().toISOString(),
  });
  assert.deepEqual(
    (await repository.getWorkflowRevision("test", revision.id))?.review.steps[0]
      .detailSteps,
    review.steps[0].detailSteps,
  );
});

test("saved questions, trigger/outcome and follow-up evidence survive reload", async () => {
  const repository = new SqliteBusinessFlowRepository(
    join(mkdtempSync(join(tmpdir(), "flow-lens-context-")), "test.sqlite"),
  );
  const graph = createDemoGraph();
  graph.workflows[0].reviewContext = {
    summary: "人が確認した業務の要約",
    trigger: "注文を受け取った時",
    outcome: "保存結果を確認した時",
    questions: [
      { question: "承認者は誰？", reason: "未確認", target: "owner" },
    ],
    warnings: ["承認者未確認"],
    followUpAnswers: [{ question: "担当は誰？", answer: "営業部" }],
    extraction: {
      method: "ai",
      provider: "codex-chatgpt:gpt-6-luna",
      model: "gpt-6-luna",
      completedAt: "2026-10-03T13:47:35Z",
    },
    protectedDetails: [{ stepKey: "receive-order", fields: ["detailSteps"] }],
  };
  await repository.saveProject({
    projectId: "test",
    projectName: "Test",
    graph,
    transcripts: {},
    updatedAt: new Date().toISOString(),
  });
  const loaded = (await repository.loadProject("test"))!;
  const review = buildWorkflowReviewFromGraph(loaded.graph, "order");
  assert.equal(review.summary, "人が確認した業務の要約");
  assert.equal(review.trigger, "注文を受け取った時");
  assert.equal(review.outcome, "保存結果を確認した時");
  assert.equal(review.questions[0].question, "承認者は誰？");
  assert.deepEqual(
    review.extraction,
    graph.workflows[0].reviewContext?.extraction,
  );
  assert.deepEqual(
    review.protectedDetails,
    graph.workflows[0].reviewContext?.protectedDetails,
  );
  assert.deepEqual(
    loaded.graph.workflows[0].reviewContext?.followUpAnswers,
    graph.workflows[0].reviewContext?.followUpAnswers,
  );
});

test("merge and SQLite reload retain transfers with different evidence or frequency", async () => {
  const repository = new SqliteBusinessFlowRepository(
    join(mkdtempSync(join(tmpdir(), "flow-lens-transfers-")), "test.sqlite"),
  );
  const graph = fixture();
  const first = graph.dataFlows[0];
  graph.dataFlows.push({
    ...first,
    id: "second-transfer",
    targetSystemId: "system:sap-prod",
    frequency: "毎日",
    evidence: "別の受け渡しの根拠",
  });
  const merged = mergeAssets(graph, "system:erp", "system:sap-prod");
  await repository.saveProject({
    projectId: "test",
    projectName: "Test",
    graph: merged,
    transcripts: {},
    updatedAt: new Date().toISOString(),
  });
  const loaded = (await repository.loadProject("test"))!;
  assert.equal(loaded.graph.dataFlows.length, merged.dataFlows.length);
  assert.ok(
    loaded.graph.dataFlows.some(
      (flow) =>
        flow.frequency === "毎日" && flow.evidence === "別の受け渡しの根拠",
    ),
  );
  assert.ok(
    loaded.graph.dataFlows.some((flow) => flow.evidence === first.evidence),
  );
});

for (const protocol of ["openai", "anthropic"] as const) {
  test(`${protocol} adapter sends detail schema, preserves human details and enforces confirmed alias reuse`, async () => {
    const graph = mergeAssets(fixture(), "system:erp", "system:sap-prod");
    const previous = refinedReview();
    previous.steps[0].meaning = {
      purpose: "転記の確認",
      basis: "承認済み記録",
      result: "人が確認した確定結果",
      next: "出荷へ渡す",
      condition: "承認後",
      halt: false,
      certainty: "confirmed",
      evidence: "担当者の補足",
    };
    previous.steps[0].humanEdits = [
      {
        field: "meaning.result",
        before: "",
        after: "人が確認した確定結果",
        evidence: "利用者の訂正",
      },
    ];
    const raw = structuredClone(previous);
    raw.steps[0].meaning!.result = "抽出の変更候補";
    raw.steps[0].technicalDetails = [];
    raw.steps[0].detailSteps = [];
    const calls: Record<string, any>[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      calls.push(body);
      const isResolution =
        JSON.stringify(body).includes("asset_resolution") ||
        String(body.system ?? "").includes("You resolve extracted");
      const output = JSON.stringify(isResolution ? { resolutions: [] } : raw);
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify(
          protocol === "openai"
            ? { choices: [{ message: { content: output } }] }
            : { content: [{ type: "text", text: output }] },
        ),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as { port: number };
    const envKeys = ["AI_BASE_URL", "AI_API_KEY", "AI_MODEL", "AI_PROTOCOL"];
    const saved = Object.fromEntries(
      envKeys.map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, {
      AI_BASE_URL: `http://127.0.0.1:${address.port}`,
      AI_API_KEY: "test-only",
      AI_MODEL: "mock",
      AI_PROTOCOL: protocol,
    });
    try {
      const extracted = await extractWorkflowReviewWithAI({
        interview: "ERPで登録",
        workflow: graph.workflows[0],
        graph,
        previousReview: previous,
      });
      assert.deepEqual(extracted.review.steps[0].technicalDetails, [detail]);
      assert.equal(
        extracted.review.steps[0].meaning?.result,
        "人が確認した確定結果",
      );
      assert.ok(
        extracted.review.warnings.some((w) => w.includes("利用者が訂正")),
      );
      const schema =
        protocol === "openai"
          ? calls[0].response_format.json_schema.schema
          : calls[0].output_config.format.schema;
      assert.ok(
        schema.properties.steps.items.required.includes("technicalDetails"),
      );
      assert.ok(schema.properties.steps.items.required.includes("detailSteps"));
      assert.ok(schema.properties.steps.items.required.includes("meaning"));
      assert.ok(
        schema.properties.steps.items.properties.meaning.required.includes(
          "result",
        ),
      );
      assert.ok(schema.required.includes("handoffs"));
      assert.ok(
        schema.properties.transitions.items.required.includes("certainty"),
      );
      const applied = await resolveWorkflowReviewWithAI({
        review: extractGroundedLocal("ERPで登録"),
        workflow: graph.workflows[0],
        graph,
      });
      assert.ok(
        applied.patch.nodes.some(
          (node) => node.canonicalKey === "system:sap-prod",
        ),
      );
      assert.ok(
        !applied.patch.nodes.some((node) => node.canonicalKey === "system:erp"),
      );
    } finally {
      for (const key of envKeys) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}
