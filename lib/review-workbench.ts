import {
  canonicalNodeId,
  replaceWorkflowGraph,
  type ExtractionReview,
  type ExtractionReviewStep,
  type GraphPatch,
  type LensGraph,
  type Workflow,
} from "./graph";
import { findConfirmedAsset } from "./refinement";
import {
  applyInputOrganization,
  emptyInputKnowledge,
  reviewedWorkflowName,
} from "./input-knowledge";

export const NEW_MEMO_ID = "__new_memo__";

export function hasUnreflectedNotes(
  notes: Record<string, string>,
  saved: Record<string, string>,
) {
  return Object.entries(notes).some(([id, text]) => text !== (saved[id] ?? ""));
}

// Keep the earlier source literally. Repeated evidence has no unique insertion point.
export function insertNoteAfterEvidence(
  source: string,
  evidence: string,
  addition: string,
): string | null {
  const anchor = evidence.trim();
  const text = addition.trim();
  if (!anchor || !text) return null;
  const start = source.indexOf(anchor);
  if (start < 0 || source.indexOf(anchor, start + anchor.length) >= 0)
    return null;
  if (
    source
      .slice(0, start)
      .split(/[。\n]/)
      .at(-1)
      ?.trim()
  )
    return null;
  if (
    !/^(?:[ \t]*(?:。|\r?\n)|[ \t]*$)/.test(source.slice(start + anchor.length))
  )
    return null;
  let end = start + anchor.length;
  end += source.slice(end).match(/^[ \t]*。/)?.[0].length ?? 0;
  const tail = source.slice(end);
  return (
    source.slice(0, end) +
    "\n" +
    text +
    (tail && !/^[\r\n]/.test(tail) ? "\n" : "") +
    tail
  );
}
export function transcriptsForSave(
  saved: Record<string, string>,
  workflowId: string,
  sourceNotes: string,
) {
  const next = { ...saved, [workflowId]: sourceNotes };
  delete next[NEW_MEMO_ID];
  return next;
}
export type InputDraft = {
  workflow: Workflow;
  review: ExtractionReview;
  provider: string;
  sourceNotes: string;
  answers: Record<string, string>;
  answerHistory: import("./graph").FollowUpAnswer[];
  baseline: ExtractionReview | null;
};
export function reviewSlug(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Deterministic projection for immediate, unsaved previews. No extraction or storage.
export function previewReviewGraph(
  graph: LensGraph,
  workflow: Workflow,
  review: ExtractionReview,
): LensGraph {
  const patch: GraphPatch = {
    nodes: [],
    edges: [],
    dataFlows: [],
    questions: [],
  };
  const assets = new Map<string, string>();
  const asset = (kind: "system" | "data", name: string, evidence: string) => {
    const mention = `${kind}:${name}`;
    if (assets.has(mention)) return assets.get(mention)!;
    const existing = findConfirmedAsset(graph, kind, name);
    const candidateKey = `${kind}:${reviewSlug(name) || "unknown"}`;
    const key =
      existing?.canonicalKey ??
      (graph.nodes.some((n) => n.canonicalKey === candidateKey)
        ? `${kind}:unresolved:${reviewSlug(name)}:${workflow.id}`
        : candidateKey);
    assets.set(mention, key);
    if (!patch.nodes.some((n) => n.canonicalKey === key))
      patch.nodes.push({
        canonicalKey: key,
        kind,
        label: existing?.label ?? name,
        description: existing?.description ?? name,
        status: existing?.status ?? "inferred",
        evidence: existing?.evidence ?? evidence,
      });
    return key;
  };
  const process = (key: string) => `process:${workflow.id}:${reviewSlug(key)}`;
  for (const step of review.steps) {
    patch.nodes.push({
      canonicalKey: process(step.stepKey),
      kind: "process",
      label: step.name,
      description: step.action,
      status: step.certainty === "explicit" ? "confirmed" : "inferred",
      stepOrder: step.order,
      action: step.action,
      actor: step.actor,
      department: step.department,
      responsiblePerson: step.responsiblePerson,
      executionMode: step.executionMode,
      evidence: step.evidence,
      executionContext: step.executionContext,
      meaning: step.meaning,
      humanEdits: step.humanEdits,
      technicalDetails: step.technicalDetails,
      detailSteps: step.detailSteps,
    });
    for (const system of step.systems)
      patch.edges.push({
        sourceKey: process(step.stepKey),
        targetKey: asset("system", system.name, system.evidence),
        relation: "uses",
        label: system.interaction,
      });
    if (step.executingSystem && step.executionMode !== "manual")
      patch.edges.push({
        sourceKey: asset("system", step.executingSystem, step.evidence),
        targetKey: process(step.stepKey),
        relation: "executes",
      });
    for (const data of step.data)
      patch.edges.push({
        sourceKey: process(step.stepKey),
        targetKey: asset("data", data.name, data.evidence),
        relation: ["read", "receive"].includes(data.operation)
          ? "reads"
          : data.operation === "send"
            ? "sends"
            : "writes",
        label: data.operation,
      });
  }
  for (const t of review.transitions)
    patch.edges.push({
      sourceKey: process(t.fromStepKey),
      targetKey: process(t.toStepKey),
      relation: "next",
      label: t.condition,
      evidence: t.evidence,
      status: t.certainty ?? "unknown",
    });
  for (const f of review.dataFlows)
    patch.dataFlows.push({
      sourceSystemKey: asset("system", f.sourceSystem, f.evidence),
      targetSystemKey: asset("system", f.targetSystem, f.evidence),
      dataKeys: f.data.map((d) => asset("data", d, f.evidence)),
      transferType: f.transferType,
      direction: f.direction,
      automation: f.automation,
      frequency: f.frequency,
      evidence: f.evidence,
      status: f.certainty === "explicit" ? "confirmed" : "inferred",
      relatedStepKeys: f.relatedStepKeys,
    });
  const projected = replaceWorkflowGraph(
    graph,
    {
      ...workflow,
      name: reviewedWorkflowName(workflow, review),
      summary: review.summary,
      trigger: review.trigger,
      outcome: review.outcome,
      reviewContext: {
        summary: review.summary,
        trigger: review.trigger,
        outcome: review.outcome,
        questions: review.questions,
        warnings: review.warnings,
        excludedSteps: review.excludedSteps,
        extraction: review.extraction,
        protectedDetails: review.protectedDetails,
        organization: review.organization,
        systemProfiles: review.systemProfiles,
      },
    },
    patch,
  );
  return applyInputOrganization(
    applyReviewConnections(projected, workflow, review),
    workflow,
    review,
    graph,
  );
}

export function applyReviewConnections(
  graph: LensGraph,
  workflow: Workflow,
  review: ExtractionReview,
) {
  if (!review.handoffs && !review.incomingHandoffs) return graph;
  const prior = graph.knowledge?.handoffs ?? [];
  const handoffs = (review.handoffs ?? []).flatMap((h, index) => {
    const target = graph.workflows.find(
      (w) =>
        w.id === h.targetWorkflowId &&
        w.id !== workflow.id &&
        (w.scenario ?? "current") === (workflow.scenario ?? "current"),
    );
    const source = graph.nodes.find(
      (n) =>
        n.id ===
        canonicalNodeId(`process:${workflow.id}:${reviewSlug(h.fromStepKey)}`),
    );
    if (!target || !source) return [];
    const targetProcess = h.targetStepKey
      ? graph.nodes.find(
          (n) =>
            n.kind === "process" &&
            n.workflowId === target.id &&
            n.canonicalKey.split(":").at(-1) === h.targetStepKey,
        )
      : undefined;
    return [
      {
        id: `input-handoff:${workflow.id}:out:${index}`,
        reviewedWorkflowId: workflow.id,
        origin: h.origin,
        via: h.via,
        sourceWorkflowId: workflow.id,
        sourceProcessId: source.id,
        targetWorkflowId: target.id,
        targetProcessId: targetProcess?.id,
        dataIds: h.data.flatMap((name) => {
          const n = findConfirmedAsset(graph, "data", name);
          return n ? [n.id] : [];
        }),
        description: h.description,
        kind: "information" as const,
        evidence: h.evidence,
        status: h.certainty,
      },
    ];
  });
  const incoming = (review.incomingHandoffs ?? []).flatMap((h, index) => {
    const source = graph.workflows.find(
      (w) =>
        w.id === h.sourceWorkflowId &&
        w.id !== workflow.id &&
        (w.scenario ?? "current") === (workflow.scenario ?? "current"),
    );
    const targetProcess = graph.nodes.find(
      (n) =>
        n.kind === "process" &&
        n.workflowId === workflow.id &&
        n.canonicalKey.split(":").at(-1) === h.toStepKey,
    );
    if (!source || !targetProcess) return [];
    const sourceProcess = graph.nodes.find(
      (n) =>
        n.kind === "process" &&
        n.workflowId === source.id &&
        n.canonicalKey.split(":").at(-1) === h.sourceStepKey,
    );
    return [
      {
        id: `input-handoff:${workflow.id}:in:${index}`,
        reviewedWorkflowId: workflow.id,
        origin: h.origin,
        via: h.via,
        sourceWorkflowId: source.id,
        sourceProcessId: sourceProcess?.id,
        targetWorkflowId: workflow.id,
        targetProcessId: targetProcess.id,
        dataIds: h.data.flatMap((name) => {
          const n = findConfirmedAsset(graph, "data", name);
          return n ? [n.id] : [];
        }),
        description: h.description,
        kind: "information" as const,
        evidence: h.evidence,
        status: h.certainty,
      },
    ];
  });
  const knowledge = graph.knowledge ?? emptyInputKnowledge();
  const preserved = prior.filter((h) =>
    h.reviewedWorkflowId
      ? h.reviewedWorkflowId !== workflow.id
      : !(
          h.sourceWorkflowId === workflow.id &&
          (h.sourceProcessId || h.id.startsWith("input-handoff:"))
        ),
  );
  const connectionKey = (
    h: NonNullable<LensGraph["knowledge"]>["handoffs"] extends
      | Array<infer T>
      | undefined
      ? T
      : never,
  ) =>
    JSON.stringify([
      h.sourceWorkflowId,
      h.targetWorkflowId,
      h.sourceProcessId,
      h.targetProcessId,
      [...h.dataIds].sort(),
      h.description,
    ]);
  const seen = new Set(preserved.map(connectionKey));
  const additions = [...handoffs, ...incoming].filter((h) => {
    const key = connectionKey(h);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    ...graph,
    knowledge: {
      ...knowledge,
      handoffs: [...preserved, ...additions],
    },
  };
}

// Inserting one step shifts later numbers; those are not corrections to their content.
function comparableValue(value: unknown, path = ""): unknown {
  if (Array.isArray(value)) {
    const items = value.map((v) => comparableValue(v));
    return ["systems", "data"].includes(path)
      ? items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      : items;
  }
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key, v]) =>
            v !== undefined && !["evidence", "humanEdits"].includes(key),
        )
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => [key, comparableValue(v, key)]),
    );
  return value;
}
const comparable = (s: ExtractionReviewStep) =>
  JSON.stringify(comparableValue({ ...s, order: undefined }));
