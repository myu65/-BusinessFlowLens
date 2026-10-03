"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  buildWorkflowReviewFromGraph,
  getWorkflowProcesses,
  type ExtractionReview,
  type ExtractionReviewStep,
  type LensGraph,
  type Workflow,
} from "@/lib/graph";
import {
  diffReviews,
  editReviewStep,
  NEW_MEMO_ID,
  previewReviewGraph,
  type InputDraft,
  transcriptsForSave,
} from "@/lib/review-workbench";
import { WorkflowReading } from "./WorkflowReading";

type AdvancedActions = {
  draft: InputDraft;
  onChange: (review: ExtractionReview) => void;
  onSave: () => void;
  onDiscard: () => void;
  onRefine: () => void;
  busy: boolean;
};
export function InputWorkbench({
  projectId,
  graph,
  selectedId,
  onSelect,
  transcripts,
  savedTranscripts = transcripts,
  onTranscripts,
  drafts,
  onDraft,
  onGraphApply,
  onSaved,
  renderAdvanced,
  focusedStepId,
  onFocusStep,
}: {
  projectId: string;
  graph: LensGraph;
  selectedId: string;
  onSelect: (id: string) => void;
  transcripts: Record<string, string>;
  savedTranscripts?: Record<string, string>;
  onTranscripts: (value: Record<string, string>) => void;
  drafts: Record<string, InputDraft>;
  onDraft: (id: string, value: InputDraft | null) => void;
  onGraphApply: (graph: LensGraph) => void;
  onSaved?: (
    graph: LensGraph,
    transcripts: Record<string, string>,
    sourceKey: string,
  ) => void;
  renderAdvanced?: (actions: AdvancedActions) => ReactNode;
  focusedStepId?: string;
  onFocusStep?: (workflowId: string, stepId: string) => void;
}) {
  const key = selectedId || NEW_MEMO_ID;
  const draft = drafts[key];
  const saved = graph.workflows.find((w) => w.id === key);
  const currentReview = useMemo(
    () => (saved ? buildWorkflowReviewFromGraph(graph, key) : null),
    [graph, key, saved],
  );
  const review = draft?.review ?? currentReview;
  const workflow = draft?.workflow ?? saved;
  const memo = transcripts[key] ?? "";
  const [query, setQuery] = useState("");
  const [stepKey, setStepKey] = useState("");
  const [stepPage, setStepPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState<ExtractionReviewStep | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [addition, setAddition] = useState("");
  const [target, setTarget] = useState("");
  const [targetStep, setTargetStep] = useState("");
  const [handoffText, setHandoffText] = useState("");
  const [revisions, setRevisions] = useState<
    Array<{
      id: number;
      revisionNumber: number;
      summary: string;
      createdAt: string;
    }>
  >([]);
  const [revisionDetail, setRevisionDetail] = useState<{
    revisionNumber: number;
    sourceNotes: string;
    review: ExtractionReview;
    followUpAnswers: Array<{ question: string; answer: string }>;
  } | null>(null);
  const latest = useRef({
    graph,
    memo,
    draft,
    transcripts,
    savedTranscripts,
    key,
  });
  latest.current = { graph, memo, draft, transcripts, savedTranscripts, key };
  useEffect(() => {
    setStepKey(focusedStepId?.split(":").at(-1) ?? "");
    setStepPage(0);
    setEdit(null);
    setError("");
    setAdvanced(false);
    setTarget("");
    setAddition("");
    setRevisionDetail(null);
  }, [key]);
  useEffect(() => {
    if (!saved) {
      setRevisions([]);
      return;
    }
    let cancelled = false;
    fetch(
      `/api/workflow-revisions?projectId=${encodeURIComponent(projectId)}&workflowId=${encodeURIComponent(saved.id)}`,
    )
      .then((r) => r.json())
      .then((p) => {
        if (!cancelled) setRevisions(p.revisions ?? []);
      })
      .catch(() => {
        if (!cancelled) setRevisions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, saved, draft]);
  const preview = useMemo(
    () =>
      workflow && review ? previewReviewGraph(graph, workflow, review) : graph,
    [graph, workflow, review],
  );
  const steps = [...(review?.steps ?? [])].sort((a, b) => a.order - b.order);
  const selected = steps.find((s) => s.stepKey === stepKey) ?? steps[0];
  const process = selected
    ? getWorkflowProcesses(preview, workflow!.id).find(
        (n) => n.canonicalKey.split(":").at(-1) === selected.stepKey,
      )
    : undefined;
  const diff = review
    ? diffReviews(draft?.baseline ?? currentReview, review)
    : null;
  const stale = !!draft && draft.sourceNotes !== memo;
  const known = graph.workflows.filter(
    (w) =>
      (w.scenario ?? "current") === (workflow?.scenario ?? "current") &&
      w.id !== workflow?.id,
  );
  const ensureDraft = (nextReview: ExtractionReview): InputDraft =>
    draft
      ? { ...draft, review: nextReview }
      : {
          workflow: workflow!,
          review: nextReview,
          baseline: currentReview,
          provider: "human-edit",
          sourceNotes: memo,
          answerHistory: saved?.reviewContext?.followUpAnswers ?? [],
          answers: {},
        };
  const update = (nextReview: ExtractionReview) =>
    onDraft(key, ensureDraft(nextReview));
  const choose = (s: ExtractionReviewStep) => {
    setStepKey(s.stepKey);
    setStepPage(Math.floor(steps.indexOf(s) / 7));
    setEdit(null);
    const p = getWorkflowProcesses(preview, workflow!.id).find(
      (n) => n.canonicalKey.split(":").at(-1) === s.stepKey,
    );
    if (p) onFocusStep?.(workflow!.id, p.id);
  };
  async function organize(
    answers = draft?.answerHistory ??
      saved?.reviewContext?.followUpAnswers ??
      [],
    text = memo,
  ) {
    if (!text.trim()) return;
    const w = workflow ?? {
      id: `note-${crypto.randomUUID()}`,
      familyId: undefined,
      scenario: "current" as const,
      name: `入力した話：${text
        .trim()
        .split(/[。\n]/)[0]
        .slice(0, 24)}`,
    };
    const requestKey = key,
      before = review;
    setBusy(true);
    setError("");
    setEdit(null);
    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interview: text,
          workflow: w,
          graph: latest.current.graph,
          previousReview: before,
          followUpAnswers: answers,
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "構造化に失敗しました。");
      const next: InputDraft = {
        workflow: w,
        review: payload.review,
        provider: payload.provider,
        sourceNotes: text,
        baseline: before,
        answers: {},
        answerHistory: answers,
      };
      onDraft(requestKey, next);
      if (requestKey === latest.current.key) {
        const changes = diffReviews(before, next.review);
        const focus =
          changes.added[0] ?? changes.changed[0]?.after ?? next.review.steps[0];
        if (focus) {
          setStepKey(focus.stepKey);
          setStepPage(Math.floor(next.review.steps.indexOf(focus) / 7));
        }
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "読み取りに失敗しました。",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!draft || stale || busy) return;
    setBusy(true);
    setError("");
    try {
      const allTranscripts = transcriptsForSave(
        latest.current.savedTranscripts,
        draft.workflow.id,
        draft.sourceNotes,
      );
      const response = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectName: "BusinessFlowLens",
          graph: latest.current.graph,
          workflow: draft.workflow,
          review: draft.review,
          transcripts: allTranscripts,
          sourceNotes: draft.sourceNotes,
          followUpAnswers: draft.answerHistory,
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "保存に失敗しました。");
      if (onSaved)
        onSaved(payload.graph, payload.transcripts ?? allTranscripts, key);
      else {
        onGraphApply(payload.graph);
        onTranscripts(payload.transcripts ?? allTranscripts);
      }
      onDraft(key, null);
      onSelect(draft.workflow.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存に失敗しました。");
    } finally {
      setBusy(false);
    }
  }
  function applyEdit() {
    if (!edit || !review || !selected) return;
    const patch = Object.fromEntries(
      Object.entries(edit).filter(
        ([field, value]) =>
          field !== "humanEdits" &&
          JSON.stringify(selected[field as keyof ExtractionReviewStep]) !==
            JSON.stringify(value),
      ),
    );
    update(editReviewStep(review, selected.stepKey, patch));
    setEdit(null);
  }
  function removeStep() {
    if (!review || !selected) return;
    // No invented bridge across a removed decision or step.
    update({
      ...review,
      excludedSteps: [...(review.excludedSteps ?? []), selected],
      steps: review.steps
        .filter((s) => s.stepKey !== selected.stepKey)
        .map((s, i) => ({ ...s, order: i + 1 })),
      transitions: review.transitions.filter(
        (t) =>
          t.fromStepKey !== selected.stepKey &&
          t.toStepKey !== selected.stepKey,
      ),
      dataFlows: review.dataFlows
        .filter(
          (f) =>
            !f.relatedStepKeys.length ||
            f.relatedStepKeys.some((k) => k !== selected.stepKey),
        )
        .map((f) => ({
          ...f,
          relatedStepKeys: f.relatedStepKeys.filter(
            (k) => k !== selected.stepKey,
          ),
        })),
      handoffs: review.handoffs?.filter(
        (h) => h.fromStepKey !== selected.stepKey,
      ),
      questions: [
        ...review.questions,
        {
          question: `除外した「${selected.name}」の前後は、どう接続しますか？`,
          reason: "除外した手順を飛ばす接続は未確認",
          target: "handoff",
        },
      ],
    });
    setStepKey("");
    setEdit(null);
  }
  async function refine() {
    if (!draft) return;
    const answers = review!.questions
      .map((q) => ({
        question: q.question,
        answer: draft.answers[q.question] ?? "",
      }))
      .filter((a) => a.answer.trim());
    await organize([...draft.answerHistory, ...answers]);
  }
  return (
    <section className="input-workbench" aria-label="話を入力して構造を育てる">
      <header className="page-header">
        <div>
          <div className="eyebrow">INPUT → STRUCTURE → REFINE</div>
          <h1>話を入力して、つながりを確かめる</h1>
          <p>
            業務名や範囲が決まっていなくても始められます。自分の話がどこに反映されたか、保存前から確認できます。
          </p>
        </div>
      </header>
      <div className="input-workbench-grid">
        <section className="input-note-pane">
          <label className="kg-edit-field">
            話を追加する場所
            <select
              value={key}
              onChange={(e) => onSelect(e.target.value)}
              disabled={busy}
            >
              <option value={NEW_MEMO_ID}>
                新しい話から始める（業務名は後から）
              </option>
              {draft && !saved && key !== NEW_MEMO_ID && (
                <option value={key}>{draft.workflow.name} · 保存前</option>
              )}
              {graph.workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          {Object.entries(drafts)
            .filter(([id]) => id !== key)
            .map(([id, d]) => (
              <button
                key={id}
                className="button-secondary"
                onClick={() => onSelect(id)}
              >
                保存前の候補へ戻る：{d.workflow.name}
              </button>
            ))}
          <label className="kg-edit-field input-main-note">
            業務についての話
            <textarea
              disabled={busy}
              value={memo}
              onChange={(e) =>
                onTranscripts({ ...transcripts, [key]: e.target.value })
              }
              placeholder="例：注文がメールで届く。担当者がExcelで確認してSAPへ入力する。不足した場合は別の部署に相談している。まだ担当や範囲は曖昧…"
            />
          </label>
          <button
            className="button-primary"
            disabled={busy || !memo.trim()}
            onClick={() => organize()}
          >
            {busy
              ? "処理中…"
              : review
                ? "本文を読み直して構造を更新"
                : "話を構造にする"}
          </button>
          <p className="flow-explanation">
            原文は残ります。AI未接続時は簡易抽出です。分からないことは「未確認」として補足できます。
          </p>
          {workflow && (
            <details>
              <summary>業務名・表示する状態を整える（任意）</summary>
              <label className="kg-edit-field">
                業務名
                <input
                  value={workflow.name}
                  onChange={(e) =>
                    onDraft(key, {
                      ...ensureDraft(review!),
                      workflow: { ...workflow, name: e.target.value },
                    })
                  }
                />
              </label>
              <label className="kg-edit-field">
                表示する状態
                <select
                  value={workflow.scenario ?? "current"}
                  onChange={(e) =>
                    onDraft(key, {
                      ...ensureDraft(review!),
                      workflow: {
                        ...workflow,
                        scenario: e.target.value as Workflow["scenario"],
                      },
                    })
                  }
                >
                  <option value="current">現在の仕事</option>
                  <option value="future">改善後の案</option>
                  <option value="alternative">別の案</option>
                </select>
              </label>
              {saved && (
                <button
                  onClick={() => {
                    const w = {
                      ...saved,
                      id: `note-${crypto.randomUUID()}`,
                      name: `${saved.name}（将来案）`,
                      familyId: saved.familyId ?? saved.id,
                      basedOnWorkflowId: saved.id,
                      scenario: "future" as const,
                    };
                    onDraft(w.id, {
                      ...ensureDraft(review!),
                      workflow: w,
                      baseline: review,
                    });
                    onTranscripts({ ...transcripts, [w.id]: memo });
                    onSelect(w.id);
                  }}
                >
                  この構造から将来案を作る
                </button>
              )}
            </details>
          )}
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          {revisions.length > 0 && (
            <details>
              <summary>保存した原文と構造の履歴 · {revisions.length}回</summary>
              {revisions.slice(0, 5).map((r) => (
                <button
                  key={r.revisionNumber}
                  onClick={async () => {
                    try {
                      const requestKey = key;
                      const response = await fetch(
                        `/api/workflow-revisions?projectId=${encodeURIComponent(projectId)}&revisionId=${r.id}`,
                      );
                      const p = await response.json();
                      if (!response.ok || !p.revision)
                        throw new Error(p.error ?? "履歴が見つかりません");
                      if (requestKey === latest.current.key)
                        setRevisionDetail(p.revision);
                    } catch (e) {
                      setError(
                        e instanceof Error ? e.message : "履歴を読み込めません",
                      );
                    }
                  }}
                >
                  v{r.revisionNumber} · {r.createdAt} · {r.summary} を確認する
                </button>
              ))}
              {revisionDetail && (
                <article aria-label="保存時点の原文と構造">
                  <h3>保存時点 v{revisionDetail.revisionNumber} の原文</h3>
                  <pre className="input-source-history">
                    {revisionDetail.sourceNotes}
                  </pre>
                  <p>当時の構造：{revisionDetail.review.steps.length}手順</p>
                  {revisionDetail.review.steps.slice(0, 7).map((s) => (
                    <p key={s.stepKey}>
                      {s.order}. {s.name} →{" "}
                      {s.meaning?.result || "結果は未確認"}
                    </p>
                  ))}
                  {revisionDetail.followUpAnswers.map((a, i) => (
                    <p key={i}>
                      補足：{a.question} / {a.answer}
                    </p>
                  ))}
                  <button onClick={() => setRevisionDetail(null)}>
                    履歴を閉じる
                  </button>
                </article>
              )}
            </details>
          )}
        </section>
        <section className="input-structure-pane">
          <div className="input-structure-header">
            <h2>
              {draft
                ? "保存前の構造"
                : review
                  ? "入力から蓄積した構造"
                  : "話を入れると、ここに構造が見えます"}
            </h2>
            {review && (
              <span>
                {steps.length}手順 · {draft?.provider ?? "保存済み"}
              </span>
            )}
          </div>
          {stale && (
            <p role="status" className="input-stale">
              本文が変わりました。現在の候補は前の本文によるものです。「本文を読み直して構造を更新」で差分を確認してください。
            </p>
          )}
          {!review && (
            <div className="input-empty-structure">
              <p>
                ① 話を入力する → ② 流れとして見る → ③ その場で補足・訂正する
              </p>
              <p>
                手順・人・道具・情報と、判断によって何が変わるかを一緒に確認します。
              </p>
            </div>
          )}
          {review && selected && (
            <>
              {draft && diff && (
                <details className="input-diff">
                  <summary>
                    反映箇所 · 追加{diff.added.length} / 変更
                    {diff.changed.length} / 除外{diff.removed.length} / 接続＋
                    {diff.addedConnections.length} −
                    {diff.removedConnections.length}
                  </summary>
                  <div className="input-diff-items">
                    {diff.added.slice(0, 5).map((s) => (
                      <button key={s.stepKey} onClick={() => choose(s)}>
                        ＋ {s.name}
                      </button>
                    ))}
                    {diff.changed.slice(0, 5).map((c) => (
                      <button
                        key={c.after.stepKey}
                        onClick={() => choose(c.after)}
                      >
                        変更：{c.after.name}
                        <small>{c.details.slice(0, 3).join(" / ")}</small>
                      </button>
                    ))}
                    {diff.removed.slice(0, 5).map((s) => (
                      <p key={s.stepKey}>除外：{s.name}</p>
                    ))}
                  </div>
                  <details>
                    <summary>接続の変化と全変更件数</summary>
                    {diff.addedConnections.map((s, i) => (
                      <p key={`a${i}`}>＋ {s}</p>
                    ))}
                    {diff.removedConnections.map((s, i) => (
                      <p key={`r${i}`}>− {s}</p>
                    ))}
                    <p>
                      {diff.added.length +
                        diff.changed.length +
                        diff.removed.length}
                      手順に変化。最初の5件ずつを表示しています。
                    </p>
                  </details>
                </details>
              )}
              <nav className="input-step-strip" aria-label="入力が作った手順">
                {steps.slice(stepPage * 7, (stepPage + 1) * 7).map((s) => (
                  <button
                    key={s.stepKey}
                    className={
                      draft && diff?.added.some((n) => n.stepKey === s.stepKey)
                        ? "input-step--added"
                        : draft &&
                            diff?.changed.some(
                              (n) => n.after.stepKey === s.stepKey,
                            )
                          ? "input-step--changed"
                          : ""
                    }
                    aria-pressed={selected.stepKey === s.stepKey}
                    onClick={() => choose(s)}
                  >
                    <small>
                      {s.order} ·{" "}
                      {draft && diff?.added.some((n) => n.stepKey === s.stepKey)
                        ? "追加 · "
                        : draft &&
                            diff?.changed.some(
                              (n) => n.after.stepKey === s.stepKey,
                            )
                          ? "訂正 · "
                          : ""}
                      {s.meaning?.condition ||
                        (s.certainty === "explicit" ? "原文に明示" : "推定")}
                    </small>
                    <strong>{s.name}</strong>
                    {s.meaning?.result && <span>→ {s.meaning.result}</span>}
                  </button>
                ))}
              </nav>
              {steps.length > 7 && (
                <div className="kg-pagination">
                  <button
                    disabled={stepPage === 0}
                    onClick={() => setStepPage((p) => p - 1)}
                  >
                    前の7手順
                  </button>
                  <span>
                    {stepPage * 7 + 1}–
                    {Math.min(steps.length, (stepPage + 1) * 7)} /{" "}
                    {steps.length}
                  </span>
                  <button
                    disabled={(stepPage + 1) * 7 >= steps.length}
                    onClick={() => setStepPage((p) => p + 1)}
                  >
                    次の7手順
                  </button>
                </div>
              )}
              <WorkflowReading
                key={key}
                graph={preview}
                workflowId={workflow!.id}
                initialStepId={process?.id}
                initialDepth="step"
                onStepChange={(id) => {
                  const s = steps.find(
                    (s) =>
                      id ===
                      getWorkflowProcesses(preview, workflow!.id).find(
                        (n) => n.canonicalKey.split(":").at(-1) === s.stepKey,
                      )?.id,
                  );
                  if (s) choose(s);
                }}
                onDetail={(id) => {
                  const node = preview.nodes.find((n) => n.id === id);
                  if (node?.workflowId === workflow!.id)
                    setEdit(structuredClone(selected));
                  else if (node?.workflowId) onSelect(node.workflowId);
                }}
              />
              <div className="input-correction-actions">
                <button
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => setEdit(structuredClone(selected))}
                >
                  この手順の理解を訂正する
                </button>
                <button disabled={busy} onClick={removeStep}>
                  この手順を候補から除外
                </button>
              </div>
              {edit && (
                <fieldset className="input-inline-editor" disabled={busy}>
                  <legend>手順{selected.order}を訂正する</legend>
                  <label className="kg-edit-field">
                    行うこと
                    <textarea
                      value={edit.action}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          action: e.target.value,
                          name: e.target.value.slice(0, 60),
                        })
                      }
                    />
                  </label>
                  <label className="kg-edit-field">
                    担当する人
                    <input
                      value={edit.actor ?? ""}
                      onChange={(e) =>
                        setEdit({ ...edit, actor: e.target.value || null })
                      }
                    />
                  </label>
                  <label className="kg-edit-field">
                    部署
                    <input
                      value={edit.department ?? ""}
                      onChange={(e) =>
                        setEdit({ ...edit, department: e.target.value || null })
                      }
                    />
                  </label>
                  <label className="kg-edit-field">
                    実行するSystem
                    <input
                      value={edit.executingSystem ?? ""}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          executingSystem: e.target.value || null,
                          executionMode: edit.executionMode,
                        })
                      }
                    />
                  </label>
                  <label className="kg-edit-field">
                    実行方法
                    <select
                      value={edit.executionMode}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          executionMode: e.target
                            .value as ExtractionReviewStep["executionMode"],
                        })
                      }
                    >
                      <option value="unknown">未確認</option>
                      <option value="manual">人が行う</option>
                      <option value="automatic">システムが自動で行う</option>
                      <option value="mixed">人とシステムが行う</option>
                    </select>
                  </label>
                  {(
                    [
                      ["purpose", "この作業が必要な理由"],
                      ["basis", "判断の根拠"],
                      ["result", "何が決まる・変わるか"],
                      ["next", "その結果、次に動く仕事"],
                      ["condition", "実行する条件"],
                    ] as const
                  ).map(([field, label]) => (
                    <label className="kg-edit-field" key={field}>
                      {label}
                      <input
                        value={edit.meaning?.[field] ?? ""}
                        onChange={(e) =>
                          setEdit({
                            ...edit,
                            meaning: {
                              purpose: "",
                              basis: "",
                              result: "",
                              next: "",
                              condition: "",
                              halt: false,
                              ...edit.meaning,
                              certainty: "confirmed",
                              evidence: "利用者が構造の確認中に補足",
                              [field]: e.target.value,
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                  <label>
                    <input
                      type="checkbox"
                      checked={edit.meaning?.halt ?? false}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          meaning: {
                            purpose: "",
                            basis: "",
                            result: "",
                            next: "",
                            condition: "",
                            ...edit.meaning,
                            certainty: "confirmed",
                            evidence: "利用者が構造の確認中に補足",
                            halt: e.target.checked,
                          },
                        })
                      }
                    />
                    ここで停止・保留する
                  </label>
                  <p>原文の根拠と利用者の訂正を別々に保持します。</p>
                  <button className="button-primary" onClick={applyEdit}>
                    訂正を構造へ反映
                  </button>
                  <button onClick={() => setEdit(null)}>閉じる</button>
                </fieldset>
              )}
              <details className="input-addition">
                <summary>この手順の後に、話の続きを足す</summary>
                <label className="kg-edit-field">
                  続きの話
                  <textarea
                    value={addition}
                    onChange={(e) => setAddition(e.target.value)}
                  />
                </label>
                <button
                  className="button-primary"
                  disabled={busy || !addition.trim()}
                  onClick={async () => {
                    const lines = memo.split(/[。\n]+/).filter((s) => s.trim());
                    const anchor = lines.findIndex(
                      (s) => s.trim() === selected.evidence.trim(),
                    );
                    if (anchor < 0) {
                      setError(
                        "本文中の位置を特定できません。左の本文で追加する位置を指定し、読み直してください。",
                      );
                      return;
                    }
                    lines.splice(anchor + 1, 0, addition);
                    const text = lines.join("。\n");
                    onTranscripts({ ...transcripts, [key]: text });
                    setAddition("");
                    await organize(undefined, text);
                  }}
                >
                  続きを構造につなぐ
                </button>
              </details>
              {known.length > 0 && (
                <details>
                  <summary>既存の業務へ受け渡す接続を補足する</summary>
                  <label className="kg-edit-field">
                    接続する業務を検索
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <label className="kg-edit-field">
                    次の業務
                    <select
                      value={target}
                      onChange={(e) => {
                        setTarget(e.target.value);
                        setTargetStep("");
                      }}
                    >
                      <option value="">選択してください</option>
                      {known
                        .filter((w) => w.name.includes(query))
                        .map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="kg-edit-field">
                    受け取る手順
                    <select
                      value={targetStep}
                      onChange={(e) => setTargetStep(e.target.value)}
                    >
                      <option value="">受取手順は未確認</option>
                      {getWorkflowProcesses(graph, target).map((p) => (
                        <option
                          key={p.id}
                          value={p.canonicalKey.split(":").at(-1)}
                        >
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="kg-edit-field">
                    何を渡して、どの仕事が動くか
                    <input
                      value={handoffText}
                      onChange={(e) => setHandoffText(e.target.value)}
                    />
                  </label>
                  <button
                    disabled={!target || !handoffText.trim() || busy}
                    onClick={() => {
                      update({
                        ...review,
                        handoffs: [
                          ...(review.handoffs ?? []),
                          {
                            fromStepKey: selected.stepKey,
                            targetWorkflowId: target,
                            targetStepKey: targetStep || undefined,
                            data: selected.data
                              .filter((d) =>
                                ["send", "update", "create"].includes(
                                  d.operation,
                                ),
                              )
                              .map((d) => d.name),
                            description: handoffText,
                            evidence: `利用者の補足：${handoffText}`,
                            certainty: "confirmed",
                          },
                        ],
                      });
                      setTarget("");
                      setHandoffText("");
                    }}
                  >
                    この業務へ接続する
                  </button>
                </details>
              )}
              <details className="input-questions">
                <summary>
                  未確認・矛盾を確かめる · {review.questions.length}質問 /{" "}
                  {review.warnings.length}注意
                </summary>
                {review.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
                {review.questions.map((q, i) => (
                  <label className="kg-edit-field" key={i}>
                    {q.question}
                    <small>{q.reason}</small>
                    <textarea
                      value={draft?.answers[q.question] ?? ""}
                      onChange={(e) =>
                        onDraft(key, {
                          ...ensureDraft(review),
                          answers: {
                            ...(draft?.answers ?? {}),
                            [q.question]: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                ))}
                <button
                  disabled={
                    busy ||
                    !draft ||
                    !Object.values(draft.answers).some((a) => a.trim())
                  }
                  onClick={refine}
                >
                  回答を追加して読み直す
                </button>
                {draft?.answerHistory.map((a, i) => (
                  <p key={i}>
                    補足の根拠：{a.question} / {a.answer}
                  </p>
                ))}
              </details>
              <details onToggle={(e) => setAdvanced(e.currentTarget.open)}>
                <summary>System・Data・接続・技術詳細を細かく編集する</summary>
                {advanced &&
                  renderAdvanced?.({
                    draft: ensureDraft(review),
                    onChange: update,
                    onSave: save,
                    onDiscard: () => onDraft(key, null),
                    onRefine: refine,
                    busy: busy || stale,
                  })}
              </details>
              <div className="input-save-actions">
                <p>
                  {draft
                    ? "保存すると、この原文と訂正した構造が蓄積されます。"
                    : `保存済み：${workflow?.name}`}
                </p>
                <button
                  className="button-primary"
                  disabled={
                    !draft || busy || stale || !draft.workflow.name.trim()
                  }
                  onClick={save}
                >
                  {busy ? "処理中…" : "この構造を保存する"}
                </button>
              </div>
            </>
          )}
          {!!review?.excludedSteps?.length && (
            <details>
              <summary>
                利用者が除外した手順 · {review.excludedSteps.length}
                件（原文は保持）
              </summary>
              {review.excludedSteps.map((s) => (
                <article key={s.stepKey}>
                  <p>{s.name}</p>
                  <p>原文：{s.evidence}</p>
                  <button
                    disabled={busy}
                    onClick={() => {
                      const restored = [...review.steps];
                      restored.splice(
                        Math.min(s.order - 1, restored.length),
                        0,
                        s,
                      );
                      update({
                        ...review,
                        steps: restored.map((p, i) => ({ ...p, order: i + 1 })),
                        excludedSteps: review.excludedSteps?.filter(
                          (p) => p.stepKey !== s.stepKey,
                        ),
                      });
                      setStepKey(s.stepKey);
                      setStepPage(
                        Math.floor(
                          Math.min(s.order - 1, restored.length - 1) / 7,
                        ),
                      );
                    }}
                  >
                    候補へ戻す（接続は読み直して確認）
                  </button>
                </article>
              ))}
            </details>
          )}
          {review && !selected && (
            <p>手順がありません。本文を補足して読み直してください。</p>
          )}
        </section>
      </div>
    </section>
  );
}
