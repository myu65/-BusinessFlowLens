"use client";
import React, { useId } from "react";
import type { ExtractionReview, ExtractionReviewStep } from "@/lib/graph";
import { inputCanvasLayout, inputStepMode } from "@/lib/input-canvas";

export function InputFlowCanvas({ review, selected, page, onPage, choose, added = [], changed = [] }: {
  review: ExtractionReview;
  selected: ExtractionReviewStep;
  page: number;
  onPage: (page: number) => void;
  choose: (step: ExtractionReviewStep) => void;
  added?: string[];
  changed?: string[];
}) {
  const layout = inputCanvasLayout(review, page);
  const marker = useId().replace(/:/g, "");
  const byKey = new Map(layout.nodes.map(n => [n.step.stepKey, n]));
  return <section className="input-canvas-section" aria-label="話からできた業務の流れ">
    <div className="input-canvas-key">
      <span>手順を選ぶと、右で確かめられます</span>
      <span><i className="input-key-human" />人の作業 <i className="input-key-auto" />システム自動 <i className="input-key-hold" />保留</span>
    </div>
    <div className="input-canvas-scroll">
      <nav className="input-flow-canvas" aria-label="入力が作った手順" style={{ width: layout.width, height: layout.height }}>
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
          <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
          {layout.edges.map((edge, i) => {
            const from = byKey.get(edge.fromStepKey)!, to = byKey.get(edge.toStepKey)!;
            const sameRow = from.y === to.y;
            const right = to.x > from.x;
            const sx = sameRow ? from.x + (right ? 140 : 0) : from.x + 70;
            const sy = sameRow ? from.y + 64 : from.y + 128;
            const tx = sameRow ? to.x + (right ? 0 : 140) : to.x + 70;
            const ty = sameRow ? to.y + 64 : to.y;
            const blocked = layout.nodes.some(n => n !== from && n !== to && n.x < Math.max(sx, tx) && n.x + 140 > Math.min(sx, tx) && n.y <= sy && n.y + 128 >= sy);
            const straight = sameRow && !blocked;
            const rail = 512 + i * 3;
            // Route branches around cards; a check→hold edge must never pass through approval.
            const d = straight ? `M${sx},${sy} L${tx},${ty}`
              : `M${from.x + 70},${from.y + 128} L${from.x + 70},${from.y + 146} L${rail},${from.y + 146} L${rail},${to.y - 12} L${to.x + 70},${to.y - 12} L${to.x + 70},${to.y}`;
            const halt = to.step.meaning?.halt;
            return <g key={i} data-from={edge.fromStepKey} data-to={edge.toStepKey} data-certainty={edge.certainty ?? "unknown"} data-halt={halt || undefined}>
              <path d={d} markerEnd={`url(#${marker})`} />
              {edge.condition && <text x={sameRow ? (sx + tx) / 2 : tx} y={sameRow ? sy - 10 : ty - 9} textAnchor="middle"><title>{edge.condition}</title>{edge.condition.length > 14 ? `${edge.condition.slice(0, 14)}…` : edge.condition}</text>}
            </g>;
          })}
        </svg>
        {layout.nodes.map(({ step, x, y, isolated }) => <button key={step.stepKey}
          style={{ left: x, top: y }}
          aria-pressed={selected.stepKey === step.stepKey}
          className="input-canvas-step"
          data-mode={step.executionMode}
          data-halt={step.meaning?.halt || undefined}
          data-unconfirmed={step.certainty !== "explicit" || isolated || undefined}
          data-change={added.includes(step.stepKey) ? "added" : changed.includes(step.stepKey) ? "changed" : undefined}
          onClick={() => choose(step)}>
          <small>{step.order}. {added.includes(step.stepKey) ? "追加" : changed.includes(step.stepKey) ? "訂正" : step.humanEdits?.length ? "人が訂正" : step.certainty === "inferred" ? "推定・要確認" : "原文に明示"}</small>
          <strong>{step.name}</strong>
          <span>{step.actor || step.executingSystem || "担当は未確認"}</span>
          <em>{step.meaning?.halt ? "停止・保留" : inputStepMode(step)}</em>
          <span className="input-canvas-tools">{[...new Set(step.systems.map(s => s.name))].slice(0, 2).join(" · ") || "道具は未確認"}</span>
        </button>)}
      </nav>
    </div>
    <p className="input-canvas-footnote">矢印は読み取った接続です。点線は要確認。つながっていない手順の前後は、まだ分かっていません。</p>
    {layout.total > 6 && <div className="kg-pagination">
      <button disabled={layout.page === 0} onClick={() => onPage(layout.page - 1)}>前の6手順</button>
      <span>{layout.page * 6 + 1}–{Math.min(layout.total, (layout.page + 1) * 6)} / {layout.total}手順</span>
      <button disabled={(layout.page + 1) * 6 >= layout.total} onClick={() => onPage(layout.page + 1)}>次の6手順</button>
    </div>}
    {layout.outside.length > 0 && <details><summary>表示の外につながる接続 · {layout.outside.length}件</summary>{layout.outside.map((edge, i) => {
      const other = review.steps.find(s => s.stepKey === (byKey.has(edge.fromStepKey) ? edge.toStepKey : edge.fromStepKey));
      return other && <button key={i} onClick={() => choose(other)}>{edge.condition || "続きの手順"} → {other.name}</button>;
    })}</details>}
  </section>;
}
