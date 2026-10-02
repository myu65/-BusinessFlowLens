import { existsSync, readFileSync } from "node:fs";
import type {
  Confidence,
  ExtractionQuestion,
  ExtractionResult,
  FollowUpAnswer,
  ExtractionReview,
  ExtractionReviewStep,
  GraphPatch,
  GraphPatchEdge,
  GraphPatchNode,
  LensGraph,
  NodeKind,
  Relation,
  Workflow,
} from "@/lib/graph";

type AIProtocol = "openai" | "anthropic";
type AuthMode = "bearer" | "x-api-key";

type DraftTransition = {
  fromStepKey: string;
  toStepKey: string;
  condition: string | null;
  evidence: string;
};

type WorkflowDraft = ExtractionReview & {
  transitions: DraftTransition[];
};

type AssetCandidate = {
  candidateId: string;
  kind: "system" | "data";
  name: string;
  evidence: string[];
  certainty: "explicit" | "inferred";
};

type AssetResolution = {
  candidateId: string;
  decision: "reuse" | "create" | "uncertain";
  existingCanonicalKey: string | null;
  canonicalLabel: string;
  reason: string;
};

const WORKFLOW_DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    trigger: { type: ["string", "null"] },
    outcome: { type: ["string", "null"] },
    steps: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          stepKey: { type: "string" },
          name: { type: "string" },
          order: { type: "integer" },
          actor: { type: ["string", "null"] },
          department: { type: ["string", "null"] },
          responsiblePerson: { type: ["string", "null"] },
          executionMode: {
            type: "string",
            enum: ["manual", "automatic", "mixed", "unknown"],
          },
          executingSystem: { type: ["string", "null"] },
          action: { type: "string" },
          certainty: {
            type: "string",
            enum: ["explicit", "inferred"],
          },
          evidence: { type: "string" },
          systems: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                interaction: {
                  type: "string",
                  enum: [
                    "view",
                    "search",
                    "input",
                    "approve",
                    "send",
                    "receive",
                    "other",
                  ],
                },
                evidence: { type: "string" },
              },
              required: ["name", "interaction", "evidence"],
            },
          },
          data: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                operation: {
                  type: "string",
                  enum: ["read", "create", "update", "send", "receive"],
                },
                evidence: { type: "string" },
              },
              required: ["name", "operation", "evidence"],
            },
          },
        },
        required: [
          "stepKey",
          "name",
          "order",
          "actor",
          "department",
          "responsiblePerson",
          "executionMode",
          "executingSystem",
          "action",
          "certainty",
          "evidence",
          "systems",
          "data",
        ],
      },
    },
    transitions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          fromStepKey: { type: "string" },
          toStepKey: { type: "string" },
          condition: { type: ["string", "null"] },
          evidence: { type: "string" },
        },
        required: [
          "fromStepKey",
          "toStepKey",
          "condition",
          "evidence",
        ],
      },
    },
    dataFlows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sourceSystem: { type: "string" },
          targetSystem: { type: "string" },
          data: {
            type: "array",
            items: { type: "string" },
          },
          transferType: {
            type: "string",
            enum: [
              "api",
              "file",
              "database",
              "message",
              "email",
              "manual",
              "unknown",
            ],
          },
          direction: {
            type: "string",
            enum: ["push", "pull", "bidirectional", "unknown"],
          },
          automation: {
            type: "string",
            enum: ["automatic", "manual", "mixed", "unknown"],
          },
          frequency: { type: ["string", "null"] },
          evidence: { type: "string" },
          certainty: {
            type: "string",
            enum: ["explicit", "inferred"],
          },
          relatedStepKeys: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: [
          "sourceSystem",
          "targetSystem",
          "data",
          "transferType",
          "direction",
          "automation",
          "frequency",
          "evidence",
          "certainty",
          "relatedStepKeys",
        ],
      },
    },
    questions: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string" },
          reason: { type: "string" },
          target: {
            type: "string",
            enum: [
              "system",
              "data",
              "handoff",
              "rule",
              "owner",
              "exception",
              "scope",
            ],
          },
        },
        required: ["question", "reason", "target"],
      },
    },
    warnings: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
    },
  },
  required: [
    "summary",
    "trigger",
    "outcome",
    "steps",
    "transitions",
    "dataFlows",
    "questions",
    "warnings",
  ],
} as const;

