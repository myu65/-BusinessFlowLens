"use client";
import { WorkBoundaryEditor } from "./WorkBoundaryEditor";
import { normalizeWorkBoundary } from "@/lib/work-boundary";
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
import { confirmHandoffInformation } from "@/lib/handoff-information";
import { DocumentInput, DocumentSourceEvidence } from "./DocumentInput";
import { documentWorkSource, documentWorkName, type DocumentEvidence, type SourceDocument, type DocumentWorkItem } from "@/lib/source-document";
import { DocumentOriginalPane } from "./DocumentOriginalPane";
import type { WorkflowCorrection } from "@/lib/ai/workflow-correction";
import {WorkflowMergePanel,WorkflowMergeHistory} from './WorkflowMergePanel';
import type {ProjectSnapshot} from '@/lib/storage/repository';
import {workflowMergeDestination,workflowMergeSite} from '@/lib/workflow-merge';
import {emptyLandscape} from '@/lib/landscape';
import {FlowConnectionEditor} from './FlowConnectionEditor';
import {InputDialogue} from './InputDialogue';
import {appendDialogueAnswer, dialogueAnswerStatus, includePendingDialogueAnswers} from '@/lib/input-dialogue';
import {applyDialogueReviewOperation,cancelDialogueTurns,dialogueConnection,emptyDialoguePlan,pendingDialoguePlan,validateDialoguePlan,type DialoguePlan,type DialogueSession,type DialogueTurn} from '@/lib/dialogue-operations';
import {DialogueOperationPanel} from './DialogueOperationPanel';
import {canonicalNodeId} from '@/lib/graph';
import {reviewSlug,dialogueUndoSnapshot} from '@/lib/review-workbench';
import {dialogueCandidate} from '@/lib/dialogue-candidate';
import {workflowMergeChoices,mergeStepDifferences,mergeValue,type WorkflowMergeChoice} from '@/lib/workflow-merge';
import {reviewStructureChanged,withCurrentExplanation} from '@/lib/current-understanding';
import {ReviewUnderstandingHistory} from './ReviewUnderstandingHistory';

