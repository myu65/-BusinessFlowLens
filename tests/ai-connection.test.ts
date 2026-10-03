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
import type { LensGraph } from "../lib/graph";

const empty: LensGraph = { workflows: [], nodes: [], edges: [], dataFlows: [] };
const workflow = { id: "new", name: "入力した話" };

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
        AI_TIMEOUT_MS: "100",
      },
      async () => {
        for (const [mode, code] of [
          ["authentication", "authentication"],
          ["timeout", "timeout"],
          ["empty", "invalid_response"],
          ["malformed", "invalid_response"],
        ]) {
          behavior = mode;
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
  });
});
