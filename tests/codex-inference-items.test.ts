import test from "node:test";
import assert from "node:assert/strict";
import { isInferenceOnlyItem } from "../lib/ai/codex";

test("internal text planning and compaction can precede the structured answer", () => {
  for (const type of ["userMessage", "reasoning", "plan", "contextCompaction", "agentMessage"])
    assert.equal(isInferenceOnlyItem(type), true);
});

test("commands, file access, external tools, delegation, search and unknown items remain blocked", () => {
  for (const type of ["commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "collabAgentToolCall", "subAgentActivity", "webSearch", "imageView", "imageGeneration", "sleep", "enteredReviewMode", "hookPrompt", "functionCallOutput", "newTool", undefined, null, { type: "agentMessage" }])
    assert.equal(isInferenceOnlyItem(type), false);
});
