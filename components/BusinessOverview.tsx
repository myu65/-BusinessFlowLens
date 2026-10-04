"use client";

import { useEffect, useMemo, useState } from "react";
import type { LensGraph } from "@/lib/graph";
import { buildOverview, type OverviewScope } from "@/lib/overview";
import {
  emptyFilters,
  landscapeView,
  type LandscapeFilters,
} from "@/lib/landscape";
import { LandscapePanel } from "./LandscapePanel";
import { LandscapeEditor } from "./LandscapeEditor";
import { OverviewDataMatrix } from "./OverviewDataMatrix";
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
  const landscape = useMemo(() => landscapeView(graph, scope, filters), [graph, scope, filters]);
  const view = useMemo(() => buildOverview({ ...graph, workflows: landscape.workflows }, scope), [graph, scope, landscape.workflows]);
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
      {filters.topic === "data" ? <OverviewDataMatrix graph={graph} view={view} onOpen={onOpen} initialSelectedId={selectedId} /> : null}
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
                    {w.summary ||
                      w.reviewContext?.summary ||
                      w.description ||
                      "概要未登録"}
                  </p>
                  <dl className="overview-purpose">
                    <dt>開始</dt>
                    <dd>
                      {w.trigger ||
                        w.reviewContext?.trigger ||
                        "開始条件は未確認"}
                    </dd>
                    <dt>成果</dt>
                    <dd>
                      {w.outcome ||
                        w.reviewContext?.outcome ||
                        "完了・成果は未確認"}
                    </dd>
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
