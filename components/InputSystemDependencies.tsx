"use client";
import { useState } from "react";
import type { ExtractionReview, ReviewSystemDependency } from "@/lib/graph";
import { editSystemDependency } from "@/lib/system-dependencies";
import { describeHumanEdit } from "@/lib/review-workbench";

export function InputSystemDependencies({ review, busy, onChange }: { review: ExtractionReview; busy: boolean; onChange: (r: ExtractionReview) => void }) {
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState({ system: "", prerequisite: "", reason: "" });
  const dependencies = review.systemDependencies ?? [];
  if (!dependencies.length) return null;
  const change = (index: number, patch: Partial<ReviewSystemDependency>) => {
    const previous = dependencies[index], updated = editSystemDependency(previous, patch);
    const renamed = updated.system !== previous.system || updated.prerequisite !== previous.prerequisite;
    onChange({ ...review, systemDependencies: [...dependencies.map((d, i) => i === index ? updated : d), ...(renamed ? [editSystemDependency(previous, { rejected: true })] : [])] });
    setEditing(null);
  };
  return <details open={!review.steps.length}>
    <summary>道具が動くために必要な仕組み · {dependencies.filter(d => !d.rejected).length}関係</summary>
    <p>作業で使う道具と、その道具の認証・接続などを支える仕組みを区別します。未確認・除外した関係は影響の集計に使いません。</p>
    {dependencies.map((d, index) => <article key={`${index}:${d.system}:${d.prerequisite}`}>
      <h4>{d.system} → 必要な仕組み：{d.prerequisite}</h4>
      <p>{d.rejected ? "この関係は除外" : d.certainty === "confirmed" ? "入力・訂正の根拠あり" : d.certainty === "inferred" ? "推定・要確認" : "未確認"} · {d.reason || "理由は未確認"}</p>
      <p>原文の根拠：{d.evidence}</p>
      {d.humanEdits?.map((edit, i) => <p key={i}>人の訂正：{describeHumanEdit(edit).join("、")}</p>)}
      {editing === index ? <fieldset disabled={busy}>
        <label className="kg-edit-field">依存する道具<input value={form.system} onChange={e => setForm({ ...form, system: e.target.value })} /></label>
        <label className="kg-edit-field">必要な仕組み<input value={form.prerequisite} onChange={e => setForm({ ...form, prerequisite: e.target.value })} /></label>
        <label className="kg-edit-field">必要な理由<input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></label>
        <button disabled={!form.system.trim() || !form.prerequisite.trim() || form.system.trim() === form.prerequisite.trim()} onClick={() => change(index, { ...form, certainty: "confirmed", rejected: false })}>依存の訂正を反映</button>
        <button onClick={() => setEditing(null)}>閉じる</button>
      </fieldset> : <>
        <button disabled={busy} onClick={() => { setForm({ system: d.system, prerequisite: d.prerequisite, reason: d.reason }); setEditing(index); }}>依存関係を訂正する</button>
        <button disabled={busy} onClick={() => change(index, { rejected: !d.rejected })}>{d.rejected ? "この関係を戻す" : "この関係を除外する"}</button>
      </>}
    </article>)}
  </details>;
}