const ASSET_RESOLUTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    resolutions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          candidateId: { type: "string" },
          decision: {
            type: "string",
            enum: ["reuse", "create", "uncertain"],
          },
          existingCanonicalKey: { type: ["string", "null"] },
          canonicalLabel: { type: "string" },
          reason: { type: "string" },
        },
        required: [
          "candidateId",
          "decision",
          "existingCanonicalKey",
          "canonicalLabel",
          "reason",
        ],
      },
    },
  },
  required: ["resolutions"],
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

async function structuredCall<T>(args: {
  schemaName: string;
  schema: unknown;
  system: string;
  user: string;
}): Promise<T> {
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
            { role: "system", content: args.system },
            { role: "user", content: args.user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: args.schemaName,
              schema: args.schema,
            },
          },
        }
      : {
          model,
          max_tokens: 8192,
          system: args.system,
          messages: [{ role: "user", content: args.user }],
          output_config: {
            format: {
              type: "json_schema",
              schema: args.schema,
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
      `AI provider returned ${response.status}: ${detail.slice(0, 700)}`,
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

  return JSON.parse(text) as T;
}

function extractionSystemPrompt() {
  return `You are a senior business analyst turning an interview transcript into a precise workflow draft.

Your first job is NOT to build a knowledge graph and NOT to normalize entities. Your job is to faithfully extract what the interview actually says.

Rules:
1. Preserve business meaning. Prefer 3-10 meaningful business steps, not sentence fragments.
2. A step is an activity with an actor/action/outcome. Do not create a step for a noun.
3. Only list a system when the transcript names a system, application, spreadsheet, email, portal, screen, tool, or clearly says a system is used. "Check inventory" does NOT imply an inventory system.
4. Data may be explicit ("order data", "customer master", "Excel row") or strongly implied by an explicit read/write operation. Mark the containing step inferred when the business object itself is inferred.
5. Do not invent integrations, APIs, databases, owners, approval rules, automation, or master-data sources.
6. Evidence must be a short phrase grounded in the interview. Do not paraphrase invented detail into evidence.
7. Separate actor, department/team, responsible person, and system. "営業部の田中さんがERPに入力" => department=営業部; responsiblePerson=田中さん; actor may be 営業担当; system=ERP. Do not infer department/person when not stated.
8. Capture branches and conditions as transitions. Do not force a single linear flow when the interview describes alternatives.
9. Capture system-to-system dataFlows ONLY when the transcript explicitly describes information moving from one named system/tool to another, including human transcription. Examples: "ERPからWMSへCSVを送る", "Excelを見ながらERPへ手入力". Do NOT infer an API or integration merely because two systems appear in adjacent steps.
10. For each dataFlow record source system, target system, transferred business data, transferType, direction, automation, frequency if stated, evidence, and relatedStepKeys. Use unknown rather than guessing a transfer method.
11. Manual re-entry is a legitimate dataFlow: transferType=manual and automation=manual.
12. If a critical fact is missing, ask a focused follow-up question rather than guessing.
13. warnings should call out ambiguity, contradictions, suspicious duplicate entry, unclear system-of-record, or places where the transcript is insufficient.
14. stepKey is local to this draft. Use short stable English slugs such as receive-order, check-content, register-order.
15. Process execution mode is separate from ownership and from System-to-System Data Flow:
   - manual: a person performs the step
   - automatic: a System performs the step internally
   - mixed: human action/approval and System automation are both essential to the step
   - unknown: execution mode is not clear
16. Set executingSystem ONLY when the interview explicitly says or very clearly describes a named System performing the step automatically. Example: "SAPが自動で在庫を引き当てる" => executionMode=automatic, executingSystem=SAP. "SAPで在庫を確認する" does NOT imply SAP executes the business step; that is usually a manual step using SAP.
17. Automatic internal System execution is NOT a dataFlow. "ERP automatically assigns an order number" is an automatic Process step. "ERP sends the order to WMS" is a dataFlow and may also cause a later automatic Process step in WMS if explicitly described.
18. Existing System/Data/Workflow context may be provided as reference candidates. Use it to understand aliases, shorthand, and handoffs, but NEVER treat a candidate as confirmed solely because it exists in the catalog.
19. "ERP" may plausibly refer to an existing SAP system, and "いつもの出荷処理" may plausibly refer to an existing shipping workflow. Preserve the interview wording/evidence and surface uncertainty rather than inventing or silently canonicalizing.
20. Follow-up answers are additional interview evidence. Incorporate them into steps, ownership, execution mode, executing System, data flows, trigger/outcome, warnings, and questions. Remove questions that are answered.
21. certainty=explicit unless the step itself requires a modest inference to make the workflow coherent.

Write concise Japanese labels/descriptions when the interview is Japanese.`;
}

function compactExistingContext(
  graph: LensGraph,
  currentWorkflowId: string,
) {
  const workflowNames = new Map(
    graph.workflows.map((workflow) => [workflow.id, workflow.name]),
  );

  const workflowIdsForNode = (nodeId: string) => {
    const ids = new Set<string>();
    for (const edge of graph.edges) {
      if (edge.source === nodeId || edge.target === nodeId) {
        for (const workflowId of edge.workflowIds) ids.add(workflowId);
      }
    }
    for (const flow of graph.dataFlows ?? []) {
      if (
        flow.sourceSystemId === nodeId ||
        flow.targetSystemId === nodeId ||
        flow.dataIds.includes(nodeId)
      ) {
        for (const workflowId of flow.workflowIds) ids.add(workflowId);
      }
    }
    return [...ids]
      .map((id) => workflowNames.get(id) ?? id)
      .slice(0, 8);
  };

  const systems = graph.nodes
    .filter((node) => node.kind === "system")
    .map((node) => ({
      canonicalKey: node.canonicalKey,
      name: node.label,
      description: node.description,
      usedBy: workflowIdsForNode(node.id),
    }))
    .slice(0, 30);

  const data = graph.nodes
    .filter((node) => node.kind === "data")
    .map((node) => ({
      canonicalKey: node.canonicalKey,
      name: node.label,
      description: node.description,
      usedBy: workflowIdsForNode(node.id),
    }))
    .slice(0, 30);

  const workflows = graph.workflows
    .filter((workflow) => workflow.id !== currentWorkflowId)
    .map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description ?? "",
      steps: graph.nodes
        .filter(
          (node) =>
            node.kind === "process" &&
            node.workflowId === workflow.id,
        )
        .sort(
          (a, b) =>
            (a.stepOrder ?? Number.MAX_SAFE_INTEGER) -
            (b.stepOrder ?? Number.MAX_SAFE_INTEGER),
        )
        .slice(0, 10)
        .map((node) => node.label),
    }))
    .slice(0, 30);

  return { systems, data, workflows };
}