export function diffReviews(
  before: ExtractionReview | null,
  after: ExtractionReview,
  graph?: LensGraph,
) {
  const old = before?.steps ?? [];
  const added = after.steps.filter(
    (s) => !old.some((p) => p.stepKey === s.stepKey),
  );
  const removed = old.filter(
    (p) => !after.steps.some((s) => s.stepKey === p.stepKey),
  );
  const changed = after.steps.flatMap((s) => {
    const p = old.find((p) => p.stepKey === s.stepKey);
    return p && comparable(p) !== comparable(s)
      ? [
          {
            before: p,
            after: s,
            details: Object.entries(s)
              .filter(
                ([field, value]) =>
                  ![
                    "stepKey",
                    "name",
                    "order",
                    "evidence",
                    "humanEdits",
                  ].includes(field) &&
                  JSON.stringify(
                    comparableValue(
                      p[field as keyof ExtractionReviewStep],
                      field,
                    ),
                  ) !== JSON.stringify(comparableValue(value, field)),
              )
              .flatMap(([field, value]) =>
                describeHumanEdit({
                  field,
                  before: p[field as keyof ExtractionReviewStep],
                  after: value,
                  evidence: "",
                }),
              ),
          },
        ]
      : [];
  });
  const workflows = new Map(graph?.workflows.map(w => [w.id, w.name]));
  const peerSteps = new Map(graph?.nodes.filter(n => n.kind === "process").map(n =>
    [`${n.workflowId}:${n.canonicalKey.split(":").at(-1)}`, n.label]));
  const workflowName = (id: string) => workflows.get(id) ?? "相手の業務（名称未確認）";
  const peerStep = (id: string, key?: string) => key ? peerSteps.get(`${id}:${key}`) ?? "手順は未確認" : "手順は未確認";
  const certainty = (value?: string) => value === "confirmed" ? "原文・訂正の根拠あり" : value === "inferred" ? "推定・要確認" : "接続は未確認";
  const relations = (r: ExtractionReview | null) => {
    const names = new Map(r?.steps.map(s => [s.stepKey, s.name]));
    const name = (key: string) => names.get(key) ?? "手順は未確認";
    return [
    ...(r?.transitions ?? []).map(
      (t) => ({
        key: `${t.fromStepKey} → ${t.toStepKey}${t.condition ? `（${t.condition}）` : ""} / ${t.certainty ?? "unknown"}`,
        label: `${name(t.fromStepKey)} → ${name(t.toStepKey)}${t.condition ? `（${t.condition}）` : ""} · ${certainty(t.certainty)}`,
      }),
    ),
    ...(r?.handoffs ?? []).map(
      (h) => ({
        key: `${h.fromStepKey} → 業務:${h.targetWorkflowId} / ${h.via === "reference" ? "参照" : "受渡し"} / 受取:${h.targetStepKey ?? "未確認"} / ${h.data.join("、")} / ${h.description} / ${h.certainty}`,
        label: `${name(h.fromStepKey)} → ${workflowName(h.targetWorkflowId)}：${peerStep(h.targetWorkflowId, h.targetStepKey)} · ${h.via === "reference" ? "情報を参照" : "情報を渡す"}「${h.data.join("・")}」 · ${certainty(h.certainty)} · ${h.description}`,
      }),
    ),
    ...(r?.incomingHandoffs ?? []).map(
      (h) => ({
        key: `業務:${h.sourceWorkflowId} / ${h.via === "reference" ? "参照" : "受渡し"} / 送元:${h.sourceStepKey ?? "未確認"} → ${h.toStepKey} / ${h.data.join("、")} / ${h.description} / ${h.certainty}`,
        label: `${workflowName(h.sourceWorkflowId)}：${peerStep(h.sourceWorkflowId, h.sourceStepKey)} → ${name(h.toStepKey)} · ${h.via === "reference" ? "情報を参照" : "情報を受け取る"}「${h.data.join("・")}」 · ${certainty(h.certainty)} · ${h.description}`,
      }),
    ),
    ...(r?.dataFlows ?? []).map(
      (f) => ({
        key: `${f.sourceSystem} → ${f.targetSystem} / ${f.data.join("、")} / ${f.transferType} / ${f.automation} / ${f.direction} / ${f.frequency ?? "頻度未確認"}`,
        label: `${f.sourceSystem} → ${f.targetSystem} · 「${f.data.join("・")}」 · ${{ api: "API", file: "ファイル", database: "データベース", message: "メッセージ", email: "メール", manual: "手で転記", unknown: "方法は未確認" }[f.transferType]} · ${{ automatic: "自動", manual: "人の操作", mixed: "人の操作と自動処理", unknown: "実行方法は未確認" }[f.automation]} · ${{ push: "送り側から渡す", pull: "受取側が取り込む", bidirectional: "双方向", unknown: "方向は未確認" }[f.direction]} · ${f.frequency ?? "頻度は未確認"}`,
      }),
    ),
  ]; };
  const a = relations(before),
    b = relations(after);
  const aKeys = new Set(a.map(r => r.key)), bKeys = new Set(b.map(r => r.key));
  return {
    added,
    removed,
    changed,
    addedConnections: b.filter(x => !aKeys.has(x.key)).map(x => x.label),
    removedConnections: a.filter(x => !bKeys.has(x.key)).map(x => x.label),
    removedQuestions: (before?.questions ?? []).filter(q => !after.questions.some(n => n.question === q.question)),
    addedQuestions: after.questions.filter(q => !before?.questions.some(p => p.question === q.question)),
  };
}