const REVIEW_PAGE_SIZE = INPUT_CANVAS_PAGE_SIZE;
type DialoguePreview={plan:DialoguePlan;review?:ExtractionReview;workflow?:Workflow;graph?:LensGraph;candidate?:InputDraft;choices?:WorkflowMergeChoice[];details?:string[];expectedUpdatedAt?:string;recordId?:string;recordKind?:'workflow'|'asset';evidence:string;beforeDraft:InputDraft|null};

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
  onNavigate,
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
  onNavigate?: (view:string,workflowId?:string,focusId?:string) => void;
}) {
  const key = selectedId || NEW_MEMO_ID;
  const draft = drafts[key];
  const [operationPreview,setOperationPreview]=useState<DialoguePreview|null>(null);
  const [undoDialogue,setUndoDialogue]=useState<{draft:InputDraft|null;memo:string}|null>(null);
  const [pendingDocument,setPendingDocument]=useState<{key:string;workflow:Workflow;evidence:DocumentEvidence}|null>(null);
  const saved = graph.workflows.find((w) => w.id === key);
  const currentReview = useMemo(
    () => (saved ? buildWorkflowReviewFromGraph(graph, key) : null),
    [graph, key, saved],
  );
  const baseReview = draft?.review ?? currentReview;
  const baseWorkflow = draft?.workflow ?? saved ?? (pendingDocument?.key===key?pendingDocument.workflow:undefined);
  const review = operationPreview?.review ?? baseReview;
  const workflow = operationPreview?.workflow ?? baseWorkflow;
  const documentEvidence=review?.documentEvidence??(pendingDocument?.key===key?[pendingDocument.evidence]:undefined);
  const memo = transcripts[key] ?? "";
  const [query, setQuery] = useState("");
  const [documentInputOpen, setDocumentInputOpen] = useState(false);
  const documentReturnKey = useRef(key);
  const [stepKey, setStepKey] = useState("");
  const [stepPage, setStepPage] = useState(0);
  const [working, setBusy] = useState(false);
  const busy=working||!!operationPreview;
  const organizeRequest = useRef<AbortController | null>(null);
  const [organizeNotice, setOrganizeNotice] = useState("");
  const [correctionText, setCorrectionText] = useState("");
  const [correctionScope, setCorrectionScope] = useState("all");
  const [correctAnswerIndex,setCorrectAnswerIndex]=useState<number|undefined>();
  const [inputMode,setInputMode]=useState<'dialogue'|'summary'>('dialogue');
  useEffect(()=>{try{const value=localStorage.getItem('lens-input-mode');if(value==='dialogue'||value==='summary')setInputMode(value);}catch{}},[]);
  function changeInputMode(mode:'dialogue'|'summary'){setInputMode(mode);try{localStorage.setItem('lens-input-mode',mode);}catch{}}
  const [renameOpen, setRenameOpen] = useState(false);
  const [mergeOpen,setMergeOpen]=useState(false);
  const [undoCorrection,setUndoCorrection]=useState<{draft:InputDraft|null}|null>(null);
  useEffect(()=>{setCorrectionText("");setCorrectionScope("all");setCorrectAnswerIndex(undefined);setRenameOpen(false);setMergeOpen(false);setUndoCorrection(null);setOperationPreview(null);setUndoDialogue(null);},[key]);
  const [operation, setOperation] = useState<"organize" | "addition" | "save" | "dialogue">("organize");
  const [waitingSeconds, setWaitingSeconds] = useState(0);
  useEffect(() => {
    if (!working) return;
    setWaitingSeconds(0);
    const started = Date.now();
    const timer = setInterval(() => setWaitingSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [working]);
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
  const connectionEditorRef=useRef<HTMLDivElement>(null);
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
  const notePaneRef = useRef<HTMLElement>(null);
  const structurePaneRef = useRef<HTMLElement>(null);
  useEffect(()=>{if(operationPreview){notePaneRef.current?.scrollTo({top:0});structurePaneRef.current?.scrollTo({top:0});}},[operationPreview]);
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
  const [handoffData, setHandoffData] = useState<string[]>([]);
  const [handoffDirection, setHandoffDirection] = useState<
    "outgoing" | "incoming" | "reference"
  >("outgoing");
  useEffect(() => setHandoffData([]), [key, stepKey, handoffDirection]);
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
  const mergeGraph=useMemo(()=>{
    if(!draft)return graph;
    const candidate=previewReviewGraph(graph,draft.workflow,draft.review);
    return {...candidate,workflows:candidate.workflows.map(w=>w.id===draft.workflow.id?{...w,reviewContext:{...w.reviewContext!,followUpAnswers:draft.answerHistory}}:w)};
  },[graph,draft]);
  const preview = useMemo(
    () =>
      workflow && review ? previewReviewGraph(operationPreview?.graph??navigationGraph, workflow, review) : navigationGraph,
    [navigationGraph, workflow, review,operationPreview],
  );
  const steps = [...(review?.steps ?? [])].sort((a, b) => a.order - b.order);
  const selected = steps.find((s) => s.stepKey === stepKey) ?? steps[0];
  const diff = useMemo(() => review
    ? diffReviews(operationPreview?(operationPreview.plan.action==='merge_workflows'||operationPreview.workflow&&operationPreview.workflow.id!==baseWorkflow?.id?buildWorkflowReviewFromGraph(graph,operationPreview.workflow!.id):baseReview):draft?.baseline ?? currentReview, review, graph)
    : null, [draft?.baseline, currentReview, review, graph,operationPreview]);
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
    if(review&&reviewStructureChanged(review,nextReview))nextReview=withCurrentExplanation(nextReview,review,'図の訂正','利用者が図の確認中に訂正');
    if(nextReview===currentReview&&draft?.baseline===currentReview&&memo===(savedTranscripts[key]??'')&&
      !Object.values(draft.answers).some(answer=>answer.trim())&&JSON.stringify(draft.answerHistory)===JSON.stringify(saved?.reviewContext?.followUpAnswers??[])){
      onDraft(key,null);return;
    }
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
    documentStart?: { workflow: Workflow; key: string; evidence: DocumentEvidence },
    correction?: WorkflowCorrection,
    dialogueTurns?:DialogueTurn[],
  ) {
    if (!text.trim()) return false;
    if(!documentStart)answers=includePendingDialogueAnswers(answers,draft?.answers??{});
    const w = documentStart?.workflow ?? workflow ?? {
      id: `note-${crypto.randomUUID()}`,
      familyId: undefined,
      scenario: "current" as const,
      name: `入力した話：${text
        .trim()
        .split(/[。\n]/)[0]
        .slice(0, 24)}`,
    };
    const requestKey = documentStart?.key ?? key,
      before = documentStart ? null : review;
    setOperation("organize");
    setOrganizeNotice("");
    setBusy(true);
    setError("");
    setEdit(null);
    let responseFailure: "failure" | "unusable" = "failure";
    const controller = new AbortController();
    organizeRequest.current = controller;
    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interview: text,
          workflow: w,
          graph: latest.current.graph,
          previousReview: before,
          followUpAnswers: answers,
          projectId,
          documentEvidence: documentStart ? [documentStart.evidence] : documentEvidence,
          correction,
        }),
      });
      const payload = await response.json();
      if (controller.signal.aborted || organizeRequest.current !== controller) return false;
      if (!response.ok) {
        responseFailure = payload.code === "invalid_response" ? "unusable" : "failure";
        throw new Error(payload.error ?? "構造化に失敗しました。");
      }
      if (payload.provider !== "local-demo-extractor") setAIResponse("success");
      const next: InputDraft = {
        workflow: {
          ...w,
          name: reviewedWorkflowName(
            documentStart || (!before&&documentEvidence?.length) ? { ...w, name: `入力した話：${w.name}` } : w,
            payload.review,
            before?.organization?.title,
          ),
        },
        review: { ...payload.review, documentEvidence: documentStart ? [documentStart.evidence] : documentEvidence,dialogueHistory:dialogueTurns??before?.dialogueHistory },
        dialogueSession:draft?.dialogueSession?{turns:dialogueTurns??draft.dialogueSession.turns,plan:null}:undefined,
        dialogueUndo:dialogueTurns&&operationPreview?dialogueUndoSnapshot(operationPreview.beforeDraft,memo):draft?.dialogueUndo,
        provider: payload.provider,
        sourceNotes: text,
        baseline: before,
        answers: {},
        answerHistory: payload.followUpAnswers ?? answers,
      };
      onDraft(requestKey, next);
      if(correction){setUndoCorrection({draft:draft??null});setCorrectionText("");setOrganizeNotice("補足・訂正を反映した候補です。色の付いた手順と変更前後を確かめてから保存してください。");}
      setMobilePane("flow");
      setWorkbenchTab("flow");
      if (requestKey === latest.current.key) {
        if (!next.review.steps.length) setQuestionsOpen(true);
        const changes = diffReviews(before, next.review);
        const focus =
          (correction?.stepKey ? next.review.steps.find(s=>s.stepKey===correction.stepKey) : undefined) ?? changes.added[0] ??
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
      return true;
    } catch (cause) {
      if (controller.signal.aborted || organizeRequest.current !== controller) return false;
      if (aiConfig?.configured) setAIResponse(responseFailure);
      setError(
        cause instanceof Error ? cause.message : "読み取りに失敗しました。",
      );
      return false;
    } finally {
      if (organizeRequest.current === controller) { organizeRequest.current=null;setBusy(false); }
    }
  }
  async function startDocumentWork(document: SourceDocument, item: DocumentWorkItem) {
    const requestKey = `doc-${document.id}-${item.id}`;
    setDocumentInputOpen(false);
    const destination=workflowMergeDestination(graph,requestKey);
    if(destination!==requestKey&&graph.workflows.some(w=>w.id===destination)){onSelect(destination);setMobilePane('flow');return;}
    if (drafts[requestKey] || graph.workflows.some(w => w.id === requestKey)) { onSelect(requestKey); setMobilePane("flow"); return; }
    const text = documentWorkSource(document, item);
    const work:Workflow={id:requestKey,name:documentWorkName(item),scenario:item.scope,scenarioLabel:item.site||undefined,
      ...(item.site?{landscape:{...emptyLandscape(),site:item.site,evidence:'資料から読み取った工場・拠点の候補（要確認）'}}:{})};
    setPendingDocument({key:requestKey,workflow:work,evidence:{documentId:document.id,documentName:document.name,sha256:document.sha256,itemId:item.id,unitIds:[...new Set([...item.contextUnitIds,...item.unitIds])]}});
    onTranscripts({ ...latest.current.transcripts, [requestKey]: text });
    onSelect(requestKey);
    await organize([], text, { key: requestKey, workflow: work, evidence: {
      documentId: document.id, documentName: document.name, sha256: document.sha256, itemId: item.id, unitIds: [...new Set([...item.contextUnitIds, ...item.unitIds])],
    } });
  }

  function withdrawDocumentCandidates(documentId: string) {
    setOrganizeNotice("");setError("");
    const prefix = `doc-${documentId}-`;
    const savedIds = new Set(latest.current.graph.workflows.map(workflow => workflow.id));
    const keys = [...new Set([...Object.keys(drafts), ...Object.keys(latest.current.transcripts)])].filter(id => id.startsWith(prefix) && !savedIds.has(id));
    const remaining = { ...latest.current.transcripts };
    for (const id of keys) { onDraft(id, null); delete remaining[id]; }
    onTranscripts(remaining);
    if (keys.includes(key)) onSelect(keys.includes(documentReturnKey.current) ? NEW_MEMO_ID : documentReturnKey.current);
  }

  async function save(candidate?:InputDraft) {
    const savingDraft=candidate??draft;
    if (pendingAnswers) { setError("入力した回答を、確認事項の見直しで流れへ反映してから保存してください。"); return; }
    if (!savingDraft || stale || working || (operationPreview&&!candidate) || addition.trim()) return false;
    if(correctionText.trim()&&!candidate){setError("書いた補足・訂正を流れに反映してから保存してください。");return;}
    setOperation("save");
    setBusy(true);
    setError("");
    try {
      const allTranscripts = transcriptsForSave(
        latest.current.savedTranscripts,
        savingDraft.workflow.id,
        savingDraft.sourceNotes,
      );
      const response = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectName: "BusinessFlowLens",
          graph: latest.current.graph,
          workflow: savingDraft.workflow,
          review: savingDraft.review,
          transcripts: allTranscripts,
          sourceNotes: savingDraft.sourceNotes,
          followUpAnswers: savingDraft.answerHistory,
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
      onSelect(savingDraft.workflow.id);
      setLastSavedId(savingDraft.workflow.id);
      setUndoCorrection(null);
      setUndoAddition(null);
      setUndoDialogue(null);setOperationPreview(null);
      requestAnimationFrame(() =>
        stripRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      );
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存に失敗しました。");
      return false;
    } finally {
      setBusy(false);
    }
  }
  function receiveMerge(project:ProjectSnapshot,selectedId:string){
    if(onSaved)onSaved(project.graph,project.transcripts,key);
    else{onGraphApply(project.graph);onTranscripts(project.transcripts);}
    onDraft(key,null);onSelect(selectedId);setLastSavedId(selectedId);setMergeOpen(false);setUndoCorrection(null);setUndoAddition(null);
  }
  function applyEdit() {
    if (!edit || !review || !selected || edit.data.some(data => !data.name.trim())) return;
    const corrected = {
      ...edit, data: edit.data.map(data => ({ ...data, name: data.name.trim() })),
      boundary: normalizeWorkBoundary(edit.boundary),
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
  const answerHistory=draft?.answerHistory??saved?.reviewContext?.followUpAnswers??[];
  const newDialogue=answerHistory.slice(saved?.reviewContext?.followUpAnswers?.length??0);
  async function correctFromDialogue(text:string,correctIndex=correctAnswerIndex){
    if(correctIndex===undefined)return requestDialogueOperation(text);
    const scope=correctIndex===undefined&&correctionScope==='step'?selected?.stepKey:undefined;
    const question=correctIndex===undefined?(scope&&selected?`「${selected.name}」への補足・訂正`:'この仕事の流れへの補足・訂正'):answerHistory[correctIndex]?.question??'';
    const history=appendDialogueAnswer(answerHistory,question,text,'correction',correctIndex);
    const applied=await organize(history,memo,undefined,{text:text.trim(),stepKey:scope});
    if(applied)setCorrectAnswerIndex(undefined);
    return applied;
  }
  const dialogueSession:DialogueSession=draft?.dialogueSession??{turns:baseReview?.dialogueHistory??[],plan:baseReview?.dialogueHistory?.at(-1)?.state==='question'?baseReview.dialogueHistory.at(-1)!.plan??null:null};
  const dialogueTurn=(role:DialogueTurn['role'],text:string,state?:DialogueTurn['state'],plan?:DialoguePlan):DialogueTurn=>({id:crypto.randomUUID(),createdAt:new Date().toISOString(),role,text,...(state?{state}:{}),...(plan?{plan}:{})});
  const hasBusinessDraft=(value:InputDraft|null|undefined)=>!!value&&(!saved||mergeValue({...value.workflow,reviewContext:undefined})!==mergeValue({...saved,reviewContext:undefined})||value.sourceNotes!==(savedTranscripts[key]??'')||mergeValue({...value.review,dialogueHistory:undefined})!==mergeValue({...currentReview,dialogueHistory:undefined}));
  const operationWords=(turns:DialogueTurn[])=>{
    const start=turns.findLastIndex(t=>t.state==='applied'||t.state==='cancelled');return turns.slice(start+1).filter(t=>t.role==='user').map(t=>t.text).join('\n').slice(-4000);
  };
  async function dialogueRequest(url:string,body:unknown,signal?:AbortSignal){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});const p=await r.json();if(!r.ok)throw new Error(p.error??'操作案を確認できませんでした。');return p;}
  async function prepareDialogueOperation(plan:DialoguePlan,evidence:string,beforeDraft:InputDraft|null,storedCandidate?:InputDraft,signal?:AbortSignal){
    const prepared:NonNullable<typeof operationPreview>={plan,evidence,beforeDraft};
    if(plan.action==='refine'||plan.action==='insert'){
      let candidate=storedCandidate;
      if(candidate&&(candidate.workflow.id!==baseWorkflow!.id||mergeValue({...candidate.baseline,dialogueHistory:undefined})!==mergeValue({...baseReview,dialogueHistory:undefined})))throw new Error('変更前の流れが変わっています。いまの図から、補足・訂正する内容をもう一度教えてください。');
      if(!candidate){
        const correction={text:evidence,stepKey:plan.sourceId??(correctionScope==='step'?selected?.stepKey:undefined)};
        const answers=plan.action==='refine'?appendDialogueAnswer(answerHistory,'対話で補足・訂正した内容',evidence,'correction'):answerHistory;
        const placement={afterStepKey:plan.sourceId!,...(plan.targetId?{transition:dialogueConnection(baseReview!,plan)}:{})};
        const payload=await dialogueRequest('/api/extract',plan.action==='refine'?{interview:memo,workflow:baseWorkflow,graph,previousReview:baseReview,followUpAnswers:answers,projectId,documentEvidence:baseReview!.documentEvidence,correction}:{interview:evidence,workflow:baseWorkflow,graph:mergeGraph,previousReview:null,followUpAnswers:[],additionContext:reviewAdditionContext(baseReview!,placement)},signal);
        candidate=dialogueCandidate({action:plan.action,workflow:baseWorkflow!,before:baseReview!,source:memo,evidence,answers,placement,noteId:crypto.randomUUID(),extracted:payload});
      }
      prepared.candidate=candidate;prepared.review=candidate.review;prepared.workflow=candidate.workflow;
    }
    if(['connect','disconnect','restore_connection','exclude_step','restore_step','handoff','remove_handoff','incoming_handoff','remove_incoming_handoff','resolve_question','reopen_question'].includes(plan.action)){
      prepared.review=applyDialogueReviewOperation(baseReview!,plan,evidence);
      if(reviewStructureChanged(baseReview!,prepared.review)||['resolve_question','reopen_question'].includes(plan.action))prepared.review=withCurrentExplanation(prepared.review,baseReview!,'対話から図や確認事項を訂正',evidence);
    }
    if(plan.action==='rename_workflow'){prepared.workflow={...baseWorkflow!,name:plan.value!};prepared.review={...baseReview!,...(baseReview!.organization?{organization:{...baseReview!.organization,title:plan.value!,origin:'human',evidence}}:{})};}
    if(plan.action==='set_scenario'){prepared.workflow={...baseWorkflow!,scenario:plan.value as Workflow['scenario']};prepared.review=baseReview!;}
    if(plan.action==='merge_workflows'){
      if(Object.values(drafts).some(d=>d.workflow.id!==baseWorkflow!.id&&[plan.sourceId,plan.targetId].includes(d.workflow.id)))throw new Error('まとめる相手に保存前の変更があります。先にその業務を保存するか取り消してください。');
      const candidate=mergeGraph;
      const choices:WorkflowMergeChoice[]=plan.matches.length?plan.matches.map(m=>({sourceProcessId:canonicalNodeId(`process:${plan.sourceId}:${reviewSlug(m.sourceStepKey)}`),...(m.targetStepKey?{targetProcessId:canonicalNodeId(`process:${plan.targetId}:${reviewSlug(m.targetStepKey)}`),keep:m.keep??undefined}:{})})):workflowMergeChoices(candidate,plan.sourceId!,plan.targetId!);
      for(const choice of choices)if(choice.targetProcessId&&!choice.keep){
        if(plan.value==='source'||plan.value==='target')choice.keep=plan.value;
        else{const a=candidate.nodes.find(n=>n.id===choice.sourceProcessId)!,b=candidate.nodes.find(n=>n.id===choice.targetProcessId)!;const differences=a&&b?mergeStepDifferences(a,b,candidate):[];
          if(!differences.length)choice.keep='target';else throw new Error(`「${a.label}」の${differences.join('・')}が違います。元の業務（担当：${a.actor??'未確認'}）と統合先（担当：${b.actor??'未確認'}）の、どちらの手順の内容を採用しますか？`);}
      }
      const result=await dialogueRequest('/api/workflow-merge',{projectId,mode:'preview',sourceId:plan.sourceId,targetId:plan.targetId,choices,draft:hasBusinessDraft(draft)?draft:undefined});
      prepared.graph=result.graph;prepared.workflow=result.graph.workflows.find((w:Workflow)=>w.id===plan.targetId);prepared.review=buildWorkflowReviewFromGraph(result.graph,plan.targetId!);prepared.choices=choices;prepared.expectedUpdatedAt=result.expectedUpdatedAt;
      prepared.details=choices.map(c=>{const a=candidate.nodes.find(n=>n.id===c.sourceProcessId)!,b=candidate.nodes.find(n=>n.id===c.targetProcessId),chosen=c.keep==='source'?a:b,owner=candidate.workflows.find(w=>w.id===(c.keep==='source'?plan.sourceId:plan.targetId))?.name;return b?`${a?.label} → ${b.label}：同じ手順として「${owner}」の内容を採用。担当は${chosen?.actor??'未確認'}、道具は${candidate.edges.filter(e=>['uses','executes'].includes(e.relation)&&(e.source===chosen?.id||e.target===chosen?.id)).map(e=>candidate.nodes.find(n=>n.id===(e.source===chosen?.id?e.target:e.source))?.label).filter(Boolean).join('・')||'未確認'}`:`${a?.label}：別の手順として残す`;});
    }
    if(plan.action==='merge_assets'||plan.action==='rename_asset'){
      if(hasBusinessDraft(draft))throw new Error('いまの流れに保存前の変更があります。先に保存してから、システムや情報をまとめますか？');
      const result=await dialogueRequest('/api/asset-mutation',{projectId,mode:'preview',sourceId:plan.sourceId,targetId:plan.action==='merge_assets'?plan.targetId:undefined,name:plan.action==='rename_asset'?plan.value:undefined,evidence,acceptTargetProfile:plan.value==='target'});
      prepared.graph=result.graph;prepared.expectedUpdatedAt=result.expectedUpdatedAt;prepared.review=buildWorkflowReviewFromGraph(result.graph,baseWorkflow!.id);
      prepared.details=[`${result.sourceName} → ${result.targetName}${plan.action==='merge_assets'?'：以前の名前は別名として残す':'：同じIDを保って名前を変える'}`,`手順・情報の流れ・受渡しで直接つながる登録済みの業務は${result.affectedWorkflows.length}件。現行・将来案を含みます。原文と変更前の内容を履歴に残します。`];
    }
    if(plan.action==='undo'&&(undoDialogue||draft?.dialogueUndo)){
      const prior=(undoDialogue??draft?.dialogueUndo)!;prepared.review=prior.draft?.review??currentReview!;prepared.workflow=prior.draft?.workflow??saved!;
      prepared.candidate={...(prior.draft??{workflow:saved!,review:currentReview!,sourceNotes:savedTranscripts[key]??'',provider:'human-edit',baseline:currentReview,answers:{},answerHistory:saved?.reviewContext?.followUpAnswers??[]}),dialogueSession:undefined,dialogueUndo:undefined};
    }
    if(plan.action==='undo'&&!undoDialogue&&!draft?.dialogueUndo){
      if(hasBusinessDraft(draft))throw new Error('保存前の変更をまとめて取り消すか、特定の手順だけ戻すかを教えてください。');
      const records=[...(graph.knowledge?.workflowMerges??[]).filter(r=>r.state==='merged').map(r=>({id:r.id,kind:'workflow' as const,at:r.createdAt})),...(graph.knowledge?.assetMutations??[]).filter(r=>r.state==='applied').map(r=>({id:r.id,kind:'asset' as const,at:r.createdAt}))].sort((a,b)=>b.at.localeCompare(a.at));
      if(!records.length)throw new Error('直前の対話操作や、元に戻せる保存済みの統合が見つかりません。どの内容へ戻したいか教えてください。');
      prepared.recordId=records[0].id;prepared.recordKind=records[0].kind;
      const result=await dialogueRequest(records[0].kind==='workflow'?'/api/workflow-merge':'/api/asset-mutation',{projectId,mode:'preview-undo',recordId:records[0].id});
      prepared.expectedUpdatedAt=result.expectedUpdatedAt;prepared.graph=result.project.graph;prepared.workflow=result.project.graph.workflows.find((w:Workflow)=>w.id===(result.restoredId??baseWorkflow!.id));if(prepared.workflow)prepared.review=buildWorkflowReviewFromGraph(result.project.graph,prepared.workflow.id);
      if(prepared.workflow&&prepared.review)prepared.candidate={workflow:prepared.workflow,review:prepared.review,sourceNotes:result.project.transcripts[prepared.workflow.id]??'',provider:'human-edit',baseline:buildWorkflowReviewFromGraph(graph,prepared.workflow.id),answers:{},answerHistory:prepared.workflow.reviewContext?.followUpAnswers??[]};
    }
    return prepared;
  }
  async function requestDialogueOperation(text:string){
    if(!baseReview||!baseWorkflow||working||stale||edit||addition.trim())return false;
    setOperation('dialogue');setBusy(true);setError('');const requestKey=key,controller=new AbortController();organizeRequest.current=controller;
    const user=dialogueTurn('user',text.trim()),priorTurns=dialogueSession.turns,turns=[...priorTurns,user];
    try{
      const response=await dialogueRequest('/api/dialogue',{graph,workflow:baseWorkflow,review:baseReview,text:text.trim(),turns:priorTurns.slice(-10),selectedStepKey:selected?.stepKey},controller.signal);
      if(controller.signal.aborted||organizeRequest.current!==controller)return false;
      let plan=pendingDialoguePlan(validateDialoguePlan(response.plan,mergeGraph,baseWorkflow,baseReview),operationPreview?.plan),prepared:DialoguePreview|null=null;
      if(plan.action==='accept'&&operationPreview)return await acceptDialogueOperation([...turns,dialogueTurn('assistant',plan.message,'applied',plan)]);
      if(plan.action==='save'&&operationPreview)return await acceptDialogueOperation([...turns,dialogueTurn('assistant','表示している変更案を反映して保存します。','applied',plan)],true);
      if(plan.action==='cancel'){cancelDialogueOperation([...turns,dialogueTurn('assistant','案を取り消しました。変更前の図はそのままです。','cancelled',plan)]);return true;}
      if(plan.action==='accept')plan=emptyDialoguePlan('確認する操作案が見つかりません。','どの変更を反映したいか、名前や内容を教えてください。');
      if(['show','new_story','save'].includes(plan.action)){
        const history=[...turns,dialogueTurn('assistant',plan.action==='save'?'この流れを保存しました。元の話と変更の履歴も残っています。':plan.message,'applied',plan)],next={...ensureDraft(baseReview),review:{...baseReview,dialogueHistory:history},dialogueSession:{turns:history,plan:null}};
        if(plan.action==='save'){const result=await save(next);if(result)setCorrectionText('');return !!result;}
        if(operationPreview){onDraft(key,{...next,dialogueSession:{turns:history,plan:operationPreview.plan,evidence:operationPreview.evidence,preview:operationPreview.candidate}});setCorrectionText('');navigateDialoguePlan(plan);return true;}
        onDraft(key,next);setCorrectionText('');setOperationPreview(null);navigateDialoguePlan(plan);return true;
      }
      if(plan.action!=='ask')try{prepared=await prepareDialogueOperation(plan,plan.action==='refine'?text.trim():operationWords(turns),draft??null,undefined,controller.signal);}catch(error){plan=emptyDialoguePlan('変更する前に、一つ確かめます。',error instanceof Error?error.message:'どの内容を採用しますか？');}
      if(controller.signal.aborted||organizeRequest.current!==controller)return false;
      const history=[...turns.map(t=>operationPreview&&t.state==='proposed'?{...t,state:'cancelled' as const}:t),dialogueTurn('assistant',plan.question??plan.message,plan.action==='ask'?'question':'proposed',plan)];
      onDraft(requestKey,{...ensureDraft(baseReview),review:{...baseReview,dialogueHistory:history},dialogueSession:{turns:history,plan,evidence:prepared?.evidence,preview:prepared?.candidate}});
      if(latest.current.key===requestKey){setCorrectionText('');setOperationPreview(prepared);setMobilePane('flow');if(prepared?.review){setStepKey(prepared.review.steps.find(s=>s.stepKey===plan.sourceId)?.stepKey??prepared.review.steps[0]?.stepKey??'');setStepPage(0);}setOrganizeNotice(plan.action==='ask'?'対話で対象や内容を確かめています。図は変更していません。':'対話からの変更案を図に表示しています。確認してから反映できます。');}
      return true;
    }catch(error){if(controller.signal.aborted||organizeRequest.current!==controller)return false;onDraft(requestKey,{...ensureDraft(baseReview),review:{...baseReview,dialogueHistory:turns},dialogueSession:{turns,plan:null}});setError(error instanceof Error?error.message:'操作案を作れませんでした。');return false;}
    finally{if(organizeRequest.current===controller){organizeRequest.current=null;setBusy(false);}}
  }
  function cancelDialogueOperation(extraTurns?:DialogueTurn[]){
    const turns=cancelDialogueTurns(extraTurns??dialogueSession.turns);
    if(baseReview)onDraft(key,{...ensureDraft(baseReview),review:{...baseReview,dialogueHistory:turns},dialogueSession:{turns,plan:null}});
    setOperationPreview(null);setCorrectionText('');setOrganizeNotice('案を取り消しました。変更前の図と対話の履歴は残っています。');
  }
  function navigateDialoguePlan(plan:DialoguePlan){
    if(plan.action==='new_story'){onSelect(NEW_MEMO_ID);return;}
    if(['flow','information','systems','history'].includes(plan.value!)){setWorkbenchTab(plan.value as typeof workbenchTab);if(plan.sourceId){const s=baseReview!.steps.find(s=>s.stepKey===plan.sourceId);if(s)choose(s);}}
    else{const id=plan.workflowId??(plan.value==='assets'?baseWorkflow!.id:undefined),focus=plan.sourceId&&baseReview!.steps.some(s=>s.stepKey===plan.sourceId)?canonicalNodeId(`process:${id??baseWorkflow!.id}:${reviewSlug(plan.sourceId)}`):plan.sourceId??undefined;onNavigate?.(plan.value!,id,focus);}
  }
  async function acceptDialogueOperation(extraTurns?:DialogueTurn[],saveAfter=false){
    const proposed=operationPreview;if(!proposed||!baseReview||!baseWorkflow||working)return false;
    try{
      const plan=validateDialoguePlan(proposed.plan,mergeGraph,baseWorkflow,baseReview);
      const sourceTurns=extraTurns??dialogueSession.turns,lastProposal=sourceTurns.findLastIndex(t=>t.state==='proposed');
      const turns=sourceTurns.map((t,i)=>i===lastProposal?{...t,state:'applied' as const}:t),session={turns,plan:null};
      const accepted={...ensureDraft(proposed.review??baseReview),workflow:proposed.workflow??baseWorkflow,review:{...(proposed.review??baseReview),dialogueHistory:turns},dialogueSession:session};
      if(plan.action==='save')return !!await save(accepted);
      if(plan.action==='refine'||plan.action==='insert'){
        if(!proposed.candidate)throw new Error('話を反映した案が見つかりません。もう一度、補足・訂正する内容を教えてください。');
        if(saveAfter){const result=await save({...proposed.candidate,review:{...proposed.candidate.review,dialogueHistory:turns},dialogueSession:session});if(result){setOperationPreview(null);setCorrectionText('');}return !!result;}
        onDraft(key,{...proposed.candidate,review:{...proposed.candidate.review,dialogueHistory:turns},dialogueSession:session,dialogueUndo:dialogueUndoSnapshot(proposed.beforeDraft,memo)});onTranscripts({...transcripts,[key]:proposed.candidate.sourceNotes});setUndoDialogue({draft:proposed.beforeDraft,memo});setOperationPreview(null);setCorrectionText('');setOrganizeNotice('話を反映した候補です。変更前後を確認してから保存できます。');return true;
      }
      if(plan.action==='merge_workflows'||plan.action==='merge_assets'||plan.action==='rename_asset'){
        setBusy(true);const historyDraft={...ensureDraft(baseReview),review:{...baseReview,dialogueHistory:turns},dialogueSession:session};
        const payload=plan.action==='merge_workflows'?await dialogueRequest('/api/workflow-merge',{projectId,mode:'apply',sourceId:plan.sourceId,targetId:plan.targetId,choices:proposed.choices,expectedUpdatedAt:proposed.expectedUpdatedAt,draft:historyDraft}):await dialogueRequest('/api/asset-mutation',{projectId,mode:'apply',sourceId:plan.sourceId,targetId:plan.action==='merge_assets'?plan.targetId:undefined,name:plan.action==='rename_asset'?plan.value:undefined,evidence:proposed.evidence,acceptTargetProfile:plan.value==='target',expectedUpdatedAt:proposed.expectedUpdatedAt,dialogue:{workflowId:baseWorkflow.id,turns}});
        receiveMerge(payload.project,plan.action==='merge_workflows'?plan.targetId!:baseWorkflow.id);setOperationPreview(null);setUndoDialogue(null);return true;
      }
      if(plan.action==='undo'){
        const undo=undoDialogue??draft?.dialogueUndo;
        if(undo&&saveAfter){const restored=undo.draft??{workflow:saved!,review:currentReview!,sourceNotes:savedTranscripts[key]??'',provider:'human-edit',baseline:currentReview,answers:{},answerHistory:saved?.reviewContext?.followUpAnswers??[]};const result=await save({...restored,sourceNotes:undo.memo,review:{...restored.review,dialogueHistory:turns},dialogueSession:session,dialogueUndo:undefined});if(result){setOperationPreview(null);setUndoDialogue(null);}return !!result;}
        if(undo){const restored=undo.draft??{workflow:saved!,review:currentReview!,sourceNotes:savedTranscripts[key]??'',provider:'human-edit',baseline:currentReview,answers:{},answerHistory:saved?.reviewContext?.followUpAnswers??[]};onDraft(key,{...restored,review:{...restored.review,dialogueHistory:turns},dialogueSession:session,dialogueUndo:undefined});onTranscripts({...transcripts,[key]:undo.memo});setUndoDialogue(null);}
        else{setBusy(true);const payload=await dialogueRequest(proposed.recordKind==='workflow'?'/api/workflow-merge':'/api/asset-mutation',{projectId,mode:'undo',recordId:proposed.recordId,expectedUpdatedAt:proposed.expectedUpdatedAt,dialogue:{workflowId:baseWorkflow.id,turns}});receiveMerge(payload.project,payload.restoredId??baseWorkflow.id);}
        setOperationPreview(null);return true;
      }
      if(plan.action==='show'||plan.action==='new_story'){
        onDraft(key,{...ensureDraft(baseReview),review:{...baseReview,dialogueHistory:turns},dialogueSession:session});setOperationPreview(null);
        navigateDialoguePlan(plan);
        return true;
      }
      if(saveAfter){const result=await save(accepted);if(result)setOperationPreview(null);return !!result;}
      onDraft(key,{...accepted,dialogueUndo:dialogueUndoSnapshot(proposed.beforeDraft,memo)});setUndoDialogue({draft:proposed.beforeDraft,memo});setOperationPreview(null);setOrganizeNotice('対話の案を候補へ反映しました。変更箇所を確認してから保存できます。');return true;
    }catch(error){setError(error instanceof Error?error.message:'操作を反映できませんでした。');return false;}
    finally{setBusy(false);}
  }
  useEffect(()=>{
    const plan=draft?.dialogueSession?.plan;
    if(!plan||plan.action==='ask'||operationPreview||working||!baseReview||!baseWorkflow)return;
    let cancelled=false;setOperation('dialogue');setBusy(true);
    const turns=draft!.dialogueSession!.turns;
    Promise.resolve().then(()=>prepareDialogueOperation(validateDialoguePlan(plan,mergeGraph,baseWorkflow,baseReview),draft?.dialogueSession?.evidence??operationWords(turns),draft??null,draft?.dialogueSession?.preview))
      .then(prepared=>{if(!cancelled){setOperationPreview(prepared);if(prepared.review){setStepKey(prepared.review.steps.find(s=>s.stepKey===plan.sourceId)?.stepKey??prepared.review.steps[0]?.stepKey??'');setStepPage(0);}if(prepared.candidate&&!draft?.dialogueSession?.preview)onDraft(key,{...draft!,dialogueSession:{...draft!.dialogueSession!,preview:prepared.candidate}});setOrganizeNotice('保存前の対話案を、最新の構造と照合して開きました。');}})
      .catch(error=>{if(!cancelled){const question=emptyDialoguePlan('操作案をもう一度確かめます。',error instanceof Error?error.message:'対象を確認してください。');const history=[...turns,dialogueTurn('assistant',question.question!,'question',question)];onDraft(key,{...draft!,review:{...baseReview,dialogueHistory:history},dialogueSession:{turns:history,plan:question}});}})
      .finally(()=>{if(!cancelled)setBusy(false);});
    return()=>{cancelled=true;};
  },[key,draft?.dialogueSession?.plan]);
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
                {review.documentEvidence?.length ? <DocumentSourceEvidence key={key} projectId={projectId} evidence={review.documentEvidence} sourceRefs={selected.sourceRefs} focusText={selected.evidence} stepName={selected.name} /> : null}
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
                  onEditConnections={()=>connectionEditorRef.current?.scrollIntoView({behavior:'smooth',block:'start'})}
                  onExclude={removeStep}
                  onConfirmIncomingData={(handoff, name, dataId) => update({
                    ...review,
                    incomingHandoffs: review.incomingHandoffs?.map(h => h === handoff ? {
                      ...h, dataBindings: confirmHandoffInformation(preview, h.sourceWorkflowId, h.sourceStepKey, h.data, h.dataBindings, name, dataId),
                    } : h),
                  })}
                  onConfirmOutgoingData={(handoff, name, dataId) => update({
                    ...review,
                    handoffs: review.handoffs?.map(h => h === handoff ? {
                      ...h, dataBindings: confirmHandoffInformation(preview, workflow!.id, h.fromStepKey, h.data, h.dataBindings, name, dataId),
                    } : h),
                  })}
                  onWorkflow={(id, stepKey) => {
                    const step = getWorkflowProcesses(preview, id).find(
                      (p) => p.canonicalKey.split(":").at(-1) === stepKey,
                    );
                    if (step) onFocusStep?.(id, step.id);
                    onSelect(inputKeyForWorkflow(drafts, id));
                  }}
                />}
                {!edit&&<div ref={connectionEditorRef}><FlowConnectionEditor key={`${key}:${selected.stepKey}`} review={review} selected={selected} disabled={busy||stale||!!correctionText.trim()||!!addition.trim()||pendingAnswers} onChange={update}/></div>}
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
                    <WorkBoundaryEditor value={edit.boundary} onChange={boundary => setEdit({ ...edit, boundary })} />
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
                  <fieldset>
                    <legend>つながる情報（分かる範囲で選ぶ）</legend>
                    {[...new Set(selected.data.filter(d => handoffDirection !== "outgoing"
                      ? ["read", "receive"].includes(d.operation) : ["send", "update", "create"].includes(d.operation)).map(d => d.name))]
                      .map(name => <label key={name}><input type="checkbox" checked={handoffData.includes(name)}
                        onChange={e => setHandoffData(e.target.checked ? [...handoffData, name] : handoffData.filter(item => item !== name))} />{name}</label>)}
                    <small>選ばない場合も、業務への接続と説明を残して、情報は未確認にできます。</small>
                  </fieldset>
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
                              data: selected.data.filter(d => ["read", "receive"].includes(d.operation) && handoffData.includes(d.name)).map(d => d.name),
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
                            data: selected.data.filter(d => ["send", "update", "create"].includes(d.operation) && handoffData.includes(d.name)).map(d => d.name),
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
  ].map(n=>n.id===key&&operationPreview?{...n,name:workflow?.name??n.name,questions:review?.questions.length??n.questions}:n)
    .filter(n => (memoFilter !== "drafts" || n.pending) && (memoFilter !== "questions" || n.questions > 0) && `${n.name} ${n.text}`.includes(noteQuery));
  const notePage = Math.max(0, Math.min(memoPage, Math.ceil(noteEntries.length / 6) - 1));
  return (
    <section
      className="input-workbench"
      aria-label="話を入力して構造を育てる"
      data-pane={mobilePane}
      data-operation-preview={!!operationPreview}
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
      {working && (
        <aside className="input-processing" role="status">
          <strong>
            {operation === "save"
              ? "道具・情報を既存の構造と照合して保存しています"
              : operation === "addition" ? "追加した話だけを読み取っています" : operation === 'dialogue' ? 'お願いの内容と、変更する対象を確かめています' : "話を読み取り、人・道具・情報の流れを整理しています"}
          </strong>
          <span aria-hidden="true"> · {waitingSeconds}秒</span>
          <p>メモと前の候補を保ったまま、結果を待っています。</p>
          {(operation === "organize"||operation==='dialogue') && <button className="button-secondary" onClick={() => {
            organizeRequest.current?.abort();organizeRequest.current=null;setBusy(false);
            setOrganizeNotice("整理をやめました。入力した話と、前の候補は残っています。");
          }}>この整理をやめる</button>}
          {waitingSeconds >= 20 && operation !== "save" && aiConfig?.configured && (
            <p>AIの応答を待っています。結果が届いたら、保存前に内容を確かめられます。</p>
          )}
        </aside>
      )}
      {organizeNotice && <p className="input-addition-notice" role="status">{organizeNotice}</p>}
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
      <div hidden={!documentInputOpen}><DocumentInput projectId={projectId} busy={busy} completed={new Set([...Object.keys(drafts), ...graph.workflows.map(w => w.id)])} savedIds={new Set([...graph.workflows.map(w=>w.id),...(graph.knowledge?.workflowMerges??[]).filter(r=>r.state==='merged'&&graph.workflows.some(w=>w.id===workflowMergeDestination(graph,r.sourceWorkflowId))).map(r=>r.sourceWorkflowId)])} activeDocumentId={review?.documentEvidence?.[0]?.documentId} onClose={() => setDocumentInputOpen(false)} onStart={startDocumentWork} onWithdraw={withdrawDocumentCandidates} onAIResponse={() => setAIResponse("success")} /></div>
      <div className="input-workbench-grid" hidden={documentInputOpen}>
        <section ref={notePaneRef} className="input-note-pane">
          <div className="input-note-heading">
            <h2>
              {documentEvidence?.length?"元資料と補足":inputMode==='dialogue'?"図を見ながら話す":"話とメモ"}
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
          <nav className="input-mode-switch" aria-label="話の入力方法"><button aria-pressed={inputMode==='dialogue'} onClick={()=>changeInputMode('dialogue')}>対話で整理</button><button aria-pressed={inputMode==='summary'} onClick={()=>changeInputMode('summary')}>まとめて書く</button></nav>
          <DialogueOperationPanel session={dialogueSession} details={operationPreview?.details} busy={working} onAccept={acceptDialogueOperation} onCancel={cancelDialogueOperation} onReply={requestDialogueOperation}/>
          {!documentEvidence?.length&&<button className="input-document-entry button-secondary" disabled={busy} onClick={() => { documentReturnKey.current=key;setDocumentInputOpen(true); }}>資料・画像から始める</button>}
          {!review && !documentEvidence?.length && <div hidden={inputMode!=='summary'}>{memoComposer}</div>}
          {!!documentEvidence?.length&&<DocumentOriginalPane projectId={projectId} evidence={documentEvidence} sourceRefs={selected?.sourceRefs} compact={inputMode==='dialogue'}/>}
          {(review||!documentEvidence?.length)&&<div hidden={inputMode!=='dialogue'}><InputDialogue key={key} source={operationPreview?.candidate?.sourceNotes??memo} onSource={text=>onTranscripts({...transcripts,[key]:text})}
            review={review} history={operationPreview?.candidate?.answerHistory??answerHistory} answers={draft?.answers??{}} busy={working} operationSession={draft?.dialogueSession??{turns:review?.dialogueHistory??[],plan:null}}
            blockedReason={operationPreview?'図に出ている操作案を、先に確認するか取り消してください。':stale?'本文の変更を先に流れへ反映してください。':edit?'編集中の手順を先に反映してください。':addition.trim()?'入力中の追記を先に図へ反映してください。':''}
            onStart={()=>organize()}
            onAnswerText={(question,text)=>onDraft(key,{...ensureDraft(review!),answers:{...(draft?.answers??{}),[question]:text}})}
            onAnswer={(question,text)=>organize(appendDialogueAnswer(answerHistory,question,text))}
            onDefer={question=>onDraft(key,{...ensureDraft(review!),answerHistory:appendDialogueAnswer(answerHistory,question,'まだ分からない','deferred')})}
            correctionText={correctionText} onCorrectionText={setCorrectionText} correctionScope={correctionScope} onCorrectionScope={setCorrectionScope}
            correctIndex={correctAnswerIndex} onCorrectIndex={setCorrectAnswerIndex}
            selectedName={selected&&inputStepName(selected)} onCorrection={correctFromDialogue}/></div>}
          {!review&&!!documentEvidence?.length&&<div className="input-document-organizing"><p>{busy?"原図を読み、手順と矢印を組み立てています。元資料を見ながら待てます。":"元資料は残っています。もう一度流れを作れます。"}</p>{!busy&&<button className="button-primary" onClick={()=>organize()}>この資料から流れを作る</button>}</div>}
          {review&&<section hidden={inputMode!=='summary'} className="input-correction" aria-label="流れを言葉で補足・訂正する">
            <h3>違うところ・足りないところを直す</h3>
            {correctAnswerIndex!==undefined&&<p>訂正する回答：{answerHistory[correctAnswerIndex]?.question}</p>}
            <label>直す範囲<select aria-label="言葉で直す範囲" disabled={correctAnswerIndex!==undefined} value={correctAnswerIndex!==undefined?'all':correctionScope} onChange={event=>setCorrectionScope(event.target.value)}><option value="all">この仕事の流れ全体</option>{selected&&<option value="step">選んだ手順：{inputStepName(selected)}</option>}</select></label>
            <textarea aria-label="流れへの補足・訂正" value={correctionText} disabled={busy} onChange={event=>setCorrectionText(event.target.value)} placeholder="例：成績書を受け取るのは品質担当ではなく、購買担当です。受取後に品質担当へ渡します。"/>
            <button className="button-primary" disabled={busy||stale||!!edit||!correctionText.trim()} onClick={()=>{
              void correctFromDialogue(correctionText.trim());
            }}>補足・訂正を流れに反映する</button>
            <p>原本と元の話は残ります。変更した箇所を確認してから保存できます。</p>
            {undoCorrection&&draft&&<button className="input-text-button" disabled={busy} onClick={()=>{onDraft(key,undoCorrection.draft);setUndoCorrection(null);setCorrectionText("");setOrganizeNotice("今回の補足・訂正を取り消し、直す前の候補に戻しました。");}}>今回の補足・訂正を取り消す</button>}
          </section>}
          {!!documentEvidence?.length&&<button className="input-text-button" disabled={busy} onClick={()=>{documentReturnKey.current=key;setDocumentInputOpen(true);}}>資料の別の仕事を見る</button>}
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
          {workflow && review && (
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
              <label className="kg-edit-field">工場・拠点<input aria-label="この業務の工場・拠点" disabled={busy} value={workflowMergeSite(workflow)} placeholder="分かっている場合だけ入力" onChange={event=>{
                const site=event.target.value;
                onDraft(key,{...ensureDraft(review!),workflow:{...workflow,landscape:{...(workflow.landscape??emptyLandscape()),site,evidence:`利用者が工場・拠点を訂正：${site||'未確認'}`},...(documentEvidence?.length?{scenarioLabel:site||undefined}:{})}});
              }}/></label>
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
        <section ref={structurePaneRef} className="input-structure-pane">
          <div className="input-structure-header">
            <div>
              <h2>
                {workflow?.name || "ここに、話の流れが見えます"}
              </h2>
              {workflow&&review&&<><button className="input-text-button" disabled={busy} onClick={()=>setRenameOpen(!renameOpen)}>名前を直す</button>{renameOpen&&<label className="kg-edit-field">仕事の名前<input aria-label="仕事の名前" value={workflow.name} onChange={event=>onDraft(key,{...ensureDraft(review!),workflow:{...workflow,name:event.target.value}})}/></label>}{workflow.scenarioLabel&&<span className="input-site-badge">{workflow.scenarioLabel}</span>}</>}
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
                  !!correctionText.trim() ||
                  pendingAnswers ||
                  !!edit ||
                  !draft.workflow.name.trim()
                }
                onClick={()=>void save()}
              >
                {operationPreview?'対話の案を確認してください':working
                  ? operation === "save" ? "道具・情報を照合して保存中…" : "話を整理中…"
                  : correctionText.trim() ? "補足・訂正を反映してから保存" : addition.trim() ? "追記を反映してから保存" : pendingAnswers ? "回答を反映してから保存" : edit
                    ? "訂正を反映してから保存"
                    : draft
                      ? review.steps.length ? "3 この流れを保存" : "3 話と確認事項を保存"
                      : "保存済み"}
              </button>
            )}
          </div>
          {draft&&!!baseReview?.dialogueHistory?.length&&<p className="input-dialogue-change">図へのお願いと返答も履歴に残しています。操作の言葉は、業務の事実として読み取りません。</p>}
          {draft&&!!newDialogue.length&&<p className="input-dialogue-change" role="status">保存前の対話：回答・補足 {newDialogue.filter(a=>a.kind!=='deferred'&&a.kind!=='correction').length}件 · 回答の訂正 {newDialogue.filter(a=>a.kind==='correction').length}件 · 未確認のまま残した内容 {newDialogue.filter(a=>a.kind==='deferred').length}件</p>}
          {workflow&&review&&graph.workflows.some(w=>w.id!==workflow.id)&&<button className="input-text-button" disabled={busy||stale||!!edit||!!addition.trim()||!!correctionText.trim()||pendingAnswers} onClick={()=>setMergeOpen(true)}>同じ業務とまとめる</button>}
          {mergeOpen&&workflow&&review&&<WorkflowMergePanel projectId={projectId} sourceId={workflow.id}
            graph={mergeGraph}
            transcripts={draft?{...savedTranscripts,[workflow.id]:draft.sourceNotes}:savedTranscripts}
            draft={draft} blockedIds={Object.values(drafts).filter(d=>d.workflow.id!==workflow.id).map(d=>d.workflow.id)}
            onSaved={receiveMerge} onClose={()=>setMergeOpen(false)}/>}
          {workflow&&<WorkflowMergeHistory projectId={projectId} graph={graph} workflowId={workflow.id} disabled={busy||!!draft||stale||!!edit||!!addition.trim()||!!correctionText.trim()} onSaved={receiveMerge}/>}
          {review?.extraction && (
            <p className="input-extraction-origin">
              この構造の整理：
              {!!review.extraction?.imagePages&&<span>元ページの画像{review.extraction.imagePages}枚を直接参照 · </span>}
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
              <ReviewUnderstandingHistory review={review}/>
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
                {review.summaryBasis==='structure'&&!!review.warnings.length&&<p className="input-growing-hint">以下は読み取り時の注意です。図を更新する前の内容も含みます。現在の図と、人が確認・訂正した履歴を合わせて確かめてください。</p>}
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
                        <p>{dialogueAnswerStatus(a,answerHistory)}：{a.question}</p>
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
