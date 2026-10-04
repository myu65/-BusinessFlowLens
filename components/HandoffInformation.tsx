"use client";
import React, { useState } from "react";
import type { HandoffDataBinding, LensGraph } from "@/lib/graph";
import { handoffInformationText, resolveHandoffInformation } from "@/lib/handoff-information";

export function HandoffInformation({ graph, sourceWorkflowId, sourceStepKey, names, bindings, busy, onConfirm }: {
  graph: LensGraph; sourceWorkflowId: string; sourceStepKey?: string; names: string[]; bindings?: HandoffDataBinding[];
  busy: boolean; onConfirm?: (name: string, dataId: string) => void;
}) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const resolution = resolveHandoffInformation(graph, sourceWorkflowId, sourceStepKey, names, bindings);
  const choice = (name: string) => choices[name] ?? bindings?.find(binding => binding.name === name)?.dataId ?? "";
  const editor = (name: string) => <div key={name}>
    <label className="kg-edit-field">「{name}」にあたる情報
      <select value={choice(name)} disabled={busy} onChange={e => setChoices({ ...choices, [name]: e.target.value })}>
        <option value="">情報の対応は未確認のままにする</option>
        {resolution.available.map(item => <option key={item.data.id} value={item.data.id}>
          {item.data.label} · {item.step.label}
        </option>)}
      </select>
    </label>
    <button disabled={busy || !resolution.available.some(item => item.data.id === choice(name))}
      onClick={() => onConfirm?.(name, choice(name))}>この情報を確認：{name}</button>
    {bindings?.some(binding => binding.name === name && binding.dataId) && <button disabled={busy}
      onClick={() => { setChoices({ ...choices, [name]: "" }); onConfirm?.(name, ""); }}>対応を未確認に戻す：{name}</button>}
    {!resolution.available.length && <small>参照元が作る・渡す情報は、まだ登録されていません。候補名を残して後で確認できます。</small>}
  </div>;
  return <div className="input-handoff-information">
    <p>{handoffInformationText(graph, { dataIds: resolution.dataIds, dataNames: names, dataBindings: bindings })}</p>
    {onConfirm && resolution.unresolved.map(editor)}
    {onConfirm && resolution.resolved.some(item => item.binding) && <details><summary>情報の対応を訂正する</summary>
      {resolution.resolved.filter(item => item.binding).map(item => editor(item.name))}
    </details>}
    {bindings?.length ? <details><summary>情報の対応を確認した記録</summary>{bindings.map(binding => <p key={binding.name}>{binding.evidence}</p>)}</details> : null}
  </div>;
}