export function editReviewStep(
  review: ExtractionReview,
  stepKey: string,
  patch: Partial<ExtractionReviewStep>,
): ExtractionReview {
  return {
    ...review,
    steps: review.steps.map((s) =>
      s.stepKey === stepKey
        ? {
            ...s,
            ...patch,
            humanEdits: [
              ...(s.humanEdits ?? []),
              ...Object.entries(patch)
                .filter(
                  ([field, value]) =>
                    JSON.stringify(s[field as keyof ExtractionReviewStep]) !==
                    JSON.stringify(value),
                )
                .flatMap<import("./graph").HumanEdit>(([field, after]) =>
                  field === "meaning" && after
                    ? Object.entries(after)
                        .filter(
                          ([f, value]) =>
                            !["certainty", "evidence"].includes(f) &&
                            JSON.stringify(
                              s.meaning?.[f as keyof typeof s.meaning],
                            ) !== JSON.stringify(value),
                        )
                        .map(([f, value]) => ({
                          field: `meaning.${f}`,
                          before: s.meaning?.[f as keyof typeof s.meaning],
                          after: value,
                          evidence: "利用者が候補を訂正",
                        }))
                    : [
                        {
                          field,
                          before: s[field as keyof ExtractionReviewStep],
                          after,
                          evidence: "利用者が候補を訂正",
                        },
                      ],
                ),
            ],
          }
        : s,
    ),
  };
}

