import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { AIProviderError } from "./errors";

// Optional local model transport. The official app-server owns authentication;
// the application never reads, exports, or stores ChatGPT login credentials.
export async function callCodexModel<T>(args: {
  model: string;
  schema: unknown;
  system: string;
  user: string;
  timeoutMs: number;
}): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), "business-flow-ai-"));
  const child = spawn(
    process.env.AI_CODEX_COMMAND || "codex",
    ["app-server", "--listen", "stdio://"],
    {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  let termination: Promise<void> | undefined;
  const terminate = () =>
    (termination ??= (async () => {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid)
        return;
      if (process.platform === "win32") {
        // This PID belongs to the app-server started above. End its own helper
        // processes too; killing only the parent leaves Windows handles behind.
        await new Promise<void>((resolve) => {
          const killer = spawn(
            "taskkill",
            ["/PID", String(child.pid), "/T", "/F"],
            { windowsHide: true, stdio: "ignore", shell: false },
          );
          killer.once("error", () => {
            child.kill();
            resolve();
          });
          killer.once("exit", () => resolve());
        });
      } else child.kill();
    })());
  const lines = createInterface({ input: child.stdout });
  const pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  let nextId = 1;
  let resultText = "";
  let completed: (value: unknown) => void;
  let failed: (error: Error) => void;
  const completion = new Promise<unknown>((resolve, reject) => {
    completed = resolve;
    failed = reject;
  });
  // Observe the rejection even if a transport failure happens before turn/start.
  void completion.catch(() => {});
  const fail = (error: AIProviderError) => {
    for (const call of pending.values()) call.reject(error);
    pending.clear();
    failed(error);
  };
  const write = (message: unknown) =>
    child.stdin.write(`${JSON.stringify(message)}\n`);
  const request = (method: string, params: unknown) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      write({ id, method, params });
    });
  const timer = setTimeout(() => {
    fail(
      new AIProviderError(
        "timeout",
        "AIの応答待ちが時間切れになりました。メモと前の候補は残っています。もう一度整理できます。",
      ),
    );
    void terminate();
  }, args.timeoutMs);
  child.stderr.on("data", () => {});
  child.stdin.on("error", () =>
    fail(
      new AIProviderError(
        "network",
        "CodexのAI接続を開始できませんでした。ログイン状態を確認してください。メモと候補は残っています。",
      ),
    ),
  );
  child.on("error", () =>
    fail(
      new AIProviderError(
        "network",
        "Codex App Serverを起動できませんでした。Codexのインストールとログイン状態を確認してください。メモと候補は残っています。",
      ),
    ),
  );
  child.on("exit", () =>
    fail(
      new AIProviderError(
        "network",
        "AIの接続が終了しました。メモと前の候補は残っています。再試行できます。",
      ),
    ),
  );
  lines.on("line", (line) => {
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    // A server request can use its own ID sequence; handle it before matching
    // client response IDs, so a collision never bypasses the tool denial.
    if (message.id !== undefined && message.method) {
      write({
        id: message.id,
        error: {
          code: -32601,
          message: "Tools are disabled for workflow extraction.",
        },
      });
      fail(
        new AIProviderError(
          "provider",
          "AIが整理以外の操作を要求したため停止しました。メモと候補は残っています。",
        ),
      );
      void terminate();
      return;
    }
    if (
      message.method === "item/started" &&
      !["userMessage", "agentMessage", "reasoning"].includes(
        message.params?.item?.type,
      )
    ) {
      fail(
        new AIProviderError(
          "provider",
          "AIが整理以外の操作を始めようとしたため停止しました。メモと候補は残っています。",
        ),
      );
      void terminate();
      return;
    }
    const waiting = pending.get(message.id);
    if (waiting) {
      pending.delete(message.id);
      if (message.error)
        waiting.reject(
          new AIProviderError(
            "provider",
            "CodexがAIへの要求を受け付けませんでした。モデルとログイン状態を確認してください。メモと候補は残っています。",
          ),
        );
      else waiting.resolve(message.result);
      return;
    }
    if (
      message.method === "item/completed" &&
      message.params?.item?.type === "agentMessage"
    ) {
      const item = message.params.item;
      if (item.phase !== "commentary") resultText = item.text;
    }
    if (message.method === "turn/completed") {
      const turn = message.params?.turn;
      if (turn?.status !== "completed") {
        fail(
          new AIProviderError(
            "provider",
            "AIの整理が完了しませんでした。利用上限・モデル・ログイン状態を確認してください。メモと候補は残っています。",
          ),
        );
        return;
      }
      try {
        completed(JSON.parse(resultText));
      } catch {
        fail(
          new AIProviderError(
            "invalid_response",
            "AIの応答を構造として読み取れませんでした。メモと前の候補は残っています。再試行してください。",
          ),
        );
      }
    }
  });
  try {
    await request("initialize", {
      clientInfo: {
        name: "business_flow_lens",
        title: "BusinessFlowLens",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: true },
    });
    write({ method: "initialized" });
    const thread = await request("thread/start", {
      model: args.model,
      allowProviderModelFallback: false,
      ephemeral: true,
      cwd,
      sandbox: "read-only",
      approvalPolicy: "never",
      environments: [],
      dynamicTools: [],
      baseInstructions: args.system,
      developerInstructions:
        "Use only the supplied interview and reference candidates. Return the requested JSON. Do not use tools, inspect files, search the web, or delegate work.",
      config: {
        "features.shell_tool": false,
        "features.unified_exec": false,
        "features.multi_agent": false,
        "features.apps": false,
        "features.code_mode": false,
        "features.code_mode_host": false,
        web_search: "disabled",
        project_doc_max_bytes: 0,
      },
    });
    if (thread.model !== args.model) {
      throw new AIProviderError(
        "provider",
        "指定したAIモデルを利用できませんでした。別のモデルへ自動で切り替えず停止しました。",
      );
    }
    await request("turn/start", {
      threadId: thread.thread.id,
      model: args.model,
      effort: process.env.AI_REASONING_EFFORT || "medium",
      environments: [],
      input: [{ type: "text", text: args.user }],
      outputSchema: args.schema,
    });
    return (await completion) as T;
  } finally {
    clearTimeout(timer);
    lines.close();
    await terminate();
    child.stdin.end();
    await closed;
    const temporaryName = relative(tmpdir(), cwd);
    if (
      !isAbsolute(temporaryName) &&
      temporaryName.startsWith("business-flow-ai-") &&
      !temporaryName.includes("..")
    ) {
      // Windows can briefly retain handles after app-server exits. Cleanup must
      // not turn a completed model response into an extraction failure.
      await rm(cwd, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      }).catch(() => {});
    }
  }
}
