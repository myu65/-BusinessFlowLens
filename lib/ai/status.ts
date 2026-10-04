export type AIConfigurationStatus = {
  configured: boolean;
  protocol: "openai" | "anthropic";
  runtime?: "api" | "codex";
  model: string | null;
  missing: Array<"endpoint" | "model" | "credential">;
};

export function aiStatusLabel(
  config: AIConfigurationStatus | null,
  response: "unchecked" | "success" | "failure" | "unusable",
) {
  if (!config) return "AI設定を確認中";
  if (!config.configured) return "AI未接続 · 簡易整理";
  if (response === "success") return "AIの応答を確認しました";
  if (response === "unusable") return "AIの応答を整理できませんでした";
  if (response === "failure") return "AIから応答を得られませんでした";
  return "AI設定あり · 応答は未確認";
}
