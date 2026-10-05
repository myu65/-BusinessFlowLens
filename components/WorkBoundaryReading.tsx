import React from "react";
import type { WorkBoundary } from "@/lib/graph";
import { boundaryScope, boundaryVisibility } from "@/lib/work-boundary";

export function WorkBoundaryReading({ boundary }: { boundary?: WorkBoundary }) {
  if (!boundary) return null;
  return <section className="work-boundary" data-scope={boundary.scope} aria-label="社内・社外と見える範囲">
    <h4>{boundaryScope[boundary.scope]}の工程{boundary.party && ` · ${boundary.party}`}</h4>
    <p>{boundaryVisibility[boundary.visibility]} · {boundary.certainty === "confirmed" ? "原文または人の確認あり" : boundary.certainty === "inferred" ? "推定・要確認" : "未確認"}</p>
    <div className="work-boundary-exchanges"><div><strong>この工程に渡す</strong><p>{boundary.incoming.join(" / ") || "受渡すものは未確認"}</p></div><div><strong>この工程から戻る</strong><p>{boundary.outgoing.join(" / ") || "戻るものは未確認"}</p></div></div>
    {!!boundary.unknowns.length && <details><summary>まだ見えていない点 · {boundary.unknowns.length}件</summary>{boundary.unknowns.map((u, i) => <p key={i}>{u}</p>)}</details>}
    <details><summary>範囲の根拠</summary><p>{boundary.evidence || "根拠は未登録"}</p></details>
  </section>;
}