export function recordReviewEdits(
  before: ExtractionReview,
  after: ExtractionReview,
) {
  let recorded = after;
  for (const step of after.steps) {
    const prior = before.steps.find((s) => s.stepKey === step.stepKey);
    if (!prior) continue;
    const patch = Object.fromEntries(
      Object.entries(step).filter(
        ([field, value]) =>
          !["stepKey", "humanEdits", "evidence"].includes(field) &&
          JSON.stringify(prior[field as keyof ExtractionReviewStep]) !==
            JSON.stringify(value),
      ),
    );
    const edited = editReviewStep(
      { ...after, steps: [prior] },
      step.stepKey,
      patch,
    ).steps[0];
    recorded = {
      ...recorded,
      steps: recorded.steps.map((s) =>
        s.stepKey === step.stepKey ? edited : s,
      ),
    };
  }
  return {
    ...recorded,
    excludedSteps: [
      ...new Map(
        [
          ...(before.excludedSteps ?? []),
          ...(after.excludedSteps ?? []),
          ...before.steps.filter(
            (s) => !after.steps.some((n) => n.stepKey === s.stepKey),
          ),
        ].map((s) => [s.stepKey, s]),
      ).values(),
    ],
  };
}

export function describeHumanEdit(edit: import("./graph").HumanEdit): string[] {
  const labels: Record<string, string> = {
    name: "手順名",
    action: "行うこと",
    actor: "担当する人",
    department: "部署",
    responsiblePerson: "責任者",
    executionMode: "実行方法",
    executingSystem: "実行するSystem",
    executionContext: "開始条件・ルール・例外",
    systems: "使う道具",
    data: "情報",
    order: "順序",
    technicalDetails: "技術詳細",
    detailSteps: "個別作業",
    purpose: "必要な理由",
    basis: "判断の根拠",
    result: "決まる・変わること",
    next: "次に動く仕事",
    condition: "実行条件",
    halt: "停止・保留",
  };
  const value = (v: unknown): string =>
    v == null || v === ""
      ? "未確認"
      : typeof v === "boolean"
        ? v
          ? "あり"
          : "なし"
        : Array.isArray(v)
          ? v
              .map((x) =>
                typeof x === "object" && x !== null
                  ? Object.entries(x)
                      .filter(
                        ([k, y]) => k !== "evidence" && typeof y === "string",
                      )
                      .map(([, y]) => y)
                      .join(" · ")
                  : String(x),
              )
              .join("、")
          : typeof v === "object"
            ? "詳細を更新"
            : String(v);
  const fieldValue = (v: unknown) => {
    if (["data", "systems"].includes(edit.field) && Array.isArray(v)) {
      const actions: Record<string, string> = edit.field === "data"
        ? { read: "参照する", receive: "受け取る", create: "新しく作る", update: "更新する", send: "渡す" }
        : { view: "見る", search: "探す", input: "入力する", approve: "承認する", send: "送る", receive: "受け取る", other: "使う" };
      return v.map(item => `${item.name} · ${actions[item.operation ?? item.interaction] ?? "使い方は未確認"}`).join("、") || "未確認";
    }
    return edit.field === "executionMode"
      ? ({
          manual: "人が行う",
          automatic: "システムが自動で行う",
          mixed: "人とシステムが行う",
          unknown: "未確認",
        }[String(v)] ?? value(v))
      : value(v);
  };
  if (edit.field === "meaning")
    return Object.entries(edit.after as Record<string, unknown>)
      .filter(
        ([field, v]) =>
          !["evidence", "certainty"].includes(field) &&
          JSON.stringify((edit.before as Record<string, unknown>)?.[field]) !==
            JSON.stringify(v),
      )
      .map(
        ([field, v]) =>
          `${labels[field] ?? field}：${value((edit.before as Record<string, unknown>)?.[field])} → ${value(v)}`,
      );
  return [
    `${labels[edit.field.split(".").at(-1)!] ?? edit.field}：${fieldValue(edit.before)} → ${fieldValue(edit.after)}`,
  ];
}
