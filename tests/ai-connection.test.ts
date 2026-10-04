import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  getAIConfigurationStatus,
  extractWorkflowReviewWithAI,
  resolveWorkflowReviewWithAI,
} from "../lib/ai/provider";
import { aiStatusLabel } from "../lib/ai/status";
import { AIProviderError, safeAIError } from "../lib/ai/errors";
import { extractGroundedLocal } from "../lib/local-review";
import type { ExtractionReview, LensGraph } from "../lib/graph";
import { previewReviewGraph } from "../lib/review-workbench";
import { knowledgeIndex } from "../lib/knowledge";

const empty: LensGraph = { workflows: [], nodes: [], edges: [], dataFlows: [] };
const workflow = { id: "new", name: "入力した話" };

test("a short addition sends neighboring work as context without treating it as evidence for new facts", async () => {
  const source = '営業企画担当がExcelで「価格案」を保存する。';
  const existingFact = 'TeamsはEntra IDのSSOを使います。';
  const draft: ExtractionReview = { ...extractGroundedLocal(source), systemDependencies: [{ system: "Teams", prerequisite: "Entra ID", reason: "SSO", evidence: existingFact, certainty: "confirmed" }] };
  let sent = "";
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    sent = JSON.parse(Buffer.concat(chunks).toString()).messages.at(-1).content;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(draft) } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await withConfig({ AI_MODEL: "mock", AI_API_KEY: "test-only", AI_BASE_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}` }, async () => {
      const result = await extractWorkflowReviewWithAI({ interview: source, workflow, graph: empty, additionContext: {
        before: { name: "価格案を作る", actor: "営業企画担当", result: existingFact, data: [{ name: "価格案", operation: "create" }] },
        after: { name: "営業部長が承認する", actor: "営業部長", result: "価格案の承認", data: [] },
      } });
      assert.match(sent, /価格案を作る/);
      assert.match(sent, /営業部長が承認する/);
      assert.ok(!result.review.systemDependencies?.some(d => d.certainty === "confirmed"));
      assert.equal(result.review.steps.length, 1);
      assert.equal(result.review.steps[0].evidence, draft.steps[0].evidence);
      assert.ok(source.includes(result.review.steps[0].evidence));
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("the AI adapter separates a runtime specification and registration values before constructing structure", async () => {
  const registration = "情報システム担当がネットワーク管理システムへVPN利用者を登録します。";
  const specification = "VPNはログイン時にEntra IDの認証を使います。";
  const testAction = "情報システム担当が接続テストを確認します。";
  const base = extractGroundedLocal("担当が確認する。").steps[0];
  const draft = { summary: "接続の設定", trigger: null, outcome: null, questions: [], warnings: [], dataFlows: [],
    steps: [
      { ...base, stepKey: "register", name: "利用者を登録する", action: "VPN利用者を登録する", order: 1, evidence: registration,
        data: [{ name: "VPN利用者", operation: "create", evidence: "VPN利用者を登録" }] },
      { ...base, stepKey: "spec", name: "認証を使う", action: "VPNでEntra IDの認証を使う", order: 2, evidence: specification,
        actor: null, responsiblePerson: null, executingSystem: null, executionMode: "unknown",
        systems: [{ name: "VPN", interaction: "other", evidence: specification }, { name: "Entra ID", interaction: "other", evidence: specification }], data: [] },
      { ...base, stepKey: "test", name: "接続テストを確認する", action: "接続テストを確認する", order: 3, evidence: testAction, data: [] },
    ], transitions: [{ fromStepKey: "register", toStepKey: "spec", condition: null, evidence: specification },
      { fromStepKey: "spec", toStepKey: "test", condition: null, evidence: specification }],
  };
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(draft) } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await withConfig({ AI_MODEL: "mock", AI_API_KEY: "test-only", AI_BASE_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}` }, async () => {
      const result = await extractWorkflowReviewWithAI({ interview: registration + specification + testAction, workflow, graph: empty });
      assert.deepEqual(result.review.steps.map(s => s.stepKey), ["register", "test"]);
      assert.equal(result.review.transitions.length, 0);
      assert.equal(result.review.steps[0].data[0].operation, "read");
      assert.equal(result.review.systemDependencies![0].evidence, specification);
      assert.equal(result.review.systemDependencies![0].certainty, "confirmed");
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("an AI dependency-only explanation becomes platform structure, while an ungrounded zero-task result is rejected", async () => {
  const source = "TeamsはEntra IDのSSOを使います。";
  const draft = { summary: source, trigger: null, outcome: null, steps: [], transitions: [], dataFlows: [], questions: [], warnings: [], systemDependencies: [{ system: "Teams", prerequisite: "Entra ID", reason: "SSO認証", evidence: source, certainty: "confirmed" }] };
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const output = body.response_format.json_schema.name === "workflow_draft" ? draft : {
      resolutions: JSON.parse(body.messages.at(-1).content.split("\n")[1]).candidates.map((c: { candidateId: string; name: string }) => ({ candidateId: c.candidateId, decision: "create", existingCanonicalKey: null, canonicalLabel: c.name, reason: "new named tool" })),
    };
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  try {
    await withConfig({ AI_MODEL: "mock", AI_API_KEY: "test-only", AI_BASE_URL: `http://127.0.0.1:${address.port}` }, async () => {
      const extracted = await extractWorkflowReviewWithAI({ interview: source, workflow, graph: empty });
      assert.equal(extracted.review.steps.length, 0);
      const resolved = await resolveWorkflowReviewWithAI({ review: extracted.review, workflow, graph: empty });
      assert.deepEqual(resolved.patch.nodes.map(n => n.label).sort(), ["Entra ID", "Teams"]);
      assert.equal(resolved.patch.edges.length, 0);
      const graph = previewReviewGraph(empty, workflow, resolved.review);
      const teams = graph.nodes.find(n => n.label === "Teams")!;
      assert.equal(knowledgeIndex(graph, "current").systemProfile(teams.id).profile!.dependsOn.length, 1);
      await assert.rejects(extractWorkflowReviewWithAI({ interview: "Teamsだけを使います。", workflow, graph: empty }), (error: unknown) => error instanceof AIProviderError && error.code === "invalid_response");
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

async function withConfig(
  values: Record<string, string | undefined>,
  run: () => Promise<void>,
) {
  const keys = [
    "AI_RUNTIME",
    "AI_MODEL",
    "AI_BASE_URL",
    "AI_API_KEY",
    "AI_PROTOCOL",
    "AI_TIMEOUT_MS",
    "SNOWFLAKE_HOST",
  ];
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    await run();
  } finally {
    for (const key of keys)
      before[key] === undefined
        ? delete process.env[key]
        : (process.env[key] = before[key]);
  }
}

test("configuration, actual response, and quality review remain separate; no endpoint or credential is returned", async () => {
  await withConfig(
    { AI_RUNTIME: "codex", AI_MODEL: "gpt-6-luna" },
    async () => {
      const status = getAIConfigurationStatus();
      assert.equal(status.configured, true);
      assert.equal(status.runtime, "codex");
      assert.equal(
        aiStatusLabel(status, "unchecked"),
        "AI設定あり · 応答は未確認",
      );
      assert.equal(aiStatusLabel(status, "success"), "AIの応答を確認しました");
      assert.equal(aiStatusLabel(status, "unusable"), "AIの応答を整理できませんでした");
      assert.equal(
        aiStatusLabel(status, "failure"),
        "AIから応答を得られませんでした",
      );
      assert.ok(!JSON.stringify(status).includes("AI_API_KEY"));
    },
  );
  await withConfig({}, async () => {
    const status = getAIConfigurationStatus();
    assert.equal(status.configured, false);
    assert.deepEqual(status.missing, ["endpoint", "model", "credential"]);
    assert.equal(aiStatusLabel(status, "unchecked"), "AI未接続 · 簡易整理");
  });
});

test("an intent-only AI review keeps questions and no invented assets, then accepts a concrete follow-up", async () => {
  const source = "購買の仕事を整理したいです。順番も担当も道具もまだ分かりません。";
  const question = { question: "最初にどんな話や情報が届くか、知っていることはありますか？", reason: "具体的な作業がまだ説明されていないため。", target: "scope" as const };
  const initial: ExtractionReview = { summary: "購買の仕事について整理したいが、作業内容はまだ分からない。", trigger: null, outcome: null,
    steps: [], transitions: [], dataFlows: [], questions: [question], warnings: [] };
  const fact = "購買担当がメールで原料の見積依頼を受け取る。";
  const followUp = { question: question.question, answer: fact };
  let draft = initial;
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(draft) } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await withConfig({ AI_MODEL: "mock", AI_API_KEY: "test-only", AI_BASE_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}` }, async () => {
      const extracted = await extractWorkflowReviewWithAI({ interview: source, workflow, graph: empty });
      assert.deepEqual(extracted.review.questions, [question]);
      assert.deepEqual(extracted.review.steps, []);
      const resolved = await resolveWorkflowReviewWithAI({ review: extracted.review, workflow, graph: empty });
      assert.deepEqual(resolved.patch, { nodes: [], edges: [], dataFlows: [], questions: [question.question] });
      const preview = previewReviewGraph(empty, workflow, extracted.review);
      assert.equal(preview.workflows.length, 1);
      assert.equal(preview.nodes.length, 0);
      assert.deepEqual(preview.workflows[0].reviewContext!.questions, [question]);
      draft = { ...initial, steps: extractGroundedLocal(fact).steps, questions: [] };
      const continued = await extractWorkflowReviewWithAI({ interview: source, workflow, graph: empty, previousReview: extracted.review, followUpAnswers: [followUp] });
      assert.equal(continued.review.steps.length, 1);
      assert.equal(continued.review.steps[0].evidence, fact.replace(/。$/, ""));
      assert.equal(continued.review.questions.length, 0);
      assert.deepEqual(continued.followUpAnswers, [followUp]);
      assert.equal(extracted.review.steps.length, 0);
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("provider failure, timeout and malformed output do not become a local extraction or expose provider details", async () => {
  let behavior = "authentication";
  const server = createServer((_request, response) => {
    if (behavior === "timeout") return;
    if (behavior === "authentication") {
      response.writeHead(401);
      response.end("secret-key and private memo echoed by provider");
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                behavior === "empty"
                  ? '{"steps":[]}'
                  : '{"steps":[{"name":123}]}',
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  try {
    await withConfig(
      {
        AI_MODEL: "mock",
        AI_API_KEY: "secret-key",
        AI_BASE_URL: `http://127.0.0.1:${address.port}`,
        AI_TIMEOUT_MS: "5000",
      },
      async () => {
        for (const [mode, code] of [
          ["authentication", "authentication"],
          ["timeout", "timeout"],
          ["empty", "invalid_response"],
          ["malformed", "invalid_response"],
        ]) {
          behavior = mode;
          // Only the stalled response uses a short deadline. Under parallel CI
          // load, a valid local 401 must not race an unrelated timeout assertion.
          process.env.AI_TIMEOUT_MS = mode === "timeout" ? "100" : "5000";
          await assert.rejects(
            extractWorkflowReviewWithAI({
              interview: "注文が届く",
              workflow,
              graph: empty,
            }),
            (error: unknown) => {
              assert.ok(error instanceof AIProviderError);
              assert.equal(error.code, code);
              assert.ok(
                !JSON.stringify(safeAIError(error, "failed")).includes(
                  "secret-key",
                ),
              );
              assert.ok(!error.message.includes("private memo"));
              return true;
            },
          );
        }
      },
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("saving confirmed exact assets needs no model call, while preserving original extraction provenance", async () => {
  const graph: LensGraph = {
    ...empty,
    nodes: [
      {
        id: "system:excel",
        canonicalKey: "system:excel",
        kind: "system",
        label: "Excel",
        description: "",
        status: "confirmed",
      },
    ],
  };
  const review = extractGroundedLocal("担当者がExcelで確認する。");
  review.extraction = {
    method: "ai",
    provider: "codex-chatgpt:gpt-6-luna",
    model: "gpt-6-luna",
    completedAt: "2026-10-03T00:00:00.000Z",
  };
  await withConfig({}, async () => {
    const result = await resolveWorkflowReviewWithAI({
      review,
      workflow,
      graph,
    });
    assert.ok(
      result.patch.nodes.some((n) => n.canonicalKey === "system:excel"),
    );
    assert.deepEqual(result.review.extraction, review.extraction);
    for (const status of ["inferred", "unknown"] as const) {
      graph.nodes[0].status = status;
      await assert.rejects(
        resolveWorkflowReviewWithAI({ review, workflow, graph }),
      );
    }
  });
});

test("a model cannot reuse a future-only asset omitted from the current comparison scope", async () => {
  let compared: string[] = [];
  const graph: LensGraph = {
    workflows: [{ id: "current", name: "現在" }, { id: "future", name: "将来", scenario: "future" }],
    nodes: [
      { id: "now", canonicalKey: "data:now", kind: "data", label: "現在の注文記録", description: "", status: "confirmed" },
      { id: "later", canonicalKey: "data:future", kind: "data", label: "将来の注文メモ", description: "", status: "confirmed" },
    ],
    edges: [
      { id: "now", source: "p-now", target: "now", relation: "reads", workflowIds: ["current"] },
      { id: "future", source: "p-future", target: "later", relation: "reads", workflowIds: ["future"] },
    ],
    dataFlows: [],
  };
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const context = JSON.parse(body.messages.at(-1).content.split("\n")[1]);
    compared = context.catalog.map((n: { canonicalKey: string }) => n.canonicalKey);
    const resolutions = context.candidates.map((c: { candidateId: string; kind: string; name: string }) => ({
      candidateId: c.candidateId,
      decision: c.kind === "data" ? "reuse" : "create",
      existingCanonicalKey: c.kind === "data" ? "data:future" : null,
      canonicalLabel: c.name,
      reason: "mock attempt to cross the scope",
    }));
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ resolutions }) } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  try {
    await withConfig({ AI_MODEL: "mock", AI_API_KEY: "test-only", AI_BASE_URL: `http://127.0.0.1:${address.port}` }, async () => {
      const review = extractGroundedLocal('担当者がExcelに「注文メモ」を記録する。');
      const result = await resolveWorkflowReviewWithAI({ review, workflow, graph });
      assert(!compared.includes("data:future"));
      assert(!result.patch.nodes.some(n => n.canonicalKey === "data:future"));
      assert(result.patch.nodes.some(n => n.kind === "data" && n.status === "unknown"));
      assert(result.review.warnings.some(w => w.includes("同一性を要確認")));
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("a referenced answer is read for its question before extracting the workflow; source history stays literal", async () => {
  const source = "購買担当がExcelへCSVを出す。購買担当がTeamsで回答する。";
  const quote = "購買担当がTeamsで回答する";
  const answer = { question: "誰がどの方法で回答しますか？", answer: source,
    reference: { workflowId: "purchase", workflowName: "原料の購買", usedAt: "2026-10-04T00:00:00Z" } };
  const calls: Array<{ response_format: { json_schema: { name: string } }; messages: Array<{ content: string }> }> = [];
  const draft = extractGroundedLocal("生産計画担当がSAPへ必要量を登録する。");
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    calls.push(body);
    const output = body.response_format.json_schema.name === "reference_question_reading"
      ? { facts: [{ text: "購買担当がTeamsで回答する。", evidenceIds: [1], certainty: "explicit" }], unanswered: [] }
      : draft;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  try {
    await withConfig({ AI_MODEL: "mock", AI_API_KEY: "test-only", AI_BASE_URL: `http://127.0.0.1:${address.port}` }, async () => {
      const result = await extractWorkflowReviewWithAI({ interview: "生産計画担当がSAPへ必要量を登録する。", workflow, graph: empty, followUpAnswers: [answer] });
      assert.deepEqual(calls.map(call => call.response_format.json_schema.name), ["reference_question_reading", "workflow_draft"]);
      assert(calls[0].messages.at(-1)!.content.includes("CSV"));
      assert(!calls[1].messages.at(-1)!.content.includes("CSV"));
      assert(calls[1].messages.at(-1)!.content.includes(quote));
      assert.equal(result.followUpAnswers![0].answer, source);
      assert.deepEqual(result.followUpAnswers![0].reference, answer.reference);
      assert.equal(result.followUpAnswers![0].referenceReading!.model, "mock");
      assert(!("referenceReading" in answer));
      await extractWorkflowReviewWithAI({ interview: "生産計画担当がSAPへ必要量を登録する。", workflow, graph: empty, followUpAnswers: result.followUpAnswers });
      assert.equal(calls.length, 3);
      assert.equal(calls[2].response_format.json_schema.name, "workflow_draft");
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
