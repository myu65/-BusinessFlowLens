"use client";

import { useEffect, useState } from "react";
import type { LensGraph, Relation } from "@/lib/graph";
import { buildOverview, type OverviewScope } from "@/lib/overview";
import {
  emptyFilters,
  landscapeView,
  type LandscapeFilters,
} from "@/lib/landscape";
import { LandscapePanel } from "./LandscapePanel";
import { LandscapeEditor } from "./LandscapeEditor";

const roles: Record<Relation, string> = {
  next: "順序",
  uses: "利用",
  reads: "参照",
  writes: "登録・更新",
  sends: "送信",
};
export function BusinessOverview({
  graph,
  onOpen,
  onEdit,
  onGraphApply,
}: {
  graph: LensGraph;
  onOpen: (id: string) => void;
  onEdit: () => void;
  onGraphApply: (graph: LensGraph) => void;
}) {
  const [scope, setScope] = useState<OverviewScope>("current");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<LandscapeFilters>(emptyFilters);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [preferencesError, setPreferencesError] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("flow-lens-overview-v1") || "null",
      );
      if (saved && typeof saved === "object") {
        const next = emptyFilters();
        for (const key of [
          "domain",
          "site",
          "product",
          "perspective",
          "query",
          "anchorId",
        ] as const)
          if (typeof saved[key] === "string") next[key] = saved[key];
        if (["all", "focus", "nearby", "interests"].includes(saved.range))
          next.range = saved.range;
        if (
          [
            "relations",
            "product",
            "common",
            "material",
            "data",
            "business",
          ].includes(saved.topic)
        )
          next.topic = saved.topic;
        if (Array.isArray(saved.pinnedIds))
          next.pinnedIds = saved.pinnedIds.filter(
            (id: unknown) => typeof id === "string",
          );
        setFilters(next);
      }
    } catch {
      setPreferencesError(true);
    }
    setPreferencesReady(true);
  }, []);
  useEffect(() => {
    if (!preferencesReady) return;
    try {
      localStorage.setItem("flow-lens-overview-v1", JSON.stringify(filters));
    } catch {
      setPreferencesError(true);
    }
  }, [filters, preferencesReady]);
  const landscape = landscapeView(graph, scope, filters);
  const view = buildOverview(
    { ...graph, workflows: landscape.workflows },
    scope,
  );
  const selected = view.data.find((d) => d.asset.id === selectedId);
  const label = (id: string) =>
    graph.nodes.find((n) => n.id === id)?.label ?? "未確認";
  return (
    <section className="page-view bird-view">
      <div className="eyebrow">業務とデータの全体像</div>
      <h1>業務・製品・物の流れを、見たい範囲で。</h1>
      <p>
        チェーンや工場で絞り、同じ製品の視点、共通業務のやり方、物とデータのつながりを辿れます。
      </p>
      <label className="overview-scope">
        見る対象
        <select
          value={scope}
          onChange={(e) => {
            setScope(e.target.value as OverviewScope);
            setSelectedId(null);
          }}
        >
          <option value="current">現状</option>
          <option value="future">将来案</option>
          <option value="alternative">代替案</option>
          <option value="all">全案（比較用）</option>
        </select>
      </label>
      {preferencesError ? (
        <p role="status">
          このブラウザに関心・範囲を保存できません。今回の表示には利用できます。
        </p>
      ) : null}
      <LandscapePanel
        graph={graph}
        view={landscape}
        filters={filters}
        onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        onOpen={onOpen}
      />
      <LandscapeEditor
        graph={graph}
        initialWorkflowId={filters.anchorId || undefined}
        onApply={onGraphApply}
      />
      {filters.topic === "data" ? (
        <>
          <div className="overview-summary">
            <span>
              業務 <b>{view.workflows.length}</b>
            </span>
            <span>
              共通データ{" "}
              <b>{view.data.filter((d) => d.workflows.length > 1).length}</b>
            </span>
            <span>
              個別データ{" "}
              <b>{view.data.filter((d) => d.workflows.length === 1).length}</b>
            </span>
            <span>
              記録済み受け渡し <b>{view.flows.length}</b>
            </span>
          </div>
          <section className="overview-map">
            <h2>データから業務の接点を見る</h2>
            <p>
              共通＝この表示対象で複数業務が同じ保存データを参照。データ名を選ぶと根拠を確認できます。
            </p>
            {view.data.length ? (
              <div className="overview-table-scroll">
                <table className="overview-table">
                  <caption>業務データと業務の関係</caption>
                  <thead>
                    <tr>
                      <th scope="col">業務データ</th>
                      {view.workflows.map((w) => (
                        <th scope="col" key={w.id}>
                          {w.name}
                          <small>
                            {w.scenario === "future"
                              ? "将来案"
                              : w.scenario === "alternative"
                                ? "代替案"
                                : "現状"}
                          </small>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {view.data.map((row) => (
                      <tr key={row.asset.id}>
                        <th scope="row">
                          <button
                            aria-pressed={selectedId === row.asset.id}
                            onClick={() => setSelectedId(row.asset.id)}
                          >
                            {row.asset.label}
                          </button>
                          <small>
                            {row.workflows.length > 1 ? "共通" : "個別"} ·{" "}
                            {row.asset.status === "confirmed"
                              ? "確認済み"
                              : "要確認"}
                          </small>
                        </th>
                        {view.workflows.map((w) => {
                          const names = [
                            ...new Set(
                              row.usages
                                .filter((u) => u.process.workflowId === w.id)
                                .map((u) => roles[u.relation]),
                            ),
                          ];
                          if (
                            row.transfers.some((f) =>
                              f.workflowIds.includes(w.id),
                            )
                          )
                            names.push("受け渡し");
                          if (
                            row.materialLinks.some(
                              (h) =>
                                h.sourceWorkflowId === w.id ||
                                h.targetWorkflowId === w.id,
                            )
                          )
                            names.push("物との対応");
                          if (
                            !names.length &&
                            row.direct.some((e) => e.workflowIds.includes(w.id))
                          )
                            names.push("システム関連");
                          return (
                            <td key={w.id}>
                              {names.length ? names.join(" / ") : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>
                この対象の業務データは未登録です。メモで「何を参照・登録するか」を補足すると接点が見えてきます。
              </p>
            )}
            {selected ? (
              <aside
                className="overview-focus"
                aria-label="選択したデータの根拠"
              >
                <h3>{selected.asset.label}の関係と確認事項</h3>
                <p>
                  {selected.asset.description || "意味・対象範囲は未登録です。"}
                </p>
                <p>
                  記録上の関連システム：
                  {selected.systems.map((s) => s.label).join(" / ") || "未確認"}
                </p>
                <p className="uncertainty-note">
                  正本・管理責任・識別子・対象範囲は、この一覧だけでは確定できません。
                  {selected.systems.length > 1
                    ? "複数システムとの関係があります。同じデータの複製か、役割が異なるか確認してください。"
                    : "担当者にデータの意味と管理先を確認できます。"}
                </p>
                <ul>
                  {selected.usages.map((u, i) => (
                    <li key={i}>
                      {u.process.label}：{roles[u.relation]} · 根拠：
                      {u.process.evidence || "未登録"}
                      {u.process.status !== "confirmed" ? "（要確認）" : ""}
                    </li>
                  ))}
                  {selected.direct.map((e) => (
                    <li key={e.id}>
                      {label(e.source)} → {label(e.target)}：{roles[e.relation]}{" "}
                      · {e.label || "根拠未登録"}
                    </li>
                  ))}
                  {selected.transfers.map((f) => (
                    <li key={f.id}>
                      {label(f.sourceSystemId)}{" "}
                      {f.direction === "bidirectional"
                        ? "↔"
                        : f.direction === "unknown"
                          ? "—（方向未確認）"
                          : "→"}{" "}
                      {label(f.targetSystemId)} · {f.evidence || "根拠未登録"}
                      {f.status !== "confirmed" ? "（要確認）" : ""}
                    </li>
                  ))}
                  {selected.materialLinks.map((h) => (
                    <li key={`${h.sourceWorkflowId}/${h.id}`}>
                      物：{h.material} ·{" "}
                      {h.dataContinuity === "linked"
                        ? "対応確認済み"
                        : h.dataContinuity === "broken"
                          ? "途切れ確認"
                          : "対応未確認"}{" "}
                      · 根拠：{h.evidence || "未登録"}
                    </li>
                  ))}
                </ul>
                <div className="bird-assets">
                  {selected.workflows.map((w) => (
                    <button key={w.id} onClick={() => onOpen(w.id)}>
                      {w.name}の手順へ →
                    </button>
                  ))}
                </div>
              </aside>
            ) : (
              <p className="uncertainty-note">
                システムとデータの同時利用だけから、保存先や連携を推定しません。
              </p>
            )}
          </section>
        </>
      ) : null}
      {filters.topic === "business" ? (
        <>
          <h2>業務の目的と範囲をつかむ</h2>
          <div className="bird-grid">
            {view.businesses.map(
              ({ workflow: w, steps, departments, data }) => (
                <article className="bird-card" key={w.id}>
                  <small>
                    {w.scenario === "future"
                      ? "将来案"
                      : w.scenario === "alternative"
                        ? "代替案"
                        : "現状"}{" "}
                    · {steps.length}ステップ
                  </small>
                  <h3>{w.name}</h3>
                  <p>
                    {w.reviewContext?.summary || w.description || "概要未登録"}
                  </p>
                  <dl className="overview-purpose">
                    <dt>開始</dt>
                    <dd>{w.reviewContext?.trigger || "開始条件は未確認"}</dd>
                    <dt>成果</dt>
                    <dd>{w.reviewContext?.outcome || "完了・成果は未確認"}</dd>
                    <dt>担当</dt>
                    <dd>{departments.join(" / ") || "担当未確認"}</dd>
                  </dl>
                  <div className="bird-assets">
                    {data.map((d) => (
                      <button
                        key={d.asset.id}
                        onClick={() => {
                          setSelectedId(d.asset.id);
                          setFilters((f) => ({ ...f, topic: "data" }));
                        }}
                      >
                        {d.asset.label}
                        {d.workflows.length > 1 ? " · 共通" : ""}
                      </button>
                    ))}
                  </div>
                  <p className="uncertainty-note">
                    {steps.filter((s) => s.status !== "confirmed").length}
                    ステップが要確認{!data.length ? " · 業務データ未登録" : ""}
                  </p>
                  <button onClick={() => onOpen(w.id)}>手順を読む →</button>
                </article>
              ),
            )}
          </div>
          {!view.workflows.length ? (
            <div className="empty-state">
              この対象の業務はまだありません。
              <button onClick={onEdit}>業務入力へ</button>
            </div>
          ) : null}
        </>
      ) : null}
      {filters.topic === "data" ? (
        <section className="bird-transfers">
          <h2>記録済みのシステム間受け渡し</h2>
          {view.flows.length ? (
            view.flows.map((f) => (
              <article key={f.id}>
                <strong>
                  {label(f.sourceSystemId)}{" "}
                  {f.direction === "bidirectional"
                    ? "↔"
                    : f.direction === "unknown"
                      ? "—（方向未確認）"
                      : "→"}{" "}
                  {label(f.targetSystemId)}
                </strong>
                <span>
                  {f.dataIds.map(label).join(" / ") || "データ未確認"} ·{" "}
                  {f.automation === "automatic"
                    ? "自動"
                    : f.automation === "manual"
                      ? "手動"
                      : f.automation === "mixed"
                        ? "自動・手動混在"
                        : "方式未確認"}
                </span>
                <small>
                  {view.workflows
                    .filter((w) => f.workflowIds.includes(w.id))
                    .map((w) => w.name)
                    .join(" / ")}{" "}
                  · {f.evidence || "根拠未登録"} ·{" "}
                  {f.status === "confirmed" ? "確認済み" : "要確認"}
                </small>
              </article>
            ))
          ) : (
            <p>
              受け渡しは未登録です。共有データがあっても、業務間の受け渡しがあるとは確定できません。
            </p>
          )}
        </section>
      ) : null}
      <details className="overview-reading">
        <summary>鳥瞰の読み方と設計の参考</summary>
        <p>
          ①現状と案を分ける → ②共通データを見る →
          ③関連業務・システムと根拠を確認 → ④意味・管理先が不明なら補足 →
          ⑤手順・技術詳細へ進む。
        </p>
        <p>
          業務データの名称と関係を表示します。物理テーブル、トランザクション、HANAの領域は詳細で確認できます。
        </p>
        <a
          href="https://jp.drinet.co.jp/blog/datamanagement/oldgr7rdvubdu"
          target="_blank"
          rel="noreferrer"
        >
          データ総研：データアーキテクチャの策定
        </a>
        <br />
        <a
          href="https://jp.drinet.co.jp/blog/datamanagement/olda7m3zhsbnl"
          target="_blank"
          rel="noreferrer"
        >
          データ総研：業務モデルとシステムモデル
        </a>
      </details>
    </section>
  );
}
