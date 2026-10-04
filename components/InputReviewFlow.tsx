"use client";
import React from "react";

import type {
  ExtractionReview,
  ExtractionReviewStep,
  LensGraph,
} from "@/lib/graph";
import { describeHumanEdit } from "@/lib/review-workbench";
import { termExplanation } from "@/lib/knowledge-guide";
import { inputStepName } from "@/lib/input-canvas";

const certainty = {
  explicit: "原文に明示",
  inferred: "推定・要確認",
  unknown: "未確認",
};

/** The input review has one selection and one reading surface, with deeper detail on demand. */
export function InputReviewFlow({
  review,
  selected,
  graph,
  workflowId,
  busy,
  choose,
  onOverview,
  onEdit,
  onExclude,
  onWorkflow,
  unsavedWorkflowIds = [],
}: {
  review: ExtractionReview;
  selected: ExtractionReviewStep;
  graph: LensGraph;
  workflowId?: string;
  busy: boolean;
  choose: (step: ExtractionReviewStep) => void;
  onOverview?: () => void;
  onEdit: () => void;
  onExclude: () => void;
  onWorkflow: (id: string, stepKey?: string) => void;
  unsavedWorkflowIds?: string[];
}) {
  const inputs = selected.data.filter(
    (d) => d.operation === "read" || d.operation === "receive",
  );
  const outputs = selected.data.filter(
    (d) => d.operation !== "read" && d.operation !== "receive",
  );
  const transitions = review.transitions.filter(
    (t) => t.fromStepKey === selected.stepKey,
  );
  const heldInputs = review.transitions.filter(t => t.toStepKey === selected.stepKey && t.holdEffect === "response")
    .flatMap(t => {
      const stopped = review.steps.find(s => s.stepKey === t.fromStepKey);
      return stopped?.meaning?.halt ? [{ transition: t, stopped }] : [];
    });
  const inherited = (graph.knowledge?.handoffs ?? []).filter(
    (h) => h.reviewedWorkflowId && h.reviewedWorkflowId !== workflowId,
  );
  const handoffs = [
    ...(review.handoffs ?? []),
    ...inherited
      .filter(
        (h) =>
          h.sourceWorkflowId === workflowId &&
          graph.nodes
            .find((n) => n.id === h.sourceProcessId)
            ?.canonicalKey.split(":")
            .at(-1) === selected.stepKey,
      )
      .map((h) => ({
        fromStepKey: selected.stepKey,
        targetWorkflowId: h.targetWorkflowId,
        targetStepKey: graph.nodes
          .find((n) => n.id === h.targetProcessId)
          ?.canonicalKey.split(":")
          .at(-1),
        data: h.dataIds.map(
          (id) => graph.nodes.find((n) => n.id === id)?.label ?? id,
        ),
        description: h.description,
        evidence: h.evidence,
        certainty: h.status ?? "unknown",
        via: h.via,
      })),
  ].filter((h) => h.fromStepKey === selected.stepKey);
  const incoming = [
    ...(review.incomingHandoffs ?? []),
    ...inherited
      .filter(
        (h) =>
          h.targetWorkflowId === workflowId &&
          graph.nodes
            .find((n) => n.id === h.targetProcessId)
            ?.canonicalKey.split(":")
            .at(-1) === selected.stepKey,
      )
      .map((h) => ({
        sourceWorkflowId: h.sourceWorkflowId,
        sourceStepKey: graph.nodes
          .find((n) => n.id === h.sourceProcessId)
          ?.canonicalKey.split(":")
          .at(-1),
        toStepKey: selected.stepKey,
        data: h.dataIds.map(
          (id) => graph.nodes.find((n) => n.id === id)?.label ?? id,
        ),
        description: h.description,
        evidence: h.evidence,
        certainty: h.status ?? "unknown",
        via: h.via,
      })),
  ].filter((h) => h.toStepKey === selected.stepKey);
  const mode = {
    manual: "人が行う",
    automatic: "システムが自動で行う",
    mixed: "人とシステムが行う",
    unknown: "実行方法は未確認",
  };
  return (
    <article
      className="input-step-focus"
      aria-label="選んだ手順の人・道具・情報"
    >
      <div className="input-focus-heading">
        <div>
          <small>
            手順 {selected.order} / {review.steps.length} ·{" "}
            {certainty[selected.certainty]}
            {selected.humanEdits?.some(e => e.field !== "placement") ? " · 人の訂正あり" : selected.humanEdits?.length ? " · 追加位置を指定" : ""}
          </small>
          {onOverview && (
            <button className="input-back-overview" onClick={onOverview}>
              ↑ 話全体の流れ
            </button>
          )}
          <h3 title={selected.name}>{inputStepName(selected)}</h3>
        </div>
        <button className="button-secondary" disabled={busy} onClick={onEdit}>
          手順を編集
        </button>
      </div>
      <div className="input-who">
        <span>
          <strong>担当</strong>{" "}
          {selected.actor ||
            (selected.executionMode === "automatic" && selected.executingSystem
              ? selected.executingSystem
              : "まだ分かっていません")}
          {selected.department ? `（${selected.department}）` : ""}
        </span>
        <span className="input-mode">{mode[selected.executionMode]}</span>
      </div>
      <div className="input-tools" aria-label="この手順で使う道具">
        <span>道具</span>
        {[
          ...new Set([
            ...selected.systems.map((s) => s.name),
            ...(selected.executingSystem ? [selected.executingSystem] : []),
          ]),
        ].map((name) => (
          <details key={name}>
            <summary>{name}</summary>
            <p>
              {review.systemProfiles?.find((s) => s.name === name)?.purpose ||
                (termExplanation(name) ??
                  "この手順で使う道具。役割の説明はまだありません。")}
            </p>
            {review.systemProfiles
              ?.filter((s) => s.name === name)
              .map((s) => (
                <p key={s.name}>
                  {s.category || "分類は未確認"} ·{" "}
                  {s.certainty === "confirmed"
                    ? "原文に明示"
                    : "整理案・要確認"}
                  <br />
                  根拠：{s.evidence}
                </p>
              ))}
          </details>
        ))}
        {!selected.systems.length && !selected.executingSystem && (
          <span className="input-unconfirmed">まだ分かっていません</span>
        )}
      </div>
      {heldInputs.length > 0 && (
        <section className="input-incoming" aria-label="停止・保留からの対応">
          <h4>停止・保留からの対応</h4>
          {heldInputs.map(({ transition, stopped }, i) => (
            <div key={i}>
              <p>停止・保留中に進む対応 · {transition.certainty === "confirmed" ? "原文に明示" : "接続は要確認"}</p>
              <button onClick={() => choose(stopped)}>停止した処理：{inputStepName(stopped)} ←</button>
            </div>
          ))}
        </section>
      )}
      {incoming.length > 0 && (
        <section
          className="input-incoming"
          aria-label="前の業務から受け取る情報"
        >
          <h4>
            {incoming.every((h) => h.via === "reference")
              ? "この仕事が使う情報をつくる仕事"
              : "この仕事は、ここから受け取る"}
          </h4>
          {incoming.map((h, i) => {
            const source = graph.workflows.find(
              (w) => w.id === h.sourceWorkflowId,
            );
            return (
              <div key={i}>
                <p>
                  {h.description} ·{" "}
                  {h.certainty === "confirmed" ? "原文に明示" : "接続は要確認"}
                </p>
                <span>{h.data.join(" / ")}</span>
                {(unsavedWorkflowIds.includes(workflowId ?? "") || unsavedWorkflowIds.includes(h.sourceWorkflowId)) && <small>保存前の候補を含む接続</small>}
                {source && (
                  <button
                    onClick={() => onWorkflow(source.id, h.sourceStepKey)}
                  >
                    {h.via === "reference" ? "情報の作成元：" : "受取元："}
                    {source.name} ←
                  </button>
                )}
                {!h.sourceStepKey && <small>送り出す手順は未確認</small>}
                <details>
                  <summary>接続の根拠を見る</summary>
                  <blockquote>{h.evidence}</blockquote>
                </details>
              </div>
            );
          })}
        </section>
      )}
      <div className="input-information-change">
        <section>
          <h4>受け取る・判断の根拠</h4>
          {inputs.map((d, i) => (
            <span className="input-data-tag" key={`${d.name}:${d.operation}:${i}`}>
              {d.name}
            </span>
          ))}
          {selected.meaning?.basis &&
            !inputs.some((d) => d.name === selected.meaning?.basis.trim()) && (
              <p>{selected.meaning.basis}</p>
            )}
          {!inputs.length && !selected.meaning?.basis && (
            <p className="input-unconfirmed">何を見て判断するかは未確認</p>
          )}
        </section>
        <span className="input-change-arrow" aria-hidden="true">
          →
        </span>
        <section>
          <h4>決まる・次に渡すこと</h4>
          <p
            className={
              selected.meaning?.result ? "input-result" : "input-unconfirmed"
            }
          >
            {selected.meaning?.result ||
              "この作業の結果は、まだ確認できていません"}
          </p>
          {outputs.map((d, i) => (
            <span className="input-data-tag" key={`${d.name}:${d.operation}:${i}`}>
              {
                { send: "渡す情報：", create: "新しい情報：", update: "更新する情報：" }[
                  d.operation as "send" | "create" | "update"
                ]
              }
              {d.name}
            </span>
          ))}
        </section>
      </div>
      <section className="input-next-work" aria-label="条件と次の仕事">
        <h4>
          {selected.meaning?.halt
            ? transitions.length > 0 && transitions.every(t => t.holdEffect === "response")
              ? "停止・保留中に進む対応"
              : transitions.length > 1
              ? "条件ごとの進み方・保留"
              : selected.meaning.condition
                ? "条件による停止・保留"
                : "ここで停止・保留する"
            : "その後の仕事"}
        </h4>
        {selected.meaning?.condition && (
          <p className="input-condition">条件：{selected.meaning.condition}</p>
        )}
        {selected.meaning?.next && (transitions.length ? <details><summary>この先の仕事についての説明</summary><p>{selected.meaning.next}</p></details> : <p>{selected.meaning.next}</p>)}
        {transitions.map((t, i) => {
          const next = review.steps.find((s) => s.stepKey === t.toStepKey);
          return (
            next && (
              <button key={i} onClick={() => choose(next)}>
                <span>
                  {t.holdEffect === "response" ? "停止中の対応 · " : t.holdEffect === "resume" ? "再開 · " : ""}
                  {t.condition || "次へ"}
                  {t.certainty !== "confirmed" ? "（接続は要確認）" : ""}
                </span>{" "}
                → {inputStepName(next)}
              </button>
            )
          );
        })}
        {selected.meaning?.halt && transitions.some(t => t.holdEffect === "response") && !transitions.some(t => t.holdEffect === "resume") && (
          <p className="input-unconfirmed">ここでは停止・保留を解除していません。対応の先を辿って、再開する条件と戻る手順を確かめられます。</p>
        )}
        {handoffs.map((h, i) => {
          const target = graph.workflows.find(
            (w) => w.id === h.targetWorkflowId,
          );
          return (
            <div className="input-handoff" key={i}>
              <p>{h.description}</p>
              <small>
                {h.certainty === "confirmed" ? "原文に明示" : "接続は要確認"}
              </small>
              <span>{h.data.join(" / ")}</span>
              {(unsavedWorkflowIds.includes(workflowId ?? "") || unsavedWorkflowIds.includes(h.targetWorkflowId)) && <small>保存前の候補を含む接続</small>}
              {target && (
                <button onClick={() => onWorkflow(target.id, h.targetStepKey)}>
                  {h.via === "reference" ? "情報を使う業務：" : "次の業務："}
                  {target.name} →
                </button>
              )}
              {!h.targetStepKey && <small>受取手順は未確認</small>}
            </div>
          );
        })}
        {!transitions.length && !handoffs.length && (
          <p className="input-unconfirmed">
            {selected.meaning?.halt
              ? "再開条件と再開先は未確認です。分かっている範囲で、解除の判断や担当を補足できます。"
              : "次の接続は未確認です。完了なのか、誰に渡すのかを補足できます。"}
          </p>
        )}
      </section>
      <details className="input-evidence">
        <summary>原文の根拠・人が訂正した内容を見る</summary>
        <blockquote>{selected.evidence || "原文の根拠は未登録"}</blockquote>
        <p>
          この手順：{certainty[selected.certainty]}。結果の説明：
          {selected.meaning?.certainty === "confirmed"
            ? "確認済み"
            : selected.meaning?.certainty === "inferred"
              ? "推定"
              : "未確認"}
          。
        </p>
        {selected.meaning?.purpose && (
          <p>必要な理由：{selected.meaning.purpose}</p>
        )}
        {selected.meaning?.evidence && (
          <p>結果の根拠：{selected.meaning.evidence}</p>
        )}
        {selected.humanEdits?.flatMap(describeHumanEdit).map((text, i) => (
          <p key={i}>{text}</p>
        ))}
        <button disabled={busy} onClick={onExclude}>
          この手順を候補から除外する（原文は残す）
        </button>
      </details>
    </article>
  );
}
