"use client";
import { useState } from "react";
import {
  getProcessAssetLinks,
  type LensGraph,
  type LensNode,
} from "@/lib/graph";
import { termExplanation, workflowChapters } from "@/lib/knowledge-guide";

export function WorkflowReading({
  graph,
  workflowId,
  onDetail,
  onAsset,
  initialStepId,
}: {
  graph: LensGraph;
  workflowId: string;
  onDetail: (id: string) => void;
  onAsset?: (node: LensNode, stepId: string) => void;
  initialStepId?: string;
}) {
  const chapters = workflowChapters(graph, workflowId);
  const initialChapter = Math.max(
    0,
    chapters.findIndex((c) => c.steps.some((s) => s.id === initialStepId)),
  );
  const [chapterIndex, setChapter] = useState(initialChapter);
  const [stepIndex, setStep] = useState(
    Math.max(
      0,
      chapters[initialChapter]?.steps.findIndex(
        (s) => s.id === initialStepId,
      ) ?? 0,
    ),
  );
  const chapter = chapters[Math.min(chapterIndex, chapters.length - 1)];
  const step = chapter?.steps[Math.min(stepIndex, chapter.steps.length - 1)];
  if (!step) return <p>この業務の手順はまだ登録されていません。</p>;
  const links = getProcessAssetLinks(graph, step.id);
  const systems = links.filter((l) => l.asset.kind === "system");
  const inputs = links.filter(
    (l) => l.asset.kind === "data" && l.relation === "reads",
  );
  const outputs = links.filter(
    (l) => l.asset.kind === "data" && ["writes", "sends"].includes(l.relation),
  );
  const transfers = graph.dataFlows.filter(
    (f) => f.workflowIds.includes(workflowId) && f.processIds.includes(step.id),
  );
  const showAsset = (n: LensNode) =>
    onAsset ? (
      <button
        key={n.id}
        className={`kg-chip kg-chip--${n.kind}`}
        onClick={() => onAsset(n, step.id)}
      >
        {n.label}
      </button>
    ) : (
      <span key={n.id}>{n.label}</span>
    );
  const assetList = (items: LensNode[]) => (
    <>
      {items.slice(0, 3).map(showAsset)}
      {items.length > 3 && (
        <details>
          <summary>ほか{items.length - 3}件の情報</summary>
          {items.slice(3).map(showAsset)}
        </details>
      )}
    </>
  );
  const mode = (value: string) =>
    ({
      automatic: "システムが自動で行う",
      manual: "人が行う",
      mixed: "人とシステムが行う",
      unknown: "実行方法未確認",
    })[value];
  return (
    <section className="kg-reader" aria-label="業務と情報を一緒に読む">
      <h3>仕事の流れを、まとまりごとに読む</h3>
      <p>
        まずまとまりを選び、その中の手順を一つずつ確認します。実行方法や担当部署が切り替わるところで区切っています。
      </p>
      <div className="kg-chapters">
        {chapters.slice(0, 5).map((c, i) => (
          <button
            key={c.steps[0].id}
            aria-pressed={chapterIndex === i}
            onClick={() => {
              setChapter(i);
              setStep(0);
            }}
          >
            <small>
              {i + 1} → 手順{c.steps[0].stepOrder}–{c.steps.at(-1)!.stepOrder}
            </small>
            <strong>{mode(c.mode)}</strong>
            <span>
              {c.department} · {c.steps.length}手順
            </span>
          </button>
        ))}
      </div>
      {chapters.length > 5 && (
        <details>
          <summary>続きのまとまりを見る（{chapters.length - 5}件）</summary>
          <div className="kg-chapters">
            {chapters.slice(5).map((c, i) => (
              <button
                key={c.steps[0].id}
                aria-pressed={chapterIndex === i + 5}
                onClick={() => {
                  setChapter(i + 5);
                  setStep(0);
                }}
              >
                {i + 6}. {mode(c.mode)} / {c.department}
              </button>
            ))}
          </div>
        </details>
      )}
      <div className="kg-step-navigation">
        <button
          disabled={stepIndex === 0}
          onClick={() => setStep((i) => i - 1)}
        >
          ← 前の手順
        </button>
        <span>
          このまとまりの {Math.min(stepIndex + 1, chapter.steps.length)} /{" "}
          {chapter.steps.length}
        </span>
        <button
          disabled={stepIndex >= chapter.steps.length - 1}
          onClick={() => setStep((i) => i + 1)}
        >
          次の手順 →
        </button>
      </div>
      <article className="kg-step-focus">
        <h3>
          {step.stepOrder}. {step.label}
        </h3>
        {termExplanation(step.label) && (
          <p className="kg-term">{termExplanation(step.label)}</p>
        )}
        <p>
          {step.department ?? "担当未登録"} · {step.actor ?? "担当者未登録"} ·{" "}
          {mode(chapter.mode)}
        </p>
        <div className="kg-information-path">
          <section>
            <h4>① 受け取る・参照する情報</h4>
            {inputs.length ? (
              assetList([
                ...new Map(inputs.map((l) => [l.asset.id, l.asset])).values(),
              ])
            ) : (
              <p>入力情報は未登録</p>
            )}
          </section>
          <section>
            <h4>② 行うこと・使う道具</h4>
            <p>{step.action ?? step.description}</p>
            {[
              ...new Map(systems.map((l) => [l.asset.id, l.asset])).values(),
            ].map(showAsset)}
          </section>
          <section>
            <h4>③ 作る・更新する情報</h4>
            {outputs.length ? (
              assetList([
                ...new Map(outputs.map((l) => [l.asset.id, l.asset])).values(),
              ])
            ) : (
              <p>出力情報は未登録</p>
            )}
          </section>
        </div>
        {transfers.length > 0 && (
          <div>
            <h4>この手順で、システム間に情報を渡す</h4>
            {transfers.slice(0, 3).map((f) => (
              <p key={f.id}>
                {graph.nodes.find((n) => n.id === f.sourceSystemId)?.label} →{" "}
                {graph.nodes.find((n) => n.id === f.targetSystemId)?.label} ·{" "}
                {f.automation === "automatic"
                  ? "自動で連携"
                  : f.automation === "manual"
                    ? "人が受渡し・転記"
                    : "実行方法未確認"}
              </p>
            ))}
            {transfers.length > 3 && (
              <p>ほか{transfers.length - 3}件。詳細で確認できます。</p>
            )}
          </div>
        )}
        <button onClick={() => onDetail(step.id)}>
          この手順の判断・例外・個別作業を見る →
        </button>
      </article>
    </section>
  );
}
