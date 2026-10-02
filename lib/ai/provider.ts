import { existsSync, readFileSync } from "node:fs";
import type {
  GraphPatch,
  GraphPatchEdge,
  GraphPatchNode,
  LensGraph,
  Workflow,
} from "@/lib/graph";

type AIProtocol = "openai" | "anthropic";
type AuthMode = "bearer" | "x-api-key";

const GRAPH_PATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          canonicalKey: { type: "string" },
          kind: { type: "string", enum: ["process", "system", "data"] },
          label: { type: "string" },
          description: { type: "string" },
          status: {
            type: "string",
            enum: ["confirmed", "inferred", "unknown"],
          },
          actor: { type: ["string", "null"] },
          evidence: { type: ["string", "null"] },
        },
        required: [
          "canonicalKey",
          "kind",
          "label",
          "description",
          "status",
          "actor",
          "evidence",
        ],
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sourceKey: { type: "string" },
          targetKey: { type: "string" },
          relation: {
            type: "string",
            enum: ["next", "uses", "reads", "writes", "sends"],
          },
          label: { type: ["string", "null"] },
        },
        required: ["sourceKey", "targetKey", "relation", "label"],
      },
    },
    questions: {
      type: "array",
      items: { type: "string" },
      maxItems: 5,
    },
  },
  required: ["nodes", "edges", "questions"],
} as const;

