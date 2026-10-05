"use client";
import React from "react";
import type { WorkBoundary } from "@/lib/graph";
import { boundaryScope, boundaryVisibility } from "@/lib/work-boundary";

export function WorkBoundaryEditor({ value, onChange }: { value?: WorkBoundary; onChange: (value: WorkBoundary) => void }) {
  const b: WorkBoundary = value ?? { scope: "unknown", party: "", visibility: "unknown", incoming: [], outgoing: [], unknowns: [], certainty: "unknown", evidence: "" };
  const change = (patch: Partial<WorkBoundary>) => onChange({ ...b, ...patch, certainty: "confirmed", evidence: "利用者が構造の確認中に補足" });
  return <details className="work-boundary-editor"><summary>社内・社外と、見えていない範囲を訂正する</summary>
    <label className="kg-edit-field">工程の範囲<select value={b.scope} onChange={e => change({ scope: e.target.value as WorkBoundary["scope"] })}>{Object.entries(boundaryScope).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
    <label className="kg-edit-field">社外の相手<input value={b.party} onChange={e => change({ party: e.target.value })} /></label>
    <label className="kg-edit-field">内部の進め方が見える範囲<select value={b.visibility} onChange={e => change({ visibility: e.target.value as WorkBoundary["visibility"] })}>{Object.entries(boundaryVisibility).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
    {([["incoming", "この工程に渡すもの"], ["outgoing", "この工程から戻るもの"], ["unknowns", "まだ見えていない点"]] as const).map(([field, label]) => <label className="kg-edit-field" key={field}>{label}<textarea rows={2} value={b[field].join("\n")} onChange={e => change({ [field]: e.target.value.split(/\r?\n/) })} /><small>1行に1つ。分からない項目は空欄にできます。</small></label>)}
  </details>;
}