function extractionUserPrompt(args: {
  interview: string;
  workflow: Workflow;
  graph: LensGraph;
  previousReview?: ExtractionReview | null;
  followUpAnswers?: FollowUpAnswer[];
}) {
  const existingContext = compactExistingContext(
    args.graph,
    args.workflow.id,
  );
  const answered = (args.followUpAnswers ?? []).filter(
    (item) => item.answer.trim().length > 0,
  );

  return `Workflow being interviewed:
${JSON.stringify(args.workflow, null, 2)}

Interview transcript:
---
${args.interview}
---

Existing company context (REFERENCE CANDIDATES ONLY):
${JSON.stringify(existingContext, null, 2)}

${args.previousReview ? `Current review draft. It may include human edits; preserve those edits unless the new follow-up answers clearly contradict them:
${JSON.stringify(args.previousReview, null, 2)}
` : ""}

${answered.length > 0 ? `Follow-up Q&A. Treat the answers as additional interview evidence:
${JSON.stringify(answered, null, 2)}
` : ""}

Use existing company context to interpret shorthand and references such as "ERP", "SAP", "the core system", or "the usual shipping process". It is context, not authority:
- Do not silently replace the interview wording with a canonical name.
- Do not merge or assign canonical IDs here.
- When an existing System/Data/Workflow is a plausible match, use that knowledge to make the draft more coherent and mention ambiguity in warnings/questions when identity is not clear.
- If the interview says "after that we do the usual shipping process" and an existing shipping workflow is present, do not invent its internal steps; describe the handoff and ask only what is still needed.
- If a follow-up answer resolves a question, update the draft and remove that question.
- Ask new questions only for remaining material gaps.

Return a revised, reviewable workflow draft.`;
}