function env(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

const SNOWFLAKE_SESSION_TOKEN = "/snowflake/session/token";

function runtimeTokenAvailable() {
  return existsSync(SNOWFLAKE_SESSION_TOKEN);
}

function resolveBaseURL() {
  const configured = env("AI_BASE_URL");
  if (configured) return configured;

  const host = env("SNOWFLAKE_HOST");
  if (!host) return undefined;

  const target = env("AI_TARGET") === "gateway" ? "gateway" : "cortex";
  return target === "gateway"
    ? `https://${host}/api/v2/aigateways/SNOWFLAKE/v1`
    : `https://${host}/api/v2/cortex/v1`;
}

function resolveToken() {
  if (runtimeTokenAvailable()) {
    // Snowflake rotates this token. Read it on every request.
    return readFileSync(SNOWFLAKE_SESSION_TOKEN, "utf8").trim();
  }

  return env("AI_API_KEY");
}

export function hasAIConfig() {
  return Boolean(
    resolveBaseURL() &&
      env("AI_MODEL") &&
      (runtimeTokenAvailable() || env("AI_API_KEY")),
  );
}

function protocol(): AIProtocol {
  return env("AI_PROTOCOL") === "anthropic" ? "anthropic" : "openai";
}

function endpoint(baseURL: string, mode: AIProtocol) {
  const base = baseURL.replace(/\/$/, "");
  const path = mode === "openai" ? "/chat/completions" : "/messages";
  return base.endsWith(path) ? base : `${base}${path}`;
}

function authHeaders(apiKey: string, mode: AIProtocol): HeadersInit {
  const authMode = (env("AI_AUTH_MODE") ?? "bearer") as AuthMode;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (authMode === "x-api-key") {
    headers["x-api-key"] = apiKey;
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  if (mode === "anthropic") {
    headers["anthropic-version"] =
      env("AI_ANTHROPIC_VERSION") ?? "2023-06-01";
  }

  return headers;
}

function compactGraph(graph: LensGraph) {
  return {
    workflows: graph.workflows,
    nodes: graph.nodes.map((node) => ({
      canonicalKey: node.canonicalKey,
      kind: node.kind,
      label: node.label,
      workflowId: node.workflowId,
    })),
  };
}

function systemPrompt(workflow: Workflow) {
  return `You extract a business architecture graph from an interview.

The graph has three node kinds:
- process: a human or operational activity. Process nodes belong to the current workflow.
- system: an application, tool, service, spreadsheet, channel, or platform. System nodes are canonical shared entities across workflows.
- data: a business data object, document, dataset, master, transaction, or record. Data nodes are canonical shared entities across workflows.

Important identity rules:
1. Reuse an existing canonicalKey when the interview refers to the same system or data concept already present in the project.
2. System/data canonical keys MUST NOT include the workflow id. Examples: system:erp, system:sap-s4, data:customer, data:order.
3. Process canonical keys should be scoped to the current workflow using process:${workflow.id}:<short-slug>.
4. Do not invent a new system merely because an activity exists. If the system is unclear, either omit it or add an unknown system node only when that uncertainty itself is useful.
5. Distinguish confirmed statements from reasonable inference using status=confirmed or inferred. Use unknown only for an explicitly represented gap.
6. Evidence should briefly state what in the interview supports the node.
7. Prefer a small, legible graph over exhaustive sentence-level decomposition.

Relations:
- next: process sequence
- uses: a process uses a system
- reads: a process/system reads data
- writes: a process/system writes data
- sends: information/document is sent to a process/system

Return only data matching the supplied JSON schema.`;
}

function userPrompt(
  interview: string,
  workflow: Workflow,
  graph: LensGraph,
) {
  return `Current workflow:
${JSON.stringify(workflow, null, 2)}

Existing project graph (use this for entity resolution):
${JSON.stringify(compactGraph(graph), null, 2)}

Interview:
---
${interview}
---

Extract the graph patch for this workflow. Also generate the most useful follow-up questions for missing systems, data ownership, handoffs, duplicate entry, or unclear integration.`;
}

function isPatch(value: unknown): value is GraphPatch {
  if (!value || typeof value !== "object") return false;
  const patch = value as Partial<GraphPatch>;
  return (
    Array.isArray(patch.nodes) &&
    Array.isArray(patch.edges) &&
    Array.isArray(patch.questions)
  );
}

function normalizePatch(patch: GraphPatch): GraphPatch {
  return {
    nodes: patch.nodes.filter(
      (node): node is GraphPatchNode =>
        Boolean(
          node &&
            node.canonicalKey &&
            node.kind &&
            node.label &&
            node.description &&
            node.status,
        ),
    ),
    edges: patch.edges.filter(
      (edge): edge is GraphPatchEdge =>
        Boolean(edge && edge.sourceKey && edge.targetKey && edge.relation),
    ),
    questions: patch.questions.filter(
      (question) => typeof question === "string" && question.trim().length > 0,
    ),
  };
}

export async function extractGraphWithAI(args: {
  interview: string;
  workflow: Workflow;
  graph: LensGraph;
}): Promise<{ patch: GraphPatch; provider: string }> {
  const baseURL = resolveBaseURL();
  const model = env("AI_MODEL");
  const apiKey = resolveToken();

  if (!baseURL || !model || !apiKey) {
    throw new Error(
      "AI provider is not configured. Set AI_MODEL and either run in Snowflake App Runtime or provide AI_BASE_URL/AI_API_KEY.",
    );
  }

  const mode = protocol();
  const url = endpoint(baseURL, mode);

  const body =
    mode === "openai"
      ? {
          model,
          messages: [
            { role: "system", content: systemPrompt(args.workflow) },
            {
              role: "user",
              content: userPrompt(
                args.interview,
                args.workflow,
                args.graph,
              ),
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "business_flow_patch",
              schema: GRAPH_PATCH_SCHEMA,
            },
          },
        }
      : {
          model,
          max_tokens: 4096,
          system: systemPrompt(args.workflow),
          messages: [
            {
              role: "user",
              content: userPrompt(
                args.interview,
                args.workflow,
                args.graph,
              ),
            },
          ],
          output_config: {
            format: {
              type: "json_schema",
              schema: GRAPH_PATCH_SCHEMA,
            },
          },
        };

  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders(apiKey, mode),
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `AI provider returned ${response.status}: ${detail.slice(0, 500)}`,
    );
  }

  const payload = await response.json();

  const text =
    mode === "openai"
      ? payload?.choices?.[0]?.message?.content
      : payload?.content?.find?.(
          (part: { type?: string }) => part?.type === "text",
        )?.text;

  if (typeof text !== "string") {
    throw new Error("AI provider response did not contain text output.");
  }

  const parsed = JSON.parse(text);
  if (!isPatch(parsed)) {
    throw new Error("AI provider returned an invalid graph patch.");
  }

  return {
    patch: normalizePatch(parsed),
    provider: `${mode}-compatible:${model}`,
  };
}
