"use client";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  buildWorkflowReviewFromGraph,
  getWorkflowProcesses,
  type ExtractionReview,
  type ExtractionReviewStep,
  type LensGraph,
  type Workflow,
  type FollowUpAnswer,
} from "@/lib/graph";
import {
  diffReviews,
  editReviewStep,
  stepToolsFromText,
  insertNoteAfterEvidence,
  NEW_MEMO_ID,
  previewReviewGraph,
  type InputDraft,
  transcriptsForSave,
} from "@/lib/review-workbench";
import { InputReviewFlow } from "./InputReviewFlow";
import { InputStripConnection } from "./InputStripConnection";
import { reviewStripConnection } from "@/lib/review-paths";
import { aiStatusLabel, type AIConfigurationStatus } from "@/lib/ai/status";
import { reviewedWorkflowName } from "@/lib/input-knowledge";
import { InputOrganization } from "./InputOrganization";
import { InputSystemDependencies } from "./InputSystemDependencies";
import { createQuestionReferenceFinder, referenceAnswer } from "@/lib/question-evidence";

const REVIEW_PAGE_SIZE = 3;

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
  onExplore,
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
  onExplore?: () => void;
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
  const [operation, setOperation] = useState<"organize" | "save">("organize");
  const [waitingSeconds, setWaitingSeconds] = useState(0);
  useEffect(() => {
    if (!busy) return;
    setWaitingSeconds(0);
    const started = Date.now();
    const timer = setInterval(() => setWaitingSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  const [error, setError] = useState("");
  const [aiConfig, setAIConfig] = useState<AIConfigurationStatus | null>(null);
  const [aiResponse, setAIResponse] = useState<
    "unchecked" | "success" | "failure"
  >("unchecked");
  const [aiConfigError, setAIConfigError] = useState(false);
  const [edit, setEdit] = useState<ExtractionReviewStep | null>(null);
  const [toolText, setToolText] = useState<string | null>(null);
  const editorRef = useRef<HTMLFieldSetElement>(null);
  const focusRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLElement>(null);
  const [lastSavedId, setLastSavedId] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [questionDestination, setQuestionDestination] = useState("");
  const questionsRef = useRef<HTMLDetailsElement>(null);
  const [mobilePane, setMobilePane] = useState<"note" | "flow">("note");
  const [noteQuery, setNoteQuery] = useState("");
  const [addition, setAddition] = useState("");
  const [target, setTarget] = useState("");
  const [targetStep, setTargetStep] = useState("");
  const [handoffText, setHandoffText] = useState("");
  const [handoffDirection, setHandoffDirection] = useState<
    "outgoing" | "incoming" | "reference"
  >("outgoing");
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
    followUpAnswers: FollowUpAnswer[];
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
    let cancelled = false;
    fetch("/api/ai/status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("status unavailable");
        const value: AIConfigurationStatus = await response.json();
        if (!cancelled) setAIConfig(value);
      })
      .catch(() => {
        if (!cancelled) setAIConfigError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    setStepKey(focusedStepId?.split(":").at(-1) ?? "");
    const index =
      review?.steps.findIndex(
        (s) => s.stepKey === focusedStepId?.split(":").at(-1),
      ) ?? -1;
    setStepPage(Math.floor(Math.max(0, index) / REVIEW_PAGE_SIZE));
    setEdit(null);
    setError("");
    setAdvanced(false);
    setQuestionsOpen(false);
    setTarget("");
    setAddition("");
    setRevisionDetail(null);
  }, [key]);
  useEffect(() => {
    if (!questionDestination || questionDestination !== key) return;
    setQuestionsOpen(true);
    setQuestionDestination("");
    requestAnimationFrame(() => questionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [key, questionDestination]);
  useEffect(() => {
    if (edit) {
      editorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
      editorRef.current
        ?.querySelector("textarea")
        ?.focus({ preventScroll: true });
    }
  }, [edit?.stepKey]);
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
  const diff = useMemo(() => review
    ? diffReviews(draft?.baseline ?? currentReview, review, graph)
    : null, [draft?.baseline, currentReview, review, graph]);
  const selectedChange = draft ? diff?.changed.find(c => c.after.stepKey === selected?.stepKey) : undefined;
  const stale = draft
    ? draft.sourceNotes !== memo
    : !!saved && (savedTranscripts[key] ?? "") !== memo;
  const known = graph.workflows.filter(
    (w) =>
      (w.scenario ?? "current") === (workflow?.scenario ?? "current") &&
      w.id !== workflow?.id,
  );
  const findQuestionReferences = useMemo(() => createQuestionReferenceFinder(graph, savedTranscripts), [graph, savedTranscripts]);
  const relatedQuestions = useMemo(() => saved ? graph.workflows.flatMap(w =>
    (w.reviewContext?.questions ?? []).flatMap(q =>
      findQuestionReferences(w.id, q).some(r => r.workflow.id === saved.id)
        ? [{ workflow: w, question: q }] : [],
    ),
  ).slice(0, 3) : [], [graph, saved, findQuestionReferences]);
  const ensureDraft = (nextReview: ExtractionReview): InputDraft =>
    draft
      ? { ...draft, review: nextReview }
      : {
          workflow: workflow!,
          review: nextReview,
          baseline: currentReview,
          provider: "human-edit",
          sourceNotes: saved ? (savedTranscripts[key] ?? "") : memo,
          answerHistory: saved?.reviewContext?.followUpAnswers ?? [],
          answers: {},
        };
  const update = (nextReview: ExtractionReview) => {
    const next = ensureDraft(nextReview);
    next.workflow = {
      ...next.workflow,
      name: reviewedWorkflowName(
        next.workflow,
        nextReview,
        review?.organization?.title,
      ),
    };
    onDraft(key, next);
  };
  const choose = (s: ExtractionReviewStep) => {
    setStepKey(s.stepKey);
    setStepPage(Math.floor(steps.indexOf(s) / REVIEW_PAGE_SIZE));
    setEdit(null);
    const p = getWorkflowProcesses(preview, workflow!.id).find(
      (n) => n.canonicalKey.split(":").at(-1) === s.stepKey,
    );
    if (p) onFocusStep?.(workflow!.id, p.id);
    requestAnimationFrame(() =>
      focusRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
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
    setOperation("organize");
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
      if (payload.provider !== "local-demo-extractor") setAIResponse("success");
      const next: InputDraft = {
        workflow: {
          ...w,
          name: reviewedWorkflowName(
            w,
            payload.review,
            before?.organization?.title,
          ),
        },
        review: payload.review,
        provider: payload.provider,
        sourceNotes: text,
        baseline: before,
        answers: {},
        answerHistory: payload.followUpAnswers ?? answers,
      };
      onDraft(requestKey, next);
      setMobilePane("flow");
      if (requestKey === latest.current.key) {
        const changes = diffReviews(before, next.review);
        const focus =
          changes.added[0] ??
          changes.changed[0]?.after ??
          next.review.steps.find((s) => s.stepKey === selected?.stepKey) ??
          next.review.steps[0];
        if (focus) {
          setStepKey(focus.stepKey);
          setStepPage(
            Math.floor(next.review.steps.indexOf(focus) / REVIEW_PAGE_SIZE),
          );
        }
        requestAnimationFrame(() =>
          (before ? focusRef.current : stripRef.current)?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          }),
        );
      }
    } catch (cause) {
      if (aiConfig?.configured) setAIResponse("failure");
      setError(
        cause instanceof Error ? cause.message : "読み取りに失敗しました。",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!draft || stale || busy) return;
    setOperation("save");
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
      setLastSavedId(draft.workflow.id);
      requestAnimationFrame(() =>
        stripRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存に失敗しました。");
    } finally {
      setBusy(false);
    }
  }
  function applyEdit() {
    if (!edit || !review || !selected) return;
    const corrected = toolText === null ? edit : {
      ...edit, systems: stepToolsFromText(edit.systems, toolText),
    };
    const patch = Object.fromEntries(
      Object.entries(corrected).filter(
        ([field, value]) =>
          field !== "humanEdits" &&
          JSON.stringify(selected[field as keyof ExtractionReviewStep]) !==
            JSON.stringify(value),
      ),
    );
    update(editReviewStep(review, selected.stepKey, patch));
    setEdit(null);
    requestAnimationFrame(() =>
      focusRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
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
      incomingHandoffs: review.incomingHandoffs?.filter(
        (h) => h.toStepKey !== selected.stepKey,
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
    <section
      className="input-workbench"
      aria-label="話を入力して構造を育てる"
      data-pane={mobilePane}
    >
      <header className="page-header">
        <div>
          <h1>仕事の話を、流れにする</h1>
          <p>
            まずは知っていることをそのまま書いてください。流れを見ながら、足したり直したりできます。
          </p>
        </div>
      </header>
      <aside
        className="input-ai-status"
        data-mode={aiConfig?.configured ? aiResponse : "local"}
        aria-label="話を整理する方法"
      >
        <div>
          <strong>
            {aiConfigError
              ? "AI設定を確認できません"
              : aiStatusLabel(aiConfig, aiResponse)}
          </strong>
          <p>
            {aiConfig?.configured
              ? aiResponse === "success"
                ? "AIが読み取った候補です。原文と照らして、違うところを直してください。"
                : aiResponse === "failure"
                  ? "メモと前の候補は残っています。接続を確認して、もう一度整理できます。"
                  : "話を整理するときにAIへ送ります。この画面を開いてからの応答は未確認です。保存した構造の整理方法は、流れの上に表示します。"
              : aiConfigError
                ? "メモは書けます。整理を実行した結果で、使われた方法を確認してください。"
                : aiConfig
                  ? "今は書かれた文を簡易的に並べます。曖昧な話の意味や自由な補足の理解は、AI接続後に確かめます。"
                  : "メモを書きながら、整理方法の確認を待てます。"}
          </p>
        </div>
        <details>
          <summary>整理方法と設定</summary>
          {aiConfig?.configured ? (
            <p>
              設定したモデル：{aiConfig.model}
              {aiConfig.runtime === "codex"
                ? "（このPCのCodexログインを利用）"
                : ""}
              。AIの応答成功と、内容が正しいかの確認は別です。
            </p>
          ) : (
            <p>
              管理者がAIの接続先・モデル・認証を設定すると、話の意味をAIで整理できます。
            </p>
          )}
          <p>
            接続に失敗した場合、簡易整理へ自動で切り替えません。元のメモを保ってエラーを表示します。
          </p>
        </details>
      </aside>
      {busy && (
        <aside className="input-processing" role="status">
          <strong>
            {operation === "save"
              ? "道具・情報を既存の構造と照合して保存しています"
              : "話を読み取り、人・道具・情報の流れを整理しています"}
          </strong>
          <span aria-hidden="true"> · {waitingSeconds}秒</span>
          <p>メモと前の候補を保ったまま、結果を待っています。</p>
          {waitingSeconds >= 20 && operation === "organize" && aiConfig?.configured && (
            <p>AIの応答を待っています。結果が届いたら、保存前に内容を確かめられます。</p>
          )}
        </aside>
      )}
      <nav className="input-mobile-tabs" aria-label="メモと流れの表示切替">
        <button
          aria-pressed={mobilePane === "note"}
          onClick={() => setMobilePane("note")}
        >
          1 話を書く
        </button>
        <button
          aria-pressed={mobilePane === "flow"}
          onClick={() => setMobilePane("flow")}
        >
          2 流れを確かめる{draft ? " · 保存前" : ""}
        </button>
      </nav>
      <div className="input-workbench-grid">
        <section className="input-note-pane">
          <div className="input-note-heading">
            <h2>
              <span className="input-section-number">1</span> 話を書く
            </h2>
            {key !== NEW_MEMO_ID && (
              <button
                className="button-secondary"
                disabled={busy}
                onClick={() => {
                  onSelect(NEW_MEMO_ID);
                  setMobilePane("note");
                }}
              >
                新しい話を書く
              </button>
            )}
          </div>
          <p className="input-note-context">
            {key === NEW_MEMO_ID
              ? "名前や業務の範囲は、後から決められます。"
              : workflow?.name}
          </p>
          {(graph.workflows.length > 0 ||
            Object.keys(drafts).some((id) => id !== key)) && (
            <details className="input-switch-note">
              <summary>保存した話・下書きに戻る</summary>
              <label className="kg-edit-field">
                話を探す
                <input
                  value={noteQuery}
                  onChange={(e) => setNoteQuery(e.target.value)}
                  placeholder="仕事の名前で検索"
                />
              </label>
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
                  {saved && <option value={saved.id}>{saved.name}</option>}
                  {graph.workflows
                    .filter(
                      (w) => w.id !== saved?.id && w.name.includes(noteQuery),
                    )
                    .slice(0, 20)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                </select>
              </label>
              <small>検索に合う話を20件まで表示します。</small>
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
            </details>
          )}
          <label className="kg-edit-field input-main-note">
            仕事についてのメモ
            <textarea
              disabled={busy}
              value={memo}
              onChange={(e) =>
                onTranscripts({ ...transcripts, [key]: e.target.value })
              }
              placeholder={
                "例えば…\n注文がメールで届く。\n担当者がExcelで確認し、SAPへ入力する。\n足りないときは、生産管理に相談する。\n\n箇条書きでも、まだ曖昧な話でも大丈夫です。"
              }
            />
          </label>
          <button
            className="button-primary"
            disabled={busy || !memo.trim()}
            onClick={() => organize()}
          >
            {busy ? "処理中…" : review ? "変更を流れに反映 →" : "流れを見る →"}
          </button>
          <p className="flow-explanation">
            保存前に確認・訂正できます。元のメモも残ります。
          </p>
          {!memo.trim() && !review && (
            <button
              className="input-text-button"
              onClick={() =>
                onTranscripts({
                  ...transcripts,
                  [key]:
                    "注文がメールで届く。\n営業担当がExcelで注文内容を確認する。\n営業担当がSAPへ受注を入力する。",
                })
              }
            >
              例文を入れて試す
            </button>
          )}
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
            <div>
              <h2>
                <span className="input-section-number">2</span> 流れを確かめる
              </h2>
              <p>
                {review
                  ? `${steps.length}手順 · ${draft ? "保存前の候補" : "保存済み"}`
                  : "入力すると、人・道具・情報のつながりが見えます。"}
              </p>
            </div>
            {review && (
              <button
                className="button-primary"
                disabled={
                  !draft ||
                  busy ||
                  stale ||
                  !!edit ||
                  !draft.workflow.name.trim()
                }
                onClick={save}
              >
                {busy
                  ? operation === "save" ? "道具・情報を照合して保存中…" : "話を整理中…"
                  : edit
                    ? "訂正を反映してから保存"
                    : draft
                      ? "3 この流れを保存"
                      : "保存済み"}
              </button>
            )}
          </div>
          {review?.extraction && (
            <p className="input-extraction-origin">
              この構造の整理：
              {review.extraction.method === "ai"
                ? `${review.extraction.model ?? review.extraction.provider}（AI）`
                : "簡易整理"}
              {review.steps.some((s) => s.humanEdits?.length) ||
              review.organization?.origin === "human" ||
              review.systemDependencies?.some(d => d.origin === "human") ||
              review.handoffs?.some((h) => h.origin === "human") ||
              review.incomingHandoffs?.some((h) => h.origin === "human")
                ? " · 人の訂正を含む"
                : ""}
            </p>
          )}
          {review && (
            <><InputOrganization review={review} busy={busy} onChange={update} />
            <InputSystemDependencies key={key} review={review} busy={busy} onChange={update} /></>
          )}
          {error && (
            <p role="alert" className="error-message input-mobile-error">
              {error}
            </p>
          )}
          {!draft && !stale && lastSavedId === workflow?.id && (
            <p role="status" className="input-saved-notice">
              保存しました。原文と流れが、会社の全体像にも加わっています。
            </p>
          )}
          {stale && (
            <p role="status" className="input-stale">
              メモに変更があります。「変更を流れに反映」で、表示中の流れを更新してください。
            </p>
          )}
          {!review && (
            <div
              className="input-empty-structure"
              aria-label="入力後の見え方の例"
            >
              <span className="input-example-label">
                例えば、こんな流れが見えます
              </span>
              <ol className="input-example-flow">
                <li>
                  <small>メール</small>
                  <strong>注文が届く</strong>
                  <span>注文の内容</span>
                </li>
                <li>
                  <small>担当者 · Excel</small>
                  <strong>内容を確認する</strong>
                  <span>確認した内容</span>
                </li>
                <li>
                  <small>担当者 · SAP</small>
                  <strong>受注を入力する</strong>
                  <span>次の仕事へ</span>
                </li>
              </ol>
              <p>
                「誰が」「何を使って」「何を決めるか」を、手順ごとに確かめられます。
              </p>
              <div className="input-example-hint">
                <strong>すべてを知っていなくても大丈夫</strong>
                <p>
                  書かれていない担当や判断は「未確認」に。流れを見てから補足できます。
                </p>
              </div>
            </div>
          )}
          {review && selected && (
            <>
              {draft && diff && (
                <details className="input-diff">
                  <summary>
                    今回の反映：追加 {diff.added.length}件 · 訂正{" "}
                    {diff.changed.length}件 · 除外 {diff.removed.length}件
                  </summary>
                  <div className="input-diff-items">
                    {(diff.removedQuestions.length > 0 || diff.addedQuestions.length > 0) && (
                      <p>確認事項：{(draft.baseline ?? currentReview)?.questions.length ?? 0}件 → {review.questions.length}件</p>
                    )}
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
                    {diff.removedQuestions.map((q, i) => <p key={`rq${i}`}>候補から外れた確認事項：{q.question}</p>)}
                    {diff.addedQuestions.map((q, i) => <p key={`aq${i}`}>新しい確認事項：{q.question}</p>)}
                    <p>
                      {diff.added.length +
                        diff.changed.length +
                        diff.removed.length}
                      手順に変化。最初の5件ずつを表示しています。
                    </p>
                  </details>
                </details>
              )}
              <nav
                ref={stripRef}
                className="input-step-strip"
                aria-label="入力が作った手順"
              >
                {steps
                  .slice(
                    stepPage * REVIEW_PAGE_SIZE,
                    (stepPage + 1) * REVIEW_PAGE_SIZE,
                  )
                  .map((s, i, visible) => (
                    <Fragment key={s.stepKey}>
                      <button
                        key={s.stepKey}
                        className={
                          draft &&
                          diff?.added.some((n) => n.stepKey === s.stepKey)
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
                          {draft &&
                          diff?.added.some((n) => n.stepKey === s.stepKey)
                            ? "追加 · "
                            : draft &&
                                diff?.changed.some(
                                  (n) => n.after.stepKey === s.stepKey,
                                )
                              ? "訂正 · "
                              : ""}
                          {s.meaning?.halt
                            ? "停止・保留"
                            : s.actor || s.executingSystem || "担当は未確認"}
                        </small>
                        <strong>{s.name}</strong>
                        {s.meaning?.condition && (
                          <span>条件：{s.meaning.condition}</span>
                        )}
                      </button>
                      {i < visible.length - 1 && (
                        <InputStripConnection
                          connection={reviewStripConnection(review, s.stepKey, visible[i + 1].stepKey)}
                          choose={choose}
                        />
                      )}
                    </Fragment>
                  ))}
              </nav>
              {draft && (
                <p className="input-generation-note">
                  {draft.provider.startsWith("local")
                    ? "簡易抽出による候補です。"
                    : draft.provider === "human-edit"
                      ? "人が補足・訂正した候補です。"
                      : "AIが整理した候補です。"}
                  手順を選んで、話と合っているか確かめてください。
                </p>
              )}
              {steps.length > REVIEW_PAGE_SIZE && (
                <div className="kg-pagination">
                  <button
                    disabled={stepPage === 0}
                    onClick={() =>
                      choose(steps[(stepPage - 1) * REVIEW_PAGE_SIZE])
                    }
                  >
                    前の3手順
                  </button>
                  <span>
                    {stepPage * REVIEW_PAGE_SIZE + 1}–
                    {Math.min(steps.length, (stepPage + 1) * REVIEW_PAGE_SIZE)}{" "}
                    / {steps.length}
                  </span>
                  <button
                    disabled={(stepPage + 1) * REVIEW_PAGE_SIZE >= steps.length}
                    onClick={() =>
                      choose(steps[(stepPage + 1) * REVIEW_PAGE_SIZE])
                    }
                  >
                    次の3手順
                  </button>
                </div>
              )}
              <div ref={focusRef} className="input-focus-anchor">
                <InputReviewFlow
                  review={review}
                  selected={selected}
                  graph={preview}
                  workflowId={workflow!.id}
                  busy={busy}
                  choose={choose}
                  onOverview={() =>
                    stripRef.current?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    })
                  }
                  onEdit={() => {
                    setEdit(structuredClone(selected));
                    setToolText(null);
                  }}
                  onExclude={removeStep}
                  onWorkflow={(id, stepKey) => {
                    const step = getWorkflowProcesses(graph, id).find(
                      (p) => p.canonicalKey.split(":").at(-1) === stepKey,
                    );
                    if (step) onFocusStep?.(id, step.id);
                    onSelect(id);
                  }}
                />
                {selectedChange && (
                  <details className="input-review-changes" key={selectedChange.after.stepKey}>
                    <summary>この手順はどう変わったか · {selectedChange.details.length}項目</summary>
                    <ul>{selectedChange.details.map((detail, i) => <li key={i}>{detail}</li>)}</ul>
                  </details>
                )}
              </div>
              {edit && (
                <fieldset
                  ref={editorRef}
                  className="input-inline-editor"
                  disabled={busy}
                >
                  <legend>手順{selected.order}の理解を訂正</legend>
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
                    使う道具
                    <textarea rows={2} value={toolText ?? edit.systems.map(tool => tool.name).join("\n")}
                      onChange={e => setToolText(e.target.value)} />
                    <small>1行に1つ。使う道具が分からない場合は空欄にできます。</small>
                  </label>
                  <label className="kg-edit-field">
                    何が決まる・変わるか
                    <input
                      value={edit.meaning?.result ?? ""}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          meaning: {
                            purpose: "",
                            basis: "",
                            next: "",
                            condition: "",
                            halt: false,
                            ...edit.meaning,
                            certainty: "confirmed",
                            evidence: "利用者が構造の確認中に補足",
                            result: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  <details>
                    <summary>部署・道具・情報・判断の条件も訂正する</summary>
                    <label className="kg-edit-field">
                      部署
                      <input
                        value={edit.department ?? ""}
                        onChange={(e) =>
                          setEdit({
                            ...edit,
                            department: e.target.value || null,
                          })
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
                    {edit.data.map((data, i) => (
                      <label className="kg-edit-field" key={i}>
                        {data.name}の使い方
                        <select aria-label={`${i + 1}番目の情報・${data.name}の使い方`}
                          value={data.operation} onChange={e => setEdit({ ...edit,
                            data: edit.data.map((d, index) => index === i ? { ...d,
                              operation: e.target.value as typeof d.operation,
                            } : d),
                          })}>
                          <option value="read">参照する</option>
                          <option value="receive">受け取る</option>
                          <option value="create">新しく作る</option>
                          <option value="update">更新する</option>
                          <option value="send">渡す</option>
                        </select>
                        <small>根拠：{data.evidence}</small>
                      </label>
                    ))}
                    {(
                      [
                        ["purpose", "この作業が必要な理由"],
                        ["basis", "判断の根拠"],
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
                  </details>
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
                    const text = insertNoteAfterEvidence(
                      memo,
                      selected.evidence,
                      addition,
                    );
                    if (text === null) {
                      setError(
                        "メモ中の位置を一つに特定できません。メモに直接続きを書き足し、「変更を流れに反映」を押してください。",
                      );
                      return;
                    }
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
                  <summary>前後の業務との接続を補足・訂正する</summary>
                  <label className="kg-edit-field">
                    この手順との関係
                    <select
                      value={handoffDirection}
                      onChange={(e) => {
                        setHandoffDirection(
                          e.target.value as
                            | "incoming"
                            | "outgoing"
                            | "reference",
                        );
                        setTarget("");
                        setTargetStep("");
                      }}
                    >
                      <option value="outgoing">
                        この手順から、次の業務へ渡す
                      </option>
                      <option value="incoming">
                        前の業務から、この手順で受け取る
                      </option>
                      <option value="reference">
                        前の業務が作った情報を、この手順で使う
                      </option>
                    </select>
                  </label>
                  <label className="kg-edit-field">
                    接続する業務を検索
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <label className="kg-edit-field">
                    {handoffDirection !== "outgoing"
                      ? handoffDirection === "reference"
                        ? "情報を作る業務"
                        : "受取元の業務"
                      : "次の業務"}
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
                    {handoffDirection !== "outgoing"
                      ? handoffDirection === "reference"
                        ? "情報を作る手順"
                        : "送り出す手順"
                      : "受け取る手順"}
                    <select
                      value={targetStep}
                      onChange={(e) => setTargetStep(e.target.value)}
                    >
                      <option value="">
                        {handoffDirection !== "outgoing"
                          ? "前の業務の手順は未確認"
                          : "受取手順は未確認"}
                      </option>
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
                    {handoffDirection !== "outgoing"
                      ? handoffDirection === "reference"
                        ? "何の情報を、何のために使うか"
                        : "何を受け取って、この仕事が動くか"
                      : "何を渡して、どの仕事が動くか"}
                    <input
                      value={handoffText}
                      onChange={(e) => setHandoffText(e.target.value)}
                    />
                  </label>
                  <button
                    disabled={!target || !handoffText.trim() || busy}
                    onClick={() => {
                      if (handoffDirection !== "outgoing") {
                        update({
                          ...review,
                          incomingHandoffs: [
                            ...(review.incomingHandoffs ?? []).filter(
                              (h) =>
                                !(
                                  h.toStepKey === selected.stepKey &&
                                  h.sourceWorkflowId === target
                                ),
                            ),
                            {
                              via:
                                handoffDirection === "reference"
                                  ? "reference"
                                  : "handoff",
                              sourceWorkflowId: target,
                              sourceStepKey: targetStep || undefined,
                              toStepKey: selected.stepKey,
                              data: selected.data
                                .filter((d) =>
                                  ["read", "receive"].includes(d.operation),
                                )
                                .map((d) => d.name),
                              description: handoffText,
                              evidence: `利用者の補足：${handoffText}`,
                              certainty: "confirmed",
                              origin: "human",
                            },
                          ],
                        });
                        setTarget("");
                        setHandoffText("");
                        return;
                      }
                      update({
                        ...review,
                        handoffs: [
                          ...(review.handoffs ?? []).filter(
                            (h) =>
                              !(
                                h.fromStepKey === selected.stepKey &&
                                h.targetWorkflowId === target
                              ),
                          ),
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
                            origin: "human",
                          },
                        ],
                      });
                      setTarget("");
                      setHandoffText("");
                    }}
                  >
                    {handoffDirection !== "outgoing"
                      ? handoffDirection === "reference"
                        ? "この情報の作成元へつなぐ"
                        : "この業務から受け取る"
                      : "この業務へ接続する"}
                  </button>
                </details>
              )}
              <details className="input-questions" ref={questionsRef} open={questionsOpen}
                onToggle={e => setQuestionsOpen(e.currentTarget.open)}>
                <summary>
                  未確認・矛盾を確かめる · {review.questions.length}質問 /{" "}
                  {review.warnings.length}注意
                </summary>
                {review.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
                {review.questions.map((q, i) => (
                  <article key={i} aria-label={`確認事項：${q.question}`}>
                  <label className="kg-edit-field">
                    {q.question}
                    <small>{q.reason}</small>
                    <textarea
                      disabled={busy}
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
                  {!!saved && findQuestionReferences(saved.id, q).length > 0 && (
                    <details className="input-question-reference">
                      <summary>この確認に関係する、保存済みの話</summary>
                      <p>接続と情報の記録から見つけた候補です。回答が含まれるかを、読み直した流れで確認できます。</p>
                      {findQuestionReferences(saved.id, q).map(reference => (
                        <article key={reference.workflow.id}>
                          <strong>{reference.workflow.name}</strong>
                          <blockquote>{reference.sourceNotes}</blockquote>
                          <button disabled={busy || !!edit} onClick={() => organize([
                            ...(draft?.answerHistory ?? saved.reviewContext?.followUpAnswers ?? []),
                            referenceAnswer(q.question, reference),
                          ])}>{reference.workflow.name}を補足にして読み直す</button>
                        </article>
                      ))}
                    </details>
                  )}
                  </article>
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
                {!!(draft?.answerHistory ?? saved?.reviewContext?.followUpAnswers)?.length && (
                  <details>
                    <summary>補足に使った根拠 · {(draft?.answerHistory ?? saved?.reviewContext?.followUpAnswers)!.length}件</summary>
                    {(draft?.answerHistory ?? saved?.reviewContext?.followUpAnswers)!.map((a, i) => (
                      <article key={i}>
                        <p>確認事項：{a.question}</p>
                        {a.reference && <p>補足元：{a.reference.workflowName} · 補足当時の本文を保持
                          {savedTranscripts[a.reference.workflowId] !== a.answer && <strong> · 元の話はその後更新されています</strong>}
                          {graph.workflows.some(w => w.id === a.reference!.workflowId) && (
                            <button disabled={busy} onClick={() => onSelect(a.reference!.workflowId)}>補足元の現在の話を開く</button>
                          )}
                        </p>}
                        <blockquote>{a.answer}</blockquote>
                        {a.referenceReading && <details>
                          <summary>AIによる補足の読み取り · {a.referenceReading.model}</summary>
                          <p>この確認事項についての読み取りです。元の話の事実とは区別して確認できます。</p>
                          {a.referenceReading.facts.map((fact, j) => <article key={j}>
                            <p>{fact.text} · {fact.certainty === "inferred" ? "推定・要確認" : "原文の記述"}</p>
                            <blockquote>{fact.evidence.join(" / ")}</blockquote>
                          </article>)}
                          {a.referenceReading.unanswered.map((text, j) => <p key={j}>未確認：{text}</p>)}
                        </details>}
                      </article>
                    ))}
                  </details>
                )}
              </details>
              <details onToggle={(e) => setAdvanced(e.currentTarget.open)}>
                <summary>システム・情報・接続を詳しく編集する</summary>
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
                  {stale
                    ? "メモの変更は、まだ流れへ反映されていません。"
                    : draft
                      ? "確認できたところまで保存できます。未確認の内容も、そのまま残ります。"
                      : "この話と流れは保存されています。続きを書くと、ここにつながります。"}
                </p>
                {!draft && onExplore && (
                  <button onClick={onExplore}>会社の全体像で見る →</button>
                )}
                {!draft && relatedQuestions.length > 0 && (
                  <aside className="input-question-reference">
                    <strong>この話を、以前の未確認事項の補足にも使えます</strong>
                    {relatedQuestions.map(({ workflow: w, question: q }, i) => (
                      <p key={i}><button disabled={busy} onClick={() => {
                        setQuestionDestination(w.id);
                        onSelect(w.id);
                      }}>{w.name}の確認事項を開く</button><br />{q.question}</p>
                    ))}
                  </aside>
                )}
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
                          Math.min(s.order - 1, restored.length - 1) /
                            REVIEW_PAGE_SIZE,
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
            <p>{review.systemDependencies?.some(d => !d.rejected) ? "この話は道具どうしの関係として整理されています。作業の話を足すと、ここから流れを育てられます。" : "手順がありません。本文を補足して読み直してください。"}</p>
          )}
        </section>
      </div>
    </section>
  );
}
