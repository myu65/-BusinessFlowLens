"use client";
import React, { useEffect, useRef, useState } from "react";
import {
  getProcessExecutionMode,
  getWorkflowProcesses,
  type LensGraph,
  type LensNode,
} from "@/lib/graph";
import { termExplanation, termExplanations, workflowChapters } from "@/lib/knowledge-guide";
import {
  handoffJourney,
  journeyEntryExplanation,
  type WorkflowHandoff,
  stepContext,
  traceData,
  type FlowJourney,
  type FlowReadingPosition,
} from "@/lib/flow-context";
import { FlowNoteInput } from "./FlowNoteInput";
import { describeHumanEdit } from "@/lib/review-workbench";

type Depth = "summary" | "step" | "detail";
const mode = (value: string) =>
  ({
    automatic: "システムが自動で行う",
    manual: "人が行う",
    mixed: "人とシステムが行う",
    unknown: "実行方法未確認",
  })[value] ?? "未確認";
const operation = (value: string) =>
  ({ reads: "参照・受取", writes: "作成・更新", sends: "送信・受渡し" })[
    value
  ] ?? value;

export function WorkflowReading({
  graph,
  workflowId: parentWorkflowId,
  onDetail,
  onAsset,
  initialStepId,
  initialDataId,
  initialDepth = "step",
  initialLens = "work",
  onGraphApply,
  onStepChange,
  onReadingChange,
  onNavigateWorkflow,
  journey: initialJourney,
}: {
  graph: LensGraph;
  workflowId: string;
  onDetail: (id: string) => void;
  onAsset?: (node: LensNode, stepId: string) => void;
  initialStepId?: string;
  initialDataId?: string;
  initialDepth?: Depth;
  initialLens?: "work" | "data";
  onGraphApply?: (graph: LensGraph) => void;
  onStepChange?: (id: string) => void;
  onReadingChange?: (position: FlowReadingPosition) => void;
  onNavigateWorkflow?: (id: string, journey: FlowJourney) => void;
  journey?: FlowJourney;
}) {
  const [journey, setJourney] = useState(initialJourney);
  const readerRef = useRef<HTMLElement>(null);
  const workflowId = journey?.workflowId ?? parentWorkflowId;
  useEffect(() => {
    if (journey) readerRef.current?.scrollIntoView({ block: "start" });
  }, [journey?.workflowId]);
  useEffect(() => {
    if (journey && parentWorkflowId !== journey.workflowId)
      setJourney(initialJourney);
  }, [parentWorkflowId]);
  useEffect(() => {
    if (initialStepId) setStepId(initialStepId);
  }, [initialStepId]);
  const [stepId, setStepId] = useState(() => {
    const related = initialDataId
      ? traceData(graph, workflowId, initialDataId)
      : [];
    const requested = initialJourney?.stepId ?? initialStepId;
    return graph.nodes.some(n => n.id === requested && n.kind === "process" && n.workflowId === workflowId)
      ? requested! : related[0]?.step.id ?? "";
  });
  const [depth, setDepth] = useState<Depth>(initialJourney?.depth ?? initialDepth);
  const [lens, setLens] = useState<"work" | "data">(initialLens);
  const [dataId, setData] = useState(
    initialJourney?.dataId ?? initialDataId ?? "",
  );
  const [systemId, setSystem] = useState("");
  const [tracePage, setTracePage] = useState(
    initialDataId
      ? Math.floor(
          Math.max(
            0,
            traceData(graph, workflowId, initialDataId).findIndex(
              (t) => t.step.id === initialStepId,
            ),
          ) / 5,
        )
      : 0,
  );
  const steps = getWorkflowProcesses(graph, workflowId);
  const selected = steps.find((s) => s.id === stepId) ?? steps[0];
  const chapters = workflowChapters(graph, workflowId);
  useEffect(() => {
    const currentStep = selected?.id ?? "";
    onReadingChange?.({ stepId: currentStep, dataId, depth, lens,
      journey: journey ? { ...journey, stepId: currentStep, dataId, depth } : undefined });
  }, [selected?.id, dataId, depth, lens, journey, onReadingChange]);
  if (!selected) return <p>この業務の手順はまだ登録されていません。</p>;
  const context = stepContext(graph, workflowId, selected.id);
  const terms = termExplanations(selected.label);
  const workflow = graph.workflows.find((w) => w.id === workflowId);
  const chapterIndex = chapters.findIndex((c) =>
    c.steps.some((s) => s.id === selected.id),
  );
  const select = (id: string, nextDepth?: Depth) => {
    setStepId(id);
    setSystem("");
    onStepChange?.(id);
    if (nextDepth) setDepth(nextDepth);
    if (lens === "data" && dataId) {
      const i = traceData(graph, workflowId, dataId).findIndex(
        (t) => t.step.id === id,
      );
      if (i >= 0) setTracePage(Math.floor(i / 5));
    }
  };
  const label = (id: string) =>
    graph.nodes.find((n) => n.id === id)?.label ?? "未登録";
  const allData = [
    ...new Map(
      steps
        .flatMap((s) => {
          const c = stepContext(graph, workflowId, s.id);
          return [
            ...c.inputs,
            ...c.outputs,
            ...c.transfers
              .flatMap((f) =>
                f.dataIds.map((id) => graph.nodes.find((n) => n.id === id)!),
              )
              .filter(Boolean),
          ];
        })
        .map((n) => [n.id, n]),
    ).values(),
  ];
  const carriedData = journey?.dataId
    ? graph.nodes.find((n) => n.id === journey.dataId && n.kind === "data")
    : undefined;
  if (carriedData && !allData.some((n) => n.id === carriedData.id))
    allData.push(carriedData);
  const focusData =
    allData.find((n) => n.id === dataId) ??
    context.inputs[0] ??
    context.outputs[0] ??
    allData[0];
  const trace = focusData ? traceData(graph, workflowId, focusData.id) : [];
  const focusSystem = graph.nodes.find(
    (n) => n.id === systemId && n.kind === "system",
  );
  const followHandoff = (h: WorkflowHandoff) => {
    const next = handoffJourney(
      graph,
      h,
      workflowId,
      (h.sourceWorkflowId === workflowId
        ? h.sourceProcessId
        : h.targetProcessId) ?? selected.id,
      journey,
      focusData?.id,
    );
    next.depth = depth;
    setJourney(next);
    setStepId(next.stepId ?? "");
    setData(next.dataId ?? "");
    setTracePage(0);
    setSystem("");
    if (next.dataId) setLens("data");
    onNavigateWorkflow?.(next.workflowId, next);
  };
  const connection = (h: WorkflowHandoff, incoming = false) => {
    const otherId = incoming ? h.sourceWorkflowId : h.targetWorkflowId;
    return (
      <article key={h.id}>
        <p>{h.description}</p>
        <p>
          {h.dataIds.map(label).join(" / ") || "情報は未確認"} ·{" "}
          {h.status === "confirmed" ? "原文に明示" : "接続は要確認"}
        </p>
        <button onClick={() => followHandoff(h)}>
          {incoming
            ? h.via === "reference"
              ? "情報の作成元："
              : "受取元："
            : h.via === "reference"
              ? "情報を使う業務："
              : "次の業務："}
          {graph.workflows.find((w) => w.id === otherId)?.name}{" "}
          {incoming ? "←" : "→"}
        </button>
        <details>
          <summary>接続の根拠を見る</summary>
          <blockquote>{h.evidence}</blockquote>
        </details>
      </article>
    );
  };
  const connections = (items: WorkflowHandoff[], incoming = false) => (
    <>
      {items.slice(0, 3).map((h) => connection(h, incoming))}
      {items.length > 3 && (
        <details>
          <summary>ほか{items.length - 3}件の業務との接続</summary>
          {items.slice(3, 20).map((h) => connection(h, incoming))}
          {items.length > 20 && (
            <p>
              ここでは20件まで表示しています。業務全体の受渡しから続きを確認できます。
            </p>
          )}
        </details>
      )}
    </>
  );
  const systemProfile = graph.knowledge?.systems.find(
    (s) => s.systemId === systemId,
  );
  const showAsset = (n: LensNode, contextStepId?: string) => (
    <button
      key={n.id}
      className={`kg-chip kg-chip--${n.kind}`}
      title={
        n.kind === "data" ? "この情報の流れを辿る" : "この道具の役割を見る"
      }
      onClick={() => {
        if (contextStepId && contextStepId !== selected.id)
          select(contextStepId);
        if (n.kind === "data") {
          setData(n.id);
          setLens("data");
          setTracePage(
            Math.floor(
              Math.max(
                0,
                traceData(graph, workflowId, n.id).findIndex(
                  (t) => t.step.id === (contextStepId ?? selected.id),
                ),
              ) / 5,
            ),
          );
        } else {
          setSystem(n.id);
        }
      }}
    >
      {n.label}
    </button>
  );
  const assetList = (nodes: LensNode[], contextStepId?: string) => (
    <>
      {nodes.slice(0, 3).map((n) => showAsset(n, contextStepId))}
      {nodes.length > 3 && (
        <details>
          <summary>ほか{nodes.length - 3}件を見る</summary>
          {nodes.slice(3).map((n) => showAsset(n, contextStepId))}
        </details>
      )}
    </>
  );
  const showTransfers = (
    transfers: typeof context.transfers,
    compact = false,
    contextStepId?: string,
  ) => (
    <>
      {transfers.slice(0, 3).map((f) => (
        <article className="flow-transfer" key={f.id}>
          <div>
            {[f.sourceSystemId, f.targetSystemId].map((id, i) => {
              const node = graph.nodes.find((n) => n.id === id);
              return (
                <span key={`${id}:${i}`}>
                  {i > 0 && " → "}
                  {node ? showAsset(node, contextStepId) : "未登録"}
                </span>
              );
            })}
          </div>
          {!compact && (
            <p>
              {mode(f.automation)} · {f.frequency ?? "頻度未確認"}
            </p>
          )}
          {!compact &&
            f.dataIds
              .map((id) => graph.nodes.find((n) => n.id === id)!)
              .filter(Boolean)
              .map((n) => showAsset(n, contextStepId))}
          <details>
            <summary>方式・根拠を見る</summary>
            <p>
              方式：
              {
                {
                  api: "システム間連携",
                  manual: "人が転記・受渡し",
                  email: "メール",
                  file: "ファイル",
                  database: "データベース",
                  message: "メッセージ",
                  unknown: "未確認",
                }[f.transferType]
              }{" "}
              /{" "}
              {f.direction === "pull"
                ? "受け取り側から取得"
                : f.direction === "bidirectional"
                  ? "双方向"
                  : f.direction === "push"
                    ? "送り側から受渡し"
                    : "取得・送信を始める側は未確認"}
            </p>
            <p>
              {f.evidence ?? "根拠未登録"} ·{" "}
              {f.status === "confirmed" ? "確認済み" : "要確認"}
            </p>
          </details>
        </article>
      ))}
      {transfers.length > 3 && (
        <details>
          <summary>ほか{transfers.length - 3}件の受渡し</summary>
          {transfers.slice(3).map((f) => (
            <p key={f.id}>
              {label(f.sourceSystemId)} → {label(f.targetSystemId)}：
              {f.dataIds.map(label).join(" / ")}
            </p>
          ))}
        </details>
      )}
    </>
  );
  return (
    <section
      ref={readerRef}
      className="kg-reader continuous-reader"
      aria-label="業務と情報を一緒に読む"
    >
      <p className="flow-anchor">
        {workflow?.name} → 手順{selected.stepOrder}
      </p>
      {journey && (
        <aside
          className="flow-journey"
          aria-label="業務をまたいで辿っている文脈"
        >
          <strong>同じ仕事の続き</strong>
          {journey.trail.slice(-4).map((j, i) => (
            <p key={i}>
              <button
                onClick={() => {
                  const back: FlowJourney = {
                    workflowId: j.workflowId,
                    stepId: j.stepId,
                    dataId: j.dataId,
                    depth,
                    trail: journey.trail.slice(
                      0,
                      Math.max(0, journey.trail.length - 4) + i,
                    ),
                    entryKnown: true,
                  };
                  setJourney(back);
                  setStepId(j.stepId);
                  setData(j.dataId ?? "");
                  onNavigateWorkflow?.(j.workflowId, back);
                }}
              >
                ← {graph.workflows.find((w) => w.id === j.workflowId)?.name} ·{" "}
                {label(j.stepId)}
              </button>
              <span>
                {j.description} · 根拠：{j.evidence}
              </span>
            </p>
          ))}
          <p>
            辿る情報：
            {journey.dataId
              ? label(journey.dataId)
              : "受渡す情報は未確認"} → {workflow?.name}
          </p>
          {!journey.entryKnown && (
            <p>
              {journeyEntryExplanation(journey, selected, context.index)}
            </p>
          )}
        </aside>
      )}
      <div className="flow-depth" role="group" aria-label="流れを見る粒度">
        {(
          [
            ["summary", "業務のまとまり"],
            ["step", "手順と受渡し"],
            ["detail", "判断・個別作業"],
          ] as const
        ).map(([value, name]) => (
          <button
            key={value}
            aria-pressed={depth === value}
            onClick={() => setDepth(value)}
          >
            {name}
          </button>
        ))}
      </div>
      <p className="flow-explanation">
        同じ業務・手順を保ったまま、全体から作業まで拡大できます。人・道具・情報は同じ流れの中に表示します。
      </p>
      {depth === "summary" ? (
        <>
          <h3>仕事と情報の大きな流れ</h3>
          <div className="kg-chapters">
            {chapters.slice(0, 5).map((c, i) => (
              <button
                key={c.steps[0].id}
                aria-pressed={chapterIndex === i}
                onClick={() => select(c.steps[0].id, "step")}
              >
                <small>
                  手順{c.steps[0].stepOrder}–{c.steps.at(-1)!.stepOrder}
                </small>
                <strong>{c.steps[0].label}</strong>
                <span>
                  {mode(c.mode)} · {c.department}
                </span>
                <span>
                  {[
                    ...new Set(
                      c.steps.flatMap((s) =>
                        stepContext(graph, workflowId, s.id).systems.map(
                          (n) => n.label,
                        ),
                      ),
                    ),
                  ]
                    .slice(0, 2)
                    .join(" / ")}
                </span>
                <span>{c.steps.length}手順を読む →</span>
                <span>
                  受取：
                  {stepContext(graph, workflowId, c.steps[0].id).inputs[0]
                    ?.label ?? "未登録"}
                </span>
                <span>
                  渡す：
                  {stepContext(graph, workflowId, c.steps.at(-1)!.id).outputs[0]
                    ?.label ?? "未登録"}
                </span>
              </button>
            ))}
          </div>
          {chapters.length > 5 && (
            <details>
              <summary>続きのまとまり（{chapters.length - 5}件）</summary>
              {chapters.slice(5).map((c) => (
                <button
                  key={c.steps[0].id}
                  onClick={() => select(c.steps[0].id, "step")}
                >
                  {c.steps[0].label} →
                </button>
              ))}
            </details>
          )}
        </>
      ) : (
        <>
          <div className="kg-step-navigation">
            <button
              disabled={!context.previous}
              onClick={() => context.previous && select(context.previous.id)}
            >
              ← 前の手順
            </button>
            <span>
              業務全体の {context.index + 1} / {steps.length}
            </span>
            <button
              disabled={!context.next}
              onClick={() => context.next && select(context.next.id)}
            >
              {context.outgoing.length > 1 ? "分岐先を選ぶ ↓" : "次の手順 →"}
            </button>
          </div>
          <label className="kg-edit-field">
            手順を選んで読む
            <select
              value={selected.id}
              onChange={(e) => select(e.target.value)}
            >
              {steps.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.stepOrder}. {s.label}
                </option>
              ))}
            </select>
          </label>
          <aside className="flow-connections" aria-label="条件と次の仕事">
            <strong>
              {selected.meaning?.halt
                ? "停止・保留 / 再開条件を確認"
                : "この結果から進む仕事"}
            </strong>
            {context.outgoing.map(({ edge, step }) => (
              <button key={edge.id} onClick={() => select(step.id)}>
                {edge.label ? `条件：${edge.label}` : "順に進む"} → {step.label}{" "}
                ·{" "}
                {edge.status === "confirmed"
                  ? "確認済み"
                  : edge.status === "inferred"
                    ? "接続は推定"
                    : "根拠を確認"}
              </button>
            ))}
            {connections(context.outgoingHandoffs)}
            {!context.outgoing.length && !context.outgoingHandoffs.length && (
              <p>
                {selected.meaning?.halt
                  ? "解除後の再開先は未確認です。"
                  : "次の接続は未登録です。完了または受渡し先を確認してください。"}
              </p>
            )}
            {context.incomingHandoffs.length > 0 && (
              <section aria-label="前の業務からつながる情報">
                <strong>この手順で受け取る・参照する情報の作成元</strong>
                {connections(context.incomingHandoffs, true)}
              </section>
            )}
          </aside>
          <div className="flow-neighbors" aria-label="前後の仕事">
            {[
              ...new Map(
                [
                  ...context.incoming.map((i) => i.step),
                  selected,
                  ...context.outgoing.map((o) => o.step),
                ].map((s) => [s.id, s]),
              ).values(),
            ]
              .slice(0, 4)
              .map((s) => (
                <button
                  key={s.id}
                  aria-pressed={s.id === selected.id}
                  onClick={() => select(s.id)}
                >
                  <small>
                    手順{s.stepOrder} ·{" "}
                    {mode(getProcessExecutionMode(graph, s))}
                  </small>
                  <strong>{s.label}</strong>
                  <span>{s.department ?? "部署未確認"}</span>
                </button>
              ))}
          </div>
          <div className="flow-depth" role="group" aria-label="注目する流れ">
            <button
              aria-pressed={lens === "work"}
              onClick={() => setLens("work")}
            >
              業務と人の動きを見る
            </button>
            <button
              aria-pressed={lens === "data"}
              onClick={() => {
                setLens("data");
                if (focusData) {
                  setData(focusData.id);
                  setTracePage(
                    Math.floor(
                      Math.max(
                        0,
                        trace.findIndex((t) => t.step.id === selected.id),
                      ) / 5,
                    ),
                  );
                }
              }}
            >
              同じ情報の流れを辿る
            </button>
          </div>
          <article className="kg-step-focus">
            <h3>
              {selected.stepOrder}. {selected.label}
            </h3>
            {!!terms.length && <details className="kg-term">
              <summary>用語の補足</summary>
              <p>用語の一般的な説明です。この手順で行うことは、下の結果と原文で確認できます。</p>
              {terms.map(({ term, explanation }) => <p key={term}><strong>{term}</strong>：{explanation}</p>)}
            </details>}
            <p>
              {selected.department ?? "部署未確認"} ·{" "}
              {getProcessExecutionMode(graph, selected) === "automatic"
                ? `実行：${context.executingSystems.map((n) => n.label).join(" / ") || "未確認"}`
                : `担当：${selected.actor ?? "未確認"}`}{" "}
              · {mode(getProcessExecutionMode(graph, selected))} ·{" "}
              {selected.status === "confirmed" ? "確認済み" : "要確認"}
            </p>
            <section className="flow-decision" aria-label="判断と情報の変化">
              <h4>この処理で、何が決まるか</h4>
              <div className="flow-meaning-grid">
                <div>
                  <h4>根拠にするもの</h4>
                  <p>{selected.meaning?.basis || "判断の根拠は未確認"}</p>
                </div>
                <div>
                  <h4>決まる・変わること</h4>
                  <p>{selected.meaning?.result || "処理結果は未確認"}</p>
                </div>
                <div>
                  <h4>次に動く仕事</h4>
                  <p>
                    {selected.meaning?.next || "結果によって動く仕事は未確認"}
                  </p>
                </div>
              </div>
              {selected.meaning?.purpose && (
                <p>この作業が必要な理由：{selected.meaning.purpose}</p>
              )}
              {selected.meaning?.condition && (
                <p>実行する条件：{selected.meaning.condition}</p>
              )}
              <details>
                <summary>原文・推定・人の訂正を確認する</summary>
                <p>
                  {selected.status === "confirmed"
                    ? "原文に明示 / 確認済み"
                    : "推定・要確認"}
                  ：{selected.evidence || "原文の根拠は未登録"}
                </p>
                {selected.meaning && (
                  <p>
                    結果の根拠（
                    {selected.meaning.certainty === "confirmed"
                      ? "明示・確認済み"
                      : selected.meaning.certainty === "inferred"
                        ? "推定"
                        : "未確認"}
                    ）：{selected.meaning.evidence || "未登録"}
                  </p>
                )}
                {selected.humanEdits?.map((e, i) => (
                  <div key={i}>
                    {describeHumanEdit(e).map((text, j) => (
                      <p key={j}>
                        人の訂正：{text} · {e.evidence}
                      </p>
                    ))}
                  </div>
                ))}
              </details>
            </section>
            {lens === "work" ? (
              <>
                <div className="kg-information-path">
                  <section>
                    <h4>① 受け取る・参照する情報</h4>
                    {context.inputs.length ? (
                      assetList(context.inputs)
                    ) : (
                      <p>入力情報は未登録</p>
                    )}
                  </section>
                  <section>
                    <h4>② 行うこと・使う道具</h4>
                    <p>{selected.action ?? selected.description}</p>
                    {context.systems.length ? (
                      assetList(context.systems)
                    ) : (
                      <p>使用する道具は未登録</p>
                    )}
                  </section>
                  <section>
                    <h4>③ 作る・更新する情報</h4>
                    {context.outputs.length ? (
                      assetList(context.outputs)
                    ) : (
                      <p>出力情報は未登録</p>
                    )}
                  </section>
                </div>
                {context.transfers.length > 0 && (
                  <>
                    <h4>この作業に接続する情報の受渡し</h4>
                    {showTransfers(context.transfers)}
                  </>
                )}
              </>
            ) : (
              <>
                <label className="kg-edit-field">
                  辿る情報
                  <select
                    value={focusData?.id ?? ""}
                    onChange={(e) => {
                      const id = e.target.value;
                      const related = traceData(graph, workflowId, id);
                      const index = related.findIndex(
                        (t) => t.step.id === selected.id,
                      );
                      if (index < 0 && related[0]) select(related[0].step.id);
                      setData(id);
                      setTracePage(index < 0 ? 0 : Math.floor(index / 5));
                    }}
                  >
                    {allData.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p>
                  「{focusData?.label ?? "情報未登録"}
                  」を、どの作業で受け取り・更新・受渡しするか。作業を選ぶと、担当と道具も一緒に移動します。
                </p>
                <p>条件で分かれる作業も含みます。条件と停止・保留を、それぞれの作業で確認できます。</p>
                <ol className="flow-data-trace">
                  {trace
                    .slice(tracePage * 5, (tracePage + 1) * 5)
                    .map((item) => (
                      <li key={item.step.id}>
                        <button
                          aria-pressed={item.step.id === selected.id}
                          onClick={() => select(item.step.id)}
                        >
                          {item.step.stepOrder}. {item.step.label}
                        </button>
                        <p>
                          {item.step.department ?? "部署未確認"} ·{" "}
                          {getProcessExecutionMode(graph, item.step) ===
                          "automatic"
                            ? `実行：${item.executingSystems.map((n) => n.label).join(" / ") || "未確認"}`
                            : `担当：${item.step.actor ?? "未確認"}`}{" "}
                          · {mode(getProcessExecutionMode(graph, item.step))} ·{" "}
                          {item.operations.map(operation).join(" / ") ||
                            "受渡しに関連"}
                        </p>
                        {(item.step.meaning?.condition || item.step.meaning?.halt) && <p>
                          {item.step.meaning?.condition && <>条件：{item.step.meaning.condition}</>}
                          {item.step.meaning?.halt && <> · 停止・保留</>}
                        </p>}
                        {!item.transfers.length && (
                          <div>
                            使う道具：
                            {item.systems.length
                              ? assetList(item.systems, item.step.id)
                              : "未登録"}
                          </div>
                        )}
                        {showTransfers(item.transfers, true, item.step.id)}
                        <p>
                          この作業で変わること：
                          {item.step.meaning?.result || "処理結果は未確認"}
                        </p>
                        {stepContext(
                          graph,
                          workflowId,
                          item.step.id,
                        ).outputs.some((n) => n.id !== focusData?.id) && (
                          <div>
                            次に使われる情報：
                            {assetList(
                              stepContext(
                                graph,
                                workflowId,
                                item.step.id,
                              ).outputs.filter((n) => n.id !== focusData?.id),
                              item.step.id,
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                </ol>
                {!trace.length && <p>この情報を使う手順は未登録です。</p>}
                <div className="kg-toolbar">
                  <button
                    disabled={!tracePage}
                    onClick={() => setTracePage((p) => p - 1)}
                  >
                    前の5作業
                  </button>
                  <span>
                    {trace.length}作業のうち
                    {trace.length ? tracePage * 5 + 1 : 0}–
                    {Math.min(trace.length, (tracePage + 1) * 5)}を表示
                  </span>
                  <button
                    disabled={(tracePage + 1) * 5 >= trace.length}
                    onClick={() => setTracePage((p) => p + 1)}
                  >
                    次の5作業
                  </button>
                </div>
                {focusData && onAsset && (
                  <button onClick={() => onAsset(focusData, selected.id)}>
                    この情報を使う他の業務も見る →
                  </button>
                )}
              </>
            )}
            {focusSystem && (
              <aside className="flow-system-context">
                <h4>{focusSystem.label}は何をするか</h4>
                <p>{systemProfile?.purpose ?? focusSystem.description}</p>
                {termExplanation(focusSystem.label) && (
                  <p>{termExplanation(focusSystem.label)}</p>
                )}
                <p>
                  この作業の担当：{selected.department ?? "未登録"} /
                  道具の管理：{systemProfile?.owner ?? "未登録"}
                </p>
                {onAsset && (
                  <button onClick={() => onAsset(focusSystem, selected.id)}>
                    会社全体でこの道具が支える仕事を見る →
                  </button>
                )}
                <button onClick={() => setSystem("")}>
                  道具の説明を閉じる
                </button>
              </aside>
            )}
            {depth === "detail" && (
              <section aria-label="同じ手順の判断と個別作業">
                <h4>何をきっかけに、何を判断するか</h4>
                <dl className="flow-rules">
                  <dt>始まるきっかけ</dt>
                  <dd>{selected.executionContext?.trigger ?? "未登録"}</dd>
                  <dt>判断・ルール</dt>
                  <dd>{selected.executionContext?.rule ?? "未登録"}</dd>
                  <dt>失敗・例外への対応</dt>
                  <dd>{selected.executionContext?.exception ?? "未登録"}</dd>
                  <dt>自動処理の実行先</dt>
                  <dd>
                    {context.executingSystems.map((n) => n.label).join(" / ") ||
                      "人による実行・未確認"}
                  </dd>
                </dl>
                <h4>個別作業</h4>
                <ol>
                  {(selected.detailSteps ?? []).map((t) => (
                    <li key={t.id}>
                      {t.action}
                      {t.condition && <p>条件：{t.condition}</p>}
                    </li>
                  ))}
                </ol>
                {!selected.detailSteps?.length && (
                  <p>個別作業は未登録です。下のメモから流れを補足できます。</p>
                )}
                <details>
                  <summary>技術情報と原文の根拠</summary>
                  {(selected.technicalDetails ?? []).map((t, i) => (
                    <dl className="flow-rules" key={i}>
                      <dt>システム</dt>
                      <dd>{t.system}</dd>
                      <dt>操作・テーブル等</dt>
                      <dd>
                        {[t.module, t.transaction, t.hanaArea, t.objects]
                          .filter(Boolean)
                          .join(" / ") || "未登録"}
                      </dd>
                      <dt>根拠</dt>
                      <dd>{t.evidence}</dd>
                    </dl>
                  ))}
                  <p>{selected.evidence ?? "根拠未登録"}</p>
                </details>
                <button onClick={() => onDetail(selected.id)}>
                  この手順を編集する →
                </button>
              </section>
            )}
          </article>
          {depth !== "detail" && (
            <button onClick={() => setDepth("detail")}>
              同じ手順を拡大：判断・例外・個別作業を見る →
            </button>
          )}
          {onGraphApply && (
            <FlowNoteInput
              graph={graph}
              workflowId={workflowId}
              afterStepId={selected.id}
              onApply={onGraphApply}
              onAdded={(id) => {
                setLens("work");
                setData("");
                select(id, "step");
              }}
            />
          )}
        </>
      )}
      {(graph.knowledge?.handoffs ?? []).some(
        (h) => h.sourceWorkflowId === workflowId,
      ) && (
        <details>
          <summary>この業務から次の業務へつながる情報・物</summary>
          {(graph.knowledge?.handoffs ?? [])
            .filter(
              (h) =>
                h.sourceWorkflowId === workflowId &&
                (graph.workflows.find((w) => w.id === h.targetWorkflowId)
                  ?.scenario ?? "current") ===
                  (workflow?.scenario ?? "current"),
            )
            .map((h) => (
              <article key={h.id}>
                <p>{h.description}</p>
                <p>
                  受渡す情報：{h.dataIds.map(label).join("、") || "未確認"} ·{" "}
                  {h.status === "confirmed"
                    ? "確認済み"
                    : h.status === "inferred"
                      ? "接続は推定"
                      : "接続の根拠を確認"}
                </p>
                <button onClick={() => followHandoff(h)}>
                  {
                    graph.workflows.find((w) => w.id === h.targetWorkflowId)
                      ?.name
                  }{" "}
                  →
                </button>
              </article>
            ))}
        </details>
      )}
    </section>
  );
}
