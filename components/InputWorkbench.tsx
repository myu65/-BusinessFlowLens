"use client";
import React, {
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
  NEW_MEMO_ID,
  previewReviewGraph,
  previewInputDrafts,
  inputKeyForWorkflow,
  type InputDraft,
  transcriptsForSave,
} from "@/lib/review-workbench";
import { InputReviewFlow } from "./InputReviewFlow";
import { InputFlowCanvas } from "./InputFlowCanvas";
import { InputRelations } from "./InputRelations";
import { INPUT_CANVAS_PAGE_SIZE, inputStepName } from "@/lib/input-canvas";
import { addReviewNote, appendReviewSource, reviewAdditionContext, type ReviewInsertion } from "@/lib/review-addition";
import { aiStatusLabel, type AIConfigurationStatus } from "@/lib/ai/status";
import { reviewedWorkflowName } from "@/lib/input-knowledge";
import { InputOrganization } from "./InputOrganization";
import { InputSystemDependencies } from "./InputSystemDependencies";
import { createQuestionReferenceFinder, referenceAnswer } from "@/lib/question-evidence";

const REVIEW_PAGE_SIZE = INPUT_CANVAS_PAGE_SIZE;

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
  onExplore?: (workflowId: string, stepId?: string) => void;
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
  const [operation, setOperation] = useState<"organize" | "addition" | "save">("organize");
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
    "unchecked" | "success" | "failure" | "unusable"
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
  const [mobilePane, setMobilePane] = useState<"note" | "flow" | "details">("note");
  const [workbenchTab, setWorkbenchTab] = useState<"flow" | "information" | "systems" | "history">("flow");
  const [memoFilter, setMemoFilter] = useState<"all" | "drafts" | "questions">("all");
  const [memoPage, setMemoPage] = useState(0);
  const detailPaneRef = useRef<HTMLElement>(null);
  const [noteQuery, setNoteQuery] = useState("");
  const [addition, setAddition] = useState("");
  const [insertion, setInsertion] = useState<ReviewInsertion | null>(null);
  const [rememberedInsertion, setRememberedInsertion] = useState<ReviewInsertion | null>(null);
  const [additionNotice, setAdditionNotice] = useState("");
  const [undoAddition, setUndoAddition] = useState<{ draft: InputDraft | null; memo: string; review: ExtractionReview } | null>(null);
  const additionRef = useRef<HTMLTextAreaElement>(null);
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
    setWorkbenchTab("flow");
    setQuestionsOpen(false);
    setTarget("");
    setRememberedInsertion(null);
    try {
      const raw = sessionStorage.getItem(`lens-addition:${projectId}:${key}`);
      if (!raw) setAddition("");
      else {
        try {
          const pending = JSON.parse(raw) as { note?: string; placement?: ReviewInsertion };
          setAddition(typeof pending.note === "string" ? pending.note : "");
          if (typeof pending.placement?.afterStepKey === "string") setRememberedInsertion(pending.placement);
        } catch { setAddition(raw); }
      }
    } catch { setAddition(""); }
    setInsertion(null);
    setAdditionNotice("");
    setUndoAddition(null);
    setRevisionDetail(null);
  }, [key, projectId]);
  useEffect(() => {
    if (!questionDestination || questionDestination !== key) return;
    setQuestionsOpen(true);
    setMobilePane("flow");
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
  const navigationGraph = useMemo(() => previewInputDrafts(graph, drafts), [graph, drafts]);
  const preview = useMemo(
    () =>
      workflow && review ? previewReviewGraph(navigationGraph, workflow, review) : navigationGraph,
    [navigationGraph, workflow, review],
  );
  const steps = [...(review?.steps ?? [])].sort((a, b) => a.order - b.order);
  const selected = steps.find((s) => s.stepKey === stepKey) ?? steps[0];
  const diff = useMemo(() => review
    ? diffReviews(draft?.baseline ?? currentReview, review, graph)
    : null, [draft?.baseline, currentReview, review, graph]);
  const selectedChange = draft ? diff?.changed.find(c => c.after.stepKey === selected?.stepKey) : undefined;
  const pendingAnswers = !!review?.questions.some(q => draft?.answers[q.question]?.trim());
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
    if (window.matchMedia("(max-width: 900px)").matches) setMobilePane("details");
    requestAnimationFrame(() => detailPaneRef.current?.scrollTo({ top: 0 }));
  };
  function openAddition(placement?: ReviewInsertion) {
    if (!selected || !review || busy || stale) return;
    if (!placement && addition.trim()) {
      if (!rememberedInsertion || !review.steps.some(s => s.stepKey === rememberedInsertion.afterStepKey) ||
        (rememberedInsertion.transition && !review.transitions.some(t => JSON.stringify(t) === JSON.stringify(rememberedInsertion.transition)))) {
        setError("追加する場所を、図の＋で選んでください。入力中の話は残っています。"); return;
      }
      placement = rememberedInsertion;
    }
    const outgoing = review.transitions.filter(t => t.fromStepKey === selected.stepKey);
    const next = placement ?? { afterStepKey: selected.stepKey, ...(outgoing.length === 1 ? { transition: outgoing[0] } : {}) };
    setInsertion(next); setRememberedInsertion(next);
    const anchor = review.steps.find(s => s.stepKey === next.afterStepKey);
    if (anchor) choose(anchor);
    if (addition.trim()) try { sessionStorage.setItem(`lens-addition:${projectId}:${key}`, JSON.stringify({ note: addition, placement: next })); } catch { /* The text remains in the editor. */ }
    setEdit(null);
    setError("");
    setMobilePane("details");
    requestAnimationFrame(() => { detailPaneRef.current?.scrollTo({ top: 0 }); additionRef.current?.focus({ preventScroll: true }); });
  }
  function nameForStep(stepKey: string) {
    const step = review?.steps.find(s => s.stepKey === stepKey);
    return step ? inputStepName(step) : "手順は未確認";
  }
  function writeAddition(value: string) {
    setAddition(value);
    try { sessionStorage.setItem(`lens-addition:${projectId}:${key}`, JSON.stringify({ note: value, placement: insertion ?? rememberedInsertion })); } catch { /* Keep the text in the current editor if browser storage is unavailable. */ }
  }
  async function addNote() {
    if (!insertion || !review || !workflow || !addition.trim() || busy || stale) return;
    const requestKey = key, before = review, placement = insertion, note = addition.trim();
    const beforeDraft = draft ?? null, source = memo;
    if (!placement.transition && before.transitions.some(t => t.fromStepKey === placement.afterStepKey)) return;
    setOperation("addition"); setBusy(true); setError("");
    let additionFailure: "failure" | "unusable" = "failure";
    try {
      const response = await fetch("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interview: note, workflow, graph: preview, previousReview: null, followUpAnswers: [], additionContext: reviewAdditionContext(before, placement) }) });
      const payload = await response.json();
      if (!response.ok) {
        additionFailure = payload.code === "invalid_response" ? "unusable" : "failure";
        throw new Error(payload.error ?? "追加した話を読み取れませんでした。");
      }
      const result = addReviewNote(before, payload.review, placement, note, crypto.randomUUID());
      const text = appendReviewSource(source, note);
      const next: InputDraft = { ...ensureDraft(result.review), baseline: before, sourceNotes: text, provider: payload.provider };
      onDraft(requestKey, next);
      onTranscripts({ ...latest.current.transcripts, [requestKey]: text });
      if (payload.provider !== "local-demo-extractor") setAIResponse("success");
      if (latest.current.key === requestKey) {
        setUndoAddition({ draft: beforeDraft, memo: source, review: result.review });
        setAddition(""); setInsertion(null); setWorkbenchTab("flow"); setMobilePane("flow");
        try { sessionStorage.removeItem(`lens-addition:${projectId}:${requestKey}`); } catch { /* The source is already retained in the input draft. */ }
        setAdditionNotice(result.addedKeys.length ? `${result.addedKeys.length}手順を追加しました。図で選ぶと、担当や道具を確認・編集できます。` : "話を追加しました。手順の数は変わりません。関連する情報・システムや確認事項で、反映した内容を確かめられます。");
        const focus = result.review.steps.find(s => s.stepKey === result.addedKeys[0]);
        if (focus) { setStepKey(focus.stepKey); setStepPage(Math.floor(result.review.steps.indexOf(focus) / REVIEW_PAGE_SIZE)); }
        requestAnimationFrame(() => { detailPaneRef.current?.scrollTo({ top: 0 }); });
      }
    } catch (cause) {
      if (aiConfig?.configured) setAIResponse(additionFailure);
      setError(cause instanceof Error ? cause.message : "追加した話を読み取れませんでした。");
    } finally { setBusy(false); }
  }
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
    let responseFailure: "failure" | "unusable" = "failure";
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
      if (!response.ok) {
        responseFailure = payload.code === "invalid_response" ? "unusable" : "failure";
        throw new Error(payload.error ?? "構造化に失敗しました。");
      }
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
      setWorkbenchTab("flow");
      if (requestKey === latest.current.key) {
        if (!next.review.steps.length) setQuestionsOpen(true);
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
          (!focus ? questionsRef.current : before ? focusRef.current : stripRef.current)?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          }),
        );
      }
    } catch (cause) {
      if (aiConfig?.configured) setAIResponse(responseFailure);
      setError(
        cause instanceof Error ? cause.message : "読み取りに失敗しました。",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (pendingAnswers) { setError("入力した回答を、確認事項の見直しで流れへ反映してから保存してください。"); return; }
    if (!draft || stale || busy || addition.trim()) return;
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
      setUndoAddition(null);
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
    if (!edit || !review || !selected || edit.data.some(data => !data.name.trim())) return;
    const corrected = {
      ...edit, data: edit.data.map(data => ({ ...data, name: data.name.trim() })),
      systems: toolText === null ? edit.systems : stepToolsFromText(edit.systems, toolText),
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
  const memoComposer = (<>
          <label className="kg-edit-field input-main-note">
            仕事についてのメモ
            <textarea
              disabled={busy}
              value={memo}
              onChange={(e) =>
                onTranscripts({ ...transcripts, [key]: e.target.value })
              }
              placeholder={
                "例えば「注文はメールで届いて、営業担当がExcelで確認します」\n\n分かったことをひとつ書くだけで始められます。続きは図を見ながら足せます。"
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
  </>);
  const stepDetail = review && selected ? (<>
              <div ref={focusRef} className="input-focus-anchor">
                {!edit && <InputReviewFlow
                  review={review}
                  selected={selected}
                  graph={preview}
                  unsavedWorkflowIds={Object.values(drafts).map(d => d.workflow.id)}
                  workflowId={workflow!.id}
                  busy={busy}
                  choose={choose}
                  onOverview={() => {
                    setMobilePane("flow");
                    setWorkbenchTab("flow");
                    requestAnimationFrame(() => stripRef.current?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    }));
                  }}
                  onEdit={() => {
                    setEdit(structuredClone(selected));
                    setToolText(null);
                  }}
                  onExclude={removeStep}
                  onWorkflow={(id, stepKey) => {
                    const step = getWorkflowProcesses(preview, id).find(
                      (p) => p.canonicalKey.split(":").at(-1) === stepKey,
                    );
                    if (step) onFocusStep?.(id, step.id);
                    onSelect(inputKeyForWorkflow(drafts, id));
                  }}
                />}
                {selectedChange && selectedChange.details.length > 0 && (
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
                      実行するシステム
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
                      <div role="group" aria-label={`${i + 1}番目の情報を訂正`} key={i}>
                        <label className="kg-edit-field">
                          情報{i + 1}の名前
                          <input aria-label={`${i + 1}番目の情報の名前`} value={data.name}
                            aria-invalid={!data.name.trim()}
                            onChange={e => setEdit({ ...edit,
                              data: edit.data.map((d, index) => index === i ? { ...d, name: e.target.value } : d),
                            })} />
                          {!data.name.trim() && <small>名前を入れてください。不要な情報は、使い方から「この手順では使わない」を選べます。</small>}
                        </label>
                        <label className="kg-edit-field">
                          {data.name.trim() || `情報${i + 1}`}の使い方
                          <select aria-label={data.name.trim() ? `${i + 1}番目の情報・${data.name}の使い方` : `${i + 1}番目の情報の使い方`}
                            value={data.operation} onChange={e => setEdit({ ...edit,
                              data: e.target.value === "unused" ? edit.data.filter((_, index) => index !== i)
                                : edit.data.map((d, index) => index === i ? { ...d,
                                  operation: e.target.value as typeof d.operation,
                                } : d),
                            })}>
                            <option value="read">参照する</option>
                            <option value="receive">受け取る</option>
                            <option value="create">情報を新たに作る</option>
                            <option value="update">更新する</option>
                            <option value="send">渡す</option>
                            <option value="unused">この手順では使わない</option>
                          </select>
                          <small>根拠：{data.evidence}</small>
                        </label>
                      </div>
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
                  <button className="button-primary" disabled={edit.data.some(data => !data.name.trim())} onClick={applyEdit}>
                    訂正を構造へ反映
                  </button>
                  <button onClick={() => setEdit(null)}>閉じる</button>
                </fieldset>
              )}
              <button className="input-add-work" disabled={busy || stale || !!edit} onClick={() => openAddition()}>＋ この手順の続きに作業を足す</button>
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

  </>) : (<p className="input-detail-empty">手順を選ぶと、誰が何をし、何が決まるかをここで確認できます。</p>);
  const savedHistory = (<>
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
    {!revisions.length && <p className="input-unconfirmed">保存すると、原文と構造の履歴がここに残ります。</p>}
  </>);
  const noteEntries = [
    ...Object.entries(drafts).filter(([id]) => !graph.workflows.some(w => w.id === id)).map(([id, d]) => ({ id, name: d.workflow.name, pending: true, questions: d.review.questions.length, text: transcripts[id] ?? d.sourceNotes })),
    ...[...graph.workflows].reverse().map(w => ({ id: w.id, name: drafts[w.id]?.workflow.name ?? w.name, pending: !!drafts[w.id], questions: (drafts[w.id]?.review ?? w.reviewContext)?.questions?.length ?? 0, text: transcripts[w.id] ?? "" })),
  ].filter(n => (memoFilter !== "drafts" || n.pending) && (memoFilter !== "questions" || n.questions > 0) && `${n.name} ${n.text}`.includes(noteQuery));
  const notePage = Math.max(0, Math.min(memoPage, Math.ceil(noteEntries.length / 6) - 1));
  return (
    <section
      className="input-workbench"
      aria-label="話を入力して構造を育てる"
      data-pane={mobilePane}
    >
      <div className="input-workbench-heading">
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
                  : aiResponse === "unusable"
                    ? "AIから応答はありましたが、候補として表示できませんでした。メモと前の候補を保っています。再試行できます。"
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
      </div>
      {busy && (
        <aside className="input-processing" role="status">
          <strong>
            {operation === "save"
              ? "道具・情報を既存の構造と照合して保存しています"
              : operation === "addition" ? "追加した話だけを読み取っています" : "話を読み取り、人・道具・情報の流れを整理しています"}
          </strong>
          <span aria-hidden="true"> · {waitingSeconds}秒</span>
          <p>メモと前の候補を保ったまま、結果を待っています。</p>
          {waitingSeconds >= 20 && operation !== "save" && aiConfig?.configured && (
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
        <button aria-pressed={mobilePane === "details"} disabled={!selected} onClick={() => setMobilePane("details")}>3 手順の詳細</button>
      </nav>
      <div className="input-workbench-grid">
        <section className="input-note-pane">
          <div className="input-note-heading">
            <h2>
              話とメモ
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
          {!review && memoComposer}
          {review && selected && <button className="input-add-work" disabled={busy || stale} onClick={() => openAddition()}>{addition.trim() ? "入力中の話を続ける" : "＋ 分かったことを足す"}</button>}
          {review && <p className="input-growing-hint">図の＋から、途中の作業も一つずつ足せます。</p>}
          <nav className="input-memo-filters" aria-label="メモの絞り込み">
            {([["all", "すべて"], ["drafts", "保存前"], ["questions", "未確認あり"]] as const).map(([value, label]) => <button key={value} aria-pressed={memoFilter === value} onClick={() => { setMemoFilter(value); setMemoPage(0); }}>{label}</button>)}
          </nav>
          <input className="input-memo-search" aria-label="メモ一覧を検索" value={noteQuery} placeholder="話・メモを検索" onChange={e => { setNoteQuery(e.target.value); setMemoPage(0); }} />
          {!!noteEntries.length && <nav className="input-memo-list" aria-label="蓄積した話と下書き">
            {noteEntries.slice(notePage * 6, (notePage + 1) * 6).map(n => <button key={n.id} aria-pressed={n.id === key} disabled={busy} onClick={() => { onSelect(n.id); setMobilePane("flow"); }}>
              <strong>{n.name}</strong><span>{n.text.slice(0, 68) || "原文は未登録"}</span><small>{n.pending ? "保存前" : "保存済み"}{n.questions ? ` · 未確認 ${n.questions}件` : ""}</small>
            </button>)}
          </nav>}
          {noteEntries.length > 6 && <div className="input-memo-pages"><button aria-label="前の6メモ" disabled={!notePage} onClick={() => setMemoPage(notePage - 1)}>←</button><small>{notePage * 6 + 1}–{Math.min(noteEntries.length, (notePage + 1) * 6)} / {noteEntries.length}</small><button aria-label="次の6メモ" disabled={(notePage + 1) * 6 >= noteEntries.length} onClick={() => setMemoPage(notePage + 1)}>→</button></div>}
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
          {review && <details className="input-original-source" open={stale}><summary>これまでの話を読む・書き直す</summary>{memoComposer}</details>}
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

        </section>
        <section className="input-structure-pane">
          <div className="input-structure-header">
            <div>
              <h2>
                {workflow?.name || "ここに、話の流れが見えます"}
              </h2>
              <p>
                {review
                  ? `${steps.length ? `${steps.length}手順` : "まだ作業は決めていません"} · ${draft ? "保存前の候補" : "保存済み"}`
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
                  !!addition.trim() ||
                  pendingAnswers ||
                  !!edit ||
                  !draft.workflow.name.trim()
                }
                onClick={save}
              >
                {busy
                  ? operation === "save" ? "道具・情報を照合して保存中…" : "話を整理中…"
                  : addition.trim() ? "追記を反映してから保存" : pendingAnswers ? "回答を反映してから保存" : edit
                    ? "訂正を反映してから保存"
                    : draft
                      ? review.steps.length ? "3 この流れを保存" : "3 話と確認事項を保存"
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
              {review.steps.some((s) => s.humanEdits?.some(e => e.field !== "placement")) ||
              review.organization?.origin === "human" ||
              review.systemDependencies?.some(d => d.origin === "human") ||
              review.handoffs?.some((h) => h.origin === "human") ||
              review.incomingHandoffs?.some((h) => h.origin === "human")
                ? " · 人の訂正を含む"
                : review.steps.some(s => s.humanEdits?.some(e => e.field === "placement")) ? " · 追加位置は人が指定" : ""}
            </p>
          )}
          {review && <>
            <details className="input-grouping"><summary>会社の中での位置 · {review.organization?.activity || "まだ分類していません"}{review.organization?.capability ? ` → ${review.organization.capability}` : ""}</summary><InputOrganization review={review} busy={busy} onChange={update} /></details>
            <nav className="input-context-tabs" aria-label="同じ話を違う視点で見る">
              {([["flow", "業務の流れ"], ["information", "関連する情報"], ["systems", "関係するシステム"], ["history", "履歴"]] as const).map(([value, label]) => <button key={value} aria-pressed={workbenchTab === value} onClick={() => setWorkbenchTab(value)}>{label}</button>)}
            </nav>
            {workbenchTab === "history" && savedHistory}
            {(workbenchTab === "information" || workbenchTab === "systems") && <InputRelations key={`${key}:${workbenchTab}`} review={review} kind={workbenchTab} selected={selected} choose={choose} />}
            {workbenchTab === "systems" && <InputSystemDependencies key={key} review={review} busy={busy} onChange={update} />}
          </>}
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
                    今回の反映：手順の追加 {diff.added.length}件 · 訂正{" "}
                    {diff.changed.length}件 · 除外 {diff.removed.length}件
                    {diff.addedConnections.length > 0 && <> · 関係の追加 {diff.addedConnections.length}件</>}
                    {diff.changedConnections.length > 0 && <> · 関係の訂正 {diff.changedConnections.length}件</>}
                    {diff.removedConnections.length > 0 && <> · 関係の除外 {diff.removedConnections.length}件</>}
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
                    {diff.changedConnections.map((change, i) => (
                      <p key={`c${i}`}>関係を更新<br />変更前：{change.before}<br />変更後：{change.after}</p>
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
              <div ref={stripRef as React.RefObject<HTMLDivElement>} hidden={workbenchTab !== "flow"} className="input-canvas-anchor">
                <InputFlowCanvas review={review} selected={selected} page={stepPage} onPage={page => choose(steps[page * REVIEW_PAGE_SIZE])} choose={choose}
                  added={draft ? diff?.added.map(s => s.stepKey) : []} changed={draft ? diff?.changed.map(c => c.after.stepKey) : []}
                  onInsert={transition => openAddition({ afterStepKey: transition.fromStepKey, transition })} editingDisabled={busy || stale || !!edit} />
                {additionNotice && <aside className="input-addition-notice" role="status"><p>{additionNotice}</p>{undoAddition && <button disabled={busy || draft?.review !== undoAddition.review || stale} onClick={() => {
                  onDraft(key, undoAddition.draft); onTranscripts({ ...transcripts, [key]: undoAddition.memo });
                  setUndoAddition(null); setAdditionNotice("今回の追加を取り消しました。"); setStepKey(""); setStepPage(0);
                }}>今回の追加を取り消す</button>}</aside>}
              </div>
              <details onToggle={(e) => setAdvanced(e.currentTarget.open)}>
                <summary>システム・情報・接続を詳しく編集する</summary>
                {advanced &&
                  renderAdvanced?.({
                    draft: ensureDraft(review),
                    onChange: update,
                    onSave: save,
                    onDiscard: () => onDraft(key, null),
                    onRefine: refine,
                    busy: busy || stale || !!addition.trim(),
                  })}
              </details>
              <div className="input-save-actions">
                <p>
                  {addition.trim() ? "入力中の追記は、まだ図に反映されていません。追加する場所を選んで続けられます。" : pendingAnswers ? "入力した回答は、まだ流れに反映されていません。下の確認事項を見直すと、反映を確認できます。" : stale
                    ? "メモの変更は、まだ流れへ反映されていません。"
                    : draft
                      ? "確認できたところまで保存できます。未確認の内容も、そのまま残ります。"
                      : "この話と流れは保存されています。続きを書くと、ここにつながります。"}
                </p>
                {!draft && saved && onExplore && (
                  <button disabled={busy || stale || pendingAnswers || !!addition.trim() || !!edit} onClick={() => {
                    const step = getWorkflowProcesses(graph, saved.id).find(n => n.canonicalKey === `process:${saved.id}:${selected?.stepKey}`);
                    onExplore(saved.id, step?.id);
                  }}>この仕事を会社の中で見る →</button>
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
          {review && !selected && (
            <aside className="input-empty-structure" aria-label="分かっている話から続きを書く">
              <strong>{review.systemDependencies?.some(d => !d.rejected) ? "道具どうしの関係が分かりました" : "まだ作業の流れは決めていません"}</strong>
              <p>{review.summary}</p>
              <p>全部を説明する必要はありません。知っていることをメモに足すか、下の確認事項に答えると、ここから流れが育ちます。分からないことは未確認のまま残せます。</p>
              {!draft && saved && onExplore && <button disabled={busy || stale || pendingAnswers || !!addition.trim() || !!edit}
                onClick={() => onExplore(saved.id)}>この仕事を会社の中で見る →</button>}
            </aside>
          )}
          {review && (
              <details className="input-questions" ref={questionsRef} open={questionsOpen}
                onToggle={e => setQuestionsOpen(e.currentTarget.open)}>
                <summary>
                  未確認・矛盾を確かめる · {review.questions.length}質問 /{" "}
                  {review.warnings.length}注意
                </summary>
                <button className="button-secondary" disabled={busy || !!edit || !!addition.trim() || !memo.trim()}
                  onClick={() => { if (draft) void refine(); else void organize(); }}>ここまでの話で確認事項を見直す</button>
                <p className="input-growing-hint">追記した話と入力した回答も含めて見直します。流れの変更は、保存前に確認できます。</p>
                {(edit || !!addition.trim()) && <p className="input-growing-hint">入力中の追記・訂正を反映すると、確認事項を見直せます。</p>}
                {review.warnings.map((w, i) => {
                  const shared = w.match(/^共有資産の同一性を要確認: (.*?) — ([\s\S]*)$/);
                  return shared ? <div key={i}>
                    <p>「{shared[1]}」が、すでにある情報・道具と同じかは未確認です。</p>
                    <details><summary>同じものと判断できなかった理由</summary><p>{shared[2]}</p></details>
                  </div> : <p key={i}>{w}</p>;
                })}
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

        </section>
        <section ref={detailPaneRef} className="input-detail-pane" aria-label="手順の確認と訂正">
          <header><h2>{insertion ? "作業を追加" : edit ? "手順を編集" : "選んだ手順"}</h2>{!insertion && selected && <small>{selected.humanEdits?.some(e => e.field !== "placement") ? "人が訂正" : selected.certainty === "explicit" ? "原文に明示" : "推定・要確認"}</small>}</header>
          {insertion && review ? <form className="input-insertion-form" onSubmit={e => { e.preventDefault(); void addNote(); }}>
            <h3>追加する場所</h3>
            <ol className="input-insertion-place">
              <li>{nameForStep(insertion.afterStepKey)}</li>
              <li>ここに作業を追加</li>
              <li>{insertion.transition ? nameForStep(insertion.transition.toStepKey) : "その後の接続は未確認"}</li>
            </ol>
            {insertion.transition?.condition && <p>この分岐の条件<br /><strong>{insertion.transition.condition}</strong></p>}
            {!insertion.transition && review.transitions.some(t => t.fromStepKey === insertion.afterStepKey) && <fieldset disabled={busy} className="input-insertion-branches"><legend>どの続きに追加しますか？</legend>{review.transitions.filter(t => t.fromStepKey === insertion.afterStepKey).map((t, i) => <button type="button" key={i} onClick={() => openAddition({ afterStepKey: insertion.afterStepKey, transition: t })}>{t.condition || "次の手順"}<br />→ {nameForStep(t.toStepKey)}</button>)}</fieldset>}
            <label className="kg-edit-field">追加する作業<textarea ref={additionRef} value={addition} disabled={busy} onChange={e => writeAddition(e.target.value)} placeholder="例えば「送る前に、物流担当がExcelで重量を確認します」" maxLength={4000} /></label>
            <p>分かった作業を一つから追加できます。図で場所を選んだことと、入力した話を記録します。</p>
            <button type="submit" className="button-primary" disabled={busy || !addition.trim() || (!insertion.transition && review.transitions.some(t => t.fromStepKey === insertion.afterStepKey))}>{busy ? "追加した話を読んでいます…" : "ここに追加して見る"}</button>
            <button type="button" disabled={busy} onClick={() => setInsertion(null)}>あとで続ける</button>
            {!!addition.trim() && <button type="button" disabled={busy} onClick={() => { writeAddition(""); setInsertion(null); }}>追記を取り消す</button>}
          </form> : stepDetail}
        </section>
      </div>
    </section>
  );
}
