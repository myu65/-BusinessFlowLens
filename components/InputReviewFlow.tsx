"use client";
import React from "react";

import type {
  ExtractionReview,
  ExtractionReviewStep,
  LensGraph,
} from "@/lib/graph";
import { describeHumanEdit } from "@/lib/review-workbench";
import { termExplanation } from "@/lib/knowledge-guide";

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
  busy,
  choose,
  onOverview,
  onEdit,
  onExclude,
  onWorkflow,
}: {
  review: ExtractionReview;
  selected: ExtractionReviewStep;
  graph: LensGraph;
  busy: boolean;
  choose: (step: ExtractionReviewStep) => void;
  onOverview?: () => void;
  onEdit: () => void;
  onExclude: () => void;
  onWorkflow: (id: string, stepKey?: string) => void;
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
  const handoffs = (review.handoffs ?? []).filter(
    (h) => h.fromStepKey === selected.stepKey,
  );
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
            {selected.humanEdits?.length ? " · 人の訂正あり" : ""}
          </small>
          {onOverview && (
            <button className="input-back-overview" onClick={onOverview}>
              ↑ 話全体の流れ
            </button>
          )}
          <h3>{selected.name}</h3>
        </div>
        <button className="button-secondary" disabled={busy} onClick={onEdit}>
          この理解を訂正する
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
              {termExplanation(name) ??
                "この手順で使う道具。役割の説明はまだありません。"}
            </p>
          </details>
        ))}
        {!selected.systems.length && !selected.executingSystem && (
          <span className="input-unconfirmed">まだ分かっていません</span>
        )}
      </div>
      <div className="input-information-change">
        <section>
          <h4>受け取る・判断の根拠</h4>
          {inputs.map((d) => (
            <span className="input-data-tag" key={d.name}>
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
          {outputs.map((d) => (
            <span className="input-data-tag" key={d.name}>
              {d.name}
              {
                { send: "を渡す", create: "を作る", update: "を更新する" }[
                  d.operation as "send" | "create" | "update"
                ]
              }
            </span>
          ))}
        </section>
      </div>
      <section className="input-next-work" aria-label="条件と次の仕事">
        <h4>
          {selected.meaning?.halt ? "ここで停止・保留する" : "その後の仕事"}
        </h4>
        {selected.meaning?.condition && (
          <p className="input-condition">条件：{selected.meaning.condition}</p>
        )}
        {selected.meaning?.next && <p>{selected.meaning.next}</p>}
        {transitions.map((t, i) => {
          const next = review.steps.find((s) => s.stepKey === t.toStepKey);
          return (
            next && (
              <button key={i} onClick={() => choose(next)}>
                <span>
                  {t.condition || "次へ"}
                  {t.certainty !== "confirmed" ? "（接続は要確認）" : ""}
                </span>{" "}
                → {next.name}
              </button>
            )
          );
        })}
        {handoffs.map((h, i) => {
          const target = graph.workflows.find(
            (w) => w.id === h.targetWorkflowId,
          );
          return (
            <div className="input-handoff" key={i}>
              <p>{h.description}</p>
              <span>{h.data.join(" / ")}</span>
              {target && (
                <button onClick={() => onWorkflow(target.id, h.targetStepKey)}>
                  次の業務：{target.name} →
                </button>
              )}
              {!h.targetStepKey && <small>受取手順は未確認</small>}
            </div>
          );
        })}
        {!transitions.length && !handoffs.length && (
          <p className="input-unconfirmed">
            次の接続は未確認です。完了なのか、誰に渡すのかを補足できます。
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