function normalizeName(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function candidateId(kind: "system" | "data", name: string) {
  return `${kind}:${normalizeName(name) || "unknown"}`;
}

function collectCandidates(draft: WorkflowDraft): AssetCandidate[] {
  const map = new Map<string, AssetCandidate>();

  const add = (
    kind: "system" | "data",
    name: string,
    evidence: string,
    certainty: "explicit" | "inferred",
  ) => {
    const cleanName = name.trim();
    if (!cleanName) return;

    const id = candidateId(kind, cleanName);
    const existing = map.get(id);
    if (existing) {
      if (evidence && !existing.evidence.includes(evidence)) {
        existing.evidence.push(evidence);
      }
      if (certainty === "explicit") existing.certainty = "explicit";
      return;
    }

    map.set(id, {
      candidateId: id,
      kind,
      name: cleanName,
      evidence: evidence ? [evidence] : [],
      certainty,
    });
  };

  for (const step of draft.steps) {
    for (const system of step.systems) {
      add("system", system.name, system.evidence, step.certainty);
    }
    if (
      step.executingSystem?.trim() &&
      step.executionMode !== "manual"
    ) {
      add(
        "system",
        step.executingSystem,
        step.evidence,
        step.certainty,
      );
    }
    for (const data of step.data) {
      add("data", data.name, data.evidence, step.certainty);
    }
  }

  for (const flow of draft.dataFlows ?? []) {
    add("system", flow.sourceSystem, flow.evidence, flow.certainty);
    add("system", flow.targetSystem, flow.evidence, flow.certainty);
    for (const dataName of flow.data) {
      add("data", dataName, flow.evidence, flow.certainty);
    }
  }

  return [...map.values()];
}

function existingAssets(graph: LensGraph) {
  return graph.nodes
    .filter((node) => node.kind === "system" || node.kind === "data")
    .map((node) => ({
      canonicalKey: node.canonicalKey,
      kind: node.kind,
      label: node.label,
      description: node.description,
    }));
}

function resolutionSystemPrompt() {
  return `You resolve extracted system/data mentions against an existing canonical asset catalog.

This is a precision-first entity resolution task.

Rules:
1. REUSE only when the candidate and existing asset clearly refer to the same logical business asset.
2. Similar category is not enough. "ERP" and "SAP" are not automatically the same. "customer data" and "customer master" are not automatically the same.
3. Use UNCERTAIN when an interview uses a generic name or alias and the available context cannot prove identity.
4. CREATE when it is clearly a distinct asset or there is no plausible existing asset.
5. Never merge system and data kinds.
6. existingCanonicalKey must be populated only for REUSE, and must exactly match a key from the provided catalog.
7. canonicalLabel should be a concise display label for CREATE/UNCERTAIN, or the existing asset label for REUSE.
8. Prefer uncertainty over a false merge. A later human can merge assets safely.`;
}

async function resolveAssets(
  candidates: AssetCandidate[],
  graph: LensGraph,
): Promise<AssetResolution[]> {
  if (candidates.length === 0) return [];

  const catalog = existingAssets(graph);

  if (catalog.length === 0) {
    return candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      decision: "create" as const,
      existingCanonicalKey: null,
      canonicalLabel: candidate.name,
      reason: "No existing canonical assets to compare.",
    }));
  }

  const result = await structuredCall<{ resolutions: AssetResolution[] }>({
    schemaName: "asset_resolution",
    schema: ASSET_RESOLUTION_SCHEMA,
    system: resolutionSystemPrompt(),
    user: `Existing canonical assets:
${JSON.stringify(catalog, null, 2)}

New extracted candidates:
${JSON.stringify(candidates, null, 2)}

Resolve every candidate exactly once.`,
  });

  const byCandidate = new Map(
    result.resolutions.map((resolution) => [
      resolution.candidateId,
      resolution,
    ]),
  );

  return candidates.map((candidate) => {
    const resolution = byCandidate.get(candidate.candidateId);
    if (!resolution) {
      return {
        candidateId: candidate.candidateId,
        decision: "uncertain" as const,
        existingCanonicalKey: null,
        canonicalLabel: candidate.name,
        reason: "Resolver omitted this candidate.",
      };
    }

    if (resolution.decision === "reuse") {
      const valid = catalog.some(
        (asset) =>
          asset.canonicalKey === resolution.existingCanonicalKey &&
          asset.kind === candidate.kind,
      );
      if (!valid) {
        return {
          ...resolution,
          decision: "uncertain" as const,
          existingCanonicalKey: null,
          canonicalLabel: candidate.name,
          reason: `Invalid reuse target. ${resolution.reason}`,
        };
      }
    }

    return resolution;
  });
}

