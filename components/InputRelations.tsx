"use client";
import React, { useState } from "react";
import type { ExtractionReview, ExtractionReviewStep } from "@/lib/graph";

export function InputRelations({ review, kind, selected, choose }: {
  review: ExtractionReview; kind: "information" | "systems";
  selected?: ExtractionReviewStep; choose: (step: ExtractionReviewStep) => void;
}) {
  const [page, setPage] = useState(0);
  const tools = [...new Set(review.steps.flatMap(s => [
    ...s.systems.map(t => t.name), ...(s.executingSystem ? [s.executingSystem] : []),
  ]))];
  const size = kind === "systems" ? tools.length : Math.max(review.dataFlows.length, review.steps.length);
  const safePage = Math.max(0, Math.min(page, Math.ceil(size / 6) - 1));
  return <section className="input-relations" aria-label={kind === "systems" ? "この話のシステムと仕事" : "この話の情報の流れ"}>
    {kind === "systems" ? <>
      <p>道具を選ぶ前に、その道具を使って何をするかを確かめられます。</p>
      <div className="input-relation-tools">{tools.slice(safePage * 6, (safePage + 1) * 6).map(name => {
        const steps = review.steps.filter(s => s.executingSystem === name || s.systems.some(t => t.name === name));
        const profile = review.systemProfiles?.find(p => p.name === name);
        return <article key={name}><h3>{name}</h3>{profile?.purpose && <p>{profile.purpose} · {profile.certainty === "confirmed" ? "原文に明示" : "使い方の整理案"}</p>}
          {steps.map(step => <button key={step.stepKey} aria-pressed={step.stepKey === selected?.stepKey} onClick={() => choose(step)}>{step.order}. {step.name}</button>)}
        </article>;
      })}</div>
    </> : <>
      <h3>どこから、どこへ情報を渡すか</h3>
      <p>{review.dataFlows.length}件の受渡し · {review.steps.length}手順の情報の変化</p>
      {review.dataFlows.length ? review.dataFlows.slice(safePage * 6, (safePage + 1) * 6).map((flow, i) => <article key={i} className="input-relation-transfer">
        <div><strong>{flow.sourceSystem}</strong><span>→</span><strong>{flow.targetSystem}</strong></div>
        <p>{flow.data.join(" / ") || "情報名は未確認"}</p>
        <small>{flow.automation === "automatic" ? "自動で渡す" : flow.automation === "manual" ? "人が渡す・転記する" : flow.automation === "mixed" ? "人と自動処理で渡す" : "渡し方は未確認"} · {flow.certainty === "explicit" ? "原文に明示" : "推定・要確認"}</small>
        {flow.relatedStepKeys.map(key => review.steps.find(s => s.stepKey === key)).filter((s): s is ExtractionReviewStep => !!s).map(step => <button key={step.stepKey} onClick={() => choose(step)}>この情報を扱う手順：{step.order}. {step.name}</button>)}
        <details><summary>受渡しの根拠</summary><blockquote>{flow.evidence}</blockquote></details>
      </article>) : <p className="input-unconfirmed">道具どうしの受渡しは、まだ読み取れていません。各手順で使う情報は下で確認できます。</p>}
      <h3>手順を通じて、何が分かる・決まるか</h3>
      {review.steps.slice(safePage * 6, (safePage + 1) * 6).map(step => <button className="input-relation-outcome" key={step.stepKey} aria-pressed={step.stepKey === selected?.stepKey} onClick={() => choose(step)}>
        <strong>{step.order}. {step.name}</strong>
        <span>{step.data.filter(d => d.operation === "read" || d.operation === "receive").map(d => d.name).join(" / ") || step.meaning?.basis || "判断の根拠は未確認"}</span>
        <span>↓</span><span>{step.meaning?.result || "決まることは未確認"}</span>
      </button>)}
    </>}
    {size > 6 && <div className="kg-pagination"><button disabled={!safePage} onClick={() => setPage(safePage - 1)}>前の6件</button><span>{safePage + 1} / {Math.ceil(size / 6)}ページ{kind === "systems" ? ` · ${size}道具` : " · 受渡しと手順を6件ずつ"}</span><button disabled={(safePage + 1) * 6 >= size} onClick={() => setPage(safePage + 1)}>次の6件</button></div>}
  </section>;
}
