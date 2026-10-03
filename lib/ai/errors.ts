export class AIProviderError extends Error {
  constructor(
    public readonly code:
      | "timeout"
      | "authentication"
      | "rate_limit"
      | "provider"
      | "network"
      | "invalid_response",
    message: string,
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

export function safeAIError(error: unknown, fallback: string) {
  return error instanceof AIProviderError
    ? { error: error.message, code: error.code }
    : { error: fallback, code: "failed" };
}