function makeAssetCanonicalKey(
  candidate: AssetCandidate,
  resolution: AssetResolution,
) {
  if (
    resolution.decision === "reuse" &&
    resolution.existingCanonicalKey
  ) {
    return resolution.existingCanonicalKey;
  }

  const slug = normalizeName(resolution.canonicalLabel || candidate.name);
  return resolution.decision === "uncertain"
    ? `${candidate.kind}:unresolved:${slug || "unknown"}`
    : `${candidate.kind}:${slug || "unknown"}`;
}

function confidence(
  certainty: "explicit" | "inferred",
  resolution?: AssetResolution,
): Confidence {
  if (resolution?.decision === "uncertain") return "unknown";
  return certainty === "explicit" ? "confirmed" : "inferred";
}

function relationForDataOperation(
  operation: ExtractionReviewStep["data"][number]["operation"],
): Relation {
  if (operation === "read" || operation === "receive") return "reads";
  if (operation === "send") return "sends";
  return "writes";
}

function buildGraphPatch(
  draft: WorkflowDraft,
  workflow: Workflow,
  candidates: AssetCandidate[],
  resolutions: AssetResolution[],
): GraphPatch {
  const nodes: GraphPatchNode[] = [];
  const edges: GraphPatchEdge[] = [];
  const dataFlows: GraphPatch["dataFlows"] = [];
  const resolutionByCandidate = new Map(
    resolutions.map((resolution) => [resolution.candidateId, resolution]),
  );
  const candidateById = new Map(
    candidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  const assetKeyByCandidate = new Map<string, string>();

  for (const candidate of candidates) {
    const resolution =
      resolutionByCandidate.get(candidate.candidateId) ??
      ({
        candidateId: candidate.candidateId,
        decision: "uncertain",
        existingCanonicalKey: null,
        canonicalLabel: candidate.name,
        reason: "No resolution available.",
      } satisfies AssetResolution);

    const canonicalKey = makeAssetCanonicalKey(candidate, resolution);
    assetKeyByCandidate.set(candidate.candidateId, canonicalKey);

    nodes.push({
      canonicalKey,
      kind: candidate.kind,
      label: resolution.canonicalLabel || candidate.name,
      description:
        resolution.decision === "uncertain"
          ? `要確認: ${resolution.reason}`
          : candidate.kind === "system"
            ? "ヒアリングで利用が確認されたシステム・ツール。"
            : "ヒアリングで読み書きが確認された業務データ。",
      status: confidence(candidate.certainty, resolution),
      actor: null,
      evidence: candidate.evidence.join(" / "),
      stepOrder: null,
      action: null,
    });
  }

  const processKey = (stepKey: string) =>
    `process:${workflow.id}:${normalizeName(stepKey) || "step"}`;

  const sortedSteps = [...draft.steps].sort((a, b) => a.order - b.order);

  for (const step of sortedSteps) {
    nodes.push({
      canonicalKey: processKey(step.stepKey),
      kind: "process",
      label: step.name,
      description: step.action,
      status: step.certainty === "explicit" ? "confirmed" : "inferred",
      actor: step.actor,
      department: step.department,
      responsiblePerson: step.responsiblePerson,
      executionMode: step.executionMode,
      evidence: step.evidence,
      stepOrder: step.order,
      action: step.action,
    });

    if (
      step.executingSystem?.trim() &&
      step.executionMode !== "manual"
    ) {
      const id = candidateId("system", step.executingSystem);
      const executingSystemKey =
        assetKeyByCandidate.get(id) ??
        `system:unresolved:${normalizeName(step.executingSystem) || "unknown"}`;

      edges.push({
        sourceKey: executingSystemKey,
        targetKey: processKey(step.stepKey),
        relation: "executes",
        label: step.executionMode,
      });
    }

    for (const system of step.systems) {
      const id = candidateId("system", system.name);
      const targetKey =
        assetKeyByCandidate.get(id) ??
        makeAssetCanonicalKey(
          candidateById.get(id) ?? {
            candidateId: id,
            kind: "system",
            name: system.name,
            evidence: [system.evidence],
            certainty: step.certainty,
          },
          {
            candidateId: id,
            decision: "uncertain",
            existingCanonicalKey: null,
            canonicalLabel: system.name,
            reason: "Unresolved system mention.",
          },
        );

      edges.push({
        sourceKey: processKey(step.stepKey),
        targetKey,
        relation: "uses",
        label: system.interaction,
      });
    }

    for (const data of step.data) {
      const id = candidateId("data", data.name);
      const targetKey =
        assetKeyByCandidate.get(id) ??
        `data:unresolved:${normalizeName(data.name) || "unknown"}`;

      edges.push({
        sourceKey: processKey(step.stepKey),
        targetKey,
        relation: relationForDataOperation(data.operation),
        label: data.operation,
      });
    }
  }

  for (const transition of draft.transitions) {
    edges.push({
      sourceKey: processKey(transition.fromStepKey),
      targetKey: processKey(transition.toStepKey),
      relation: "next",
      label: transition.condition ?? undefined,
    });
  }

  for (const flow of draft.dataFlows ?? []) {
    const sourceKey = assetKeyByCandidate.get(
      candidateId("system", flow.sourceSystem),
    );
    const targetKey = assetKeyByCandidate.get(
      candidateId("system", flow.targetSystem),
    );
    if (!sourceKey || !targetKey) continue;

    const dataKeys = flow.data
      .map((name) =>
        assetKeyByCandidate.get(candidateId("data", name)),
      )
      .filter((key): key is string => Boolean(key));

    dataFlows.push({
      sourceSystemKey: sourceKey,
      targetSystemKey: targetKey,
      dataKeys,
      transferType: flow.transferType,
      direction: flow.direction,
      automation: flow.automation,
      frequency: flow.frequency,
      evidence: flow.evidence,
      status: flow.certainty === "explicit" ? "confirmed" : "inferred",
      relatedStepKeys: flow.relatedStepKeys,
    });
  }

  return {
    nodes,
    edges,
    dataFlows,
    questions: draft.questions.map((item) => item.question),
  };
}

function normalizeDraft(raw: WorkflowDraft): WorkflowDraft {
  const seen = new Set<string>();
  const steps = raw.steps
    .map((step, index) => {
      let key = normalizeName(step.stepKey) || `step-${index + 1}`;
      let suffix = 2;
      const base = key;
      while (seen.has(key)) {
        key = `${base}-${suffix++}`;
      }
      seen.add(key);

      return {
        ...step,
        stepKey: key,
        name: step.name ?? "",
        action: step.action ?? "",
        order: Number.isFinite(step.order) ? step.order : index + 1,
        department: step.department ?? null,
        responsiblePerson: step.responsiblePerson ?? null,
        executionMode: step.executionMode ?? "unknown",
        executingSystem: step.executingSystem ?? null,
        systems: (step.systems ?? []).filter(
          (system) => Boolean(system.name?.trim()),
        ),
        data: (step.data ?? []).filter(
          (data) => Boolean(data.name?.trim()),
        ),
      };
    })
    .sort((a, b) => a.order - b.order);

  const validKeys = new Set(steps.map((step) => step.stepKey));
  const transitions = (raw.transitions ?? []).filter(
    (transition) =>
      validKeys.has(normalizeName(transition.fromStepKey)) &&
      validKeys.has(normalizeName(transition.toStepKey)),
  ).map((transition) => ({
    ...transition,
    fromStepKey: normalizeName(transition.fromStepKey),
    toStepKey: normalizeName(transition.toStepKey),
  }));

  return {
    summary: raw.summary ?? "",
    trigger: raw.trigger ?? null,
    outcome: raw.outcome ?? null,
    steps,
    transitions,
    dataFlows: (raw.dataFlows ?? [])
      .filter(
        (flow) =>
          Boolean(
            flow.sourceSystem &&
              flow.targetSystem &&
              flow.sourceSystem !== flow.targetSystem &&
              flow.evidence,
          ),
      )
      .map((flow) => ({
        ...flow,
        relatedStepKeys: (flow.relatedStepKeys ?? [])
          .map((key) => normalizeName(key))
          .filter((key) => validKeys.has(key)),
      })),
    questions: (raw.questions ?? []).filter(
      (item): item is ExtractionQuestion =>
        Boolean(item?.question && item?.reason && item?.target),
    ),
    warnings: (raw.warnings ?? []).filter(Boolean),
  };
}

export async function extractWorkflowReviewWithAI(args: {
  interview: string;
  workflow: Workflow;
  graph: LensGraph;
  previousReview?: ExtractionReview | null;
  followUpAnswers?: FollowUpAnswer[];
}): Promise<{ review: ExtractionReview; provider: string }> {
  const rawDraft = await structuredCall<WorkflowDraft>({
    schemaName: "workflow_draft",
    schema: WORKFLOW_DRAFT_SCHEMA,
    system: extractionSystemPrompt(),
    user: extractionUserPrompt(args),
  });

  const draft = normalizeDraft(rawDraft);

  return {
    review: {
      summary: draft.summary,
      trigger: draft.trigger,
      outcome: draft.outcome,
      steps: draft.steps,
      transitions: draft.transitions,
      dataFlows: draft.dataFlows,
      questions: draft.questions,
      warnings: draft.warnings,
    },
    provider: `${protocol()}-compatible:${env("AI_MODEL")}`,
  };
}

export async function resolveWorkflowReviewWithAI(args: {
  review: ExtractionReview;
  workflow: Workflow;
  graph: LensGraph;
}): Promise<{
  patch: GraphPatch;
  review: ExtractionReview;
  provider: string;
}> {
  const draft = normalizeDraft({
    ...args.review,
    transitions: args.review.transitions ?? [],
  });

  const candidates = collectCandidates(draft);
  const resolutions = await resolveAssets(candidates, args.graph);
  const patch = buildGraphPatch(
    draft,
    args.workflow,
    candidates,
    resolutions,
  );

  const resolutionWarnings = resolutions
    .filter((resolution) => resolution.decision === "uncertain")
    .map(
      (resolution) =>
        `共有資産の同一性を要確認: ${resolution.canonicalLabel} — ${resolution.reason}`,
    );

  return {
    patch,
    review: {
      ...draft,
      warnings: [...draft.warnings, ...resolutionWarnings],
    },
    provider: `${protocol()}-compatible:${env("AI_MODEL")}`,
  };
}

export function resolveWorkflowReviewLocally(args: {
  review: ExtractionReview;
  workflow: Workflow;
  graph: LensGraph;
}): { patch: GraphPatch; review: ExtractionReview } {
  const draft = normalizeDraft({
    ...args.review,
    transitions: args.review.transitions ?? [],
  });
  const candidates = collectCandidates(draft);
  const catalog = existingAssets(args.graph);

  const resolutions: AssetResolution[] = candidates.map((candidate) => {
    const exact = catalog.find(
      (asset) =>
        asset.kind === candidate.kind &&
        normalizeName(asset.label) === normalizeName(candidate.name),
    );

    if (exact) {
      return {
        candidateId: candidate.candidateId,
        decision: "reuse",
        existingCanonicalKey: exact.canonicalKey,
        canonicalLabel: exact.label,
        reason: "Exact normalized label match in local demo resolver.",
      };
    }

    return {
      candidateId: candidate.candidateId,
      decision: "create",
      existingCanonicalKey: null,
      canonicalLabel: candidate.name,
      reason: "No exact local match.",
    };
  });

  return {
    patch: buildGraphPatch(
      draft,
      args.workflow,
      candidates,
      resolutions,
    ),
    review: draft,
  };
}
