"use client";

import { useEffect, useState } from "react";
import type { LensGraph } from "@/lib/graph";
import {
  BUSINESS_DOMAINS,
  type LandscapeFilters,
  type landscapeView,
} from "@/lib/landscape";

type View = ReturnType<typeof landscapeView>;
export function LandscapePanel({
  graph,
  view,
  filters,
  onChange,
  onOpen,
}: {
  graph: LensGraph;
  view: View;
  filters: LandscapeFilters;
  onChange: (patch: Partial<LandscapeFilters>) => void;
  onOpen: (id: string) => void;
}) {
  const [relationLimit, setRelationLimit] = useState(12);
  useEffect(() => setRelationLimit(12), [filters]);
  const scenario = (id: string) => {
    const value = graph.workflows.find((w) => w.id === id)?.scenario;
    return value === "future"
      ? "将来案"
      : value === "alternative"
        ? "代替案"
        : "現状";
  };
  const values = (key: "site" | "productId" | "perspective") =>
    [
      ...new Set(
        view.base.workflows
          .map((w) => w.landscape?.[key])
          .filter((v): v is string => Boolean(v)),
      ),
    ].sort();
  const domains = [
    ...new Set([
      ...BUSINESS_DOMAINS,
      ...view.base.workflows.flatMap((w) => w.landscape?.domains ?? []),
    ]),
  ];
  const name = (id: string) =>
    graph.workflows.find((w) => w.id === id)?.name ?? "業務未確認";
  const site = (id: string) =>
    graph.workflows.find((w) => w.id === id)?.landscape?.site || "拠点未登録";
  const toggle = (id: string) =>
    onChange({
      pinnedIds: filters.pinnedIds.includes(id)
        ? filters.pinnedIds.filter((p) => p !== id)
        : [...filters.pinnedIds, id],
    });
  const commonIds = [
    ...new Set(
      view.workflows.map((w) => w.landscape?.commonProcessId).filter(Boolean),
    ),
  ];
  const productIds = [
    ...new Set(
      view.workflows.map((w) => w.landscape?.productId).filter(Boolean),
    ),
  ];
  return (
    <>
      <section className="landscape-controls" aria-label="鳥瞰の範囲">
        <h2>見たい範囲を選ぶ</h2>
        <div className="landscape-filter-grid">
          <label>
            分類
            <select
              value={filters.domain}
              onChange={(e) => onChange({ domain: e.target.value })}
            >
              <option value="">すべての分類</option>
              <option value="__unclassified">分類未登録</option>
              {domains.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          {(
            [
              ["site", "工場・拠点", "site"],
              ["product", "製品", "productId"],
              ["perspective", "視点", "perspective"],
            ] as const
          ).map(([key, title, field]) => (
            <label key={key}>
              {title}
              <select
                value={filters[key]}
                onChange={(e) => onChange({ [key]: e.target.value })}
              >
                <option value="">すべて</option>
                <option value="__unclassified">未登録</option>
                {values(field).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label>
            名前・実施方法で検索
            <input
              value={filters.query}
              onChange={(e) => onChange({ query: e.target.value })}
              placeholder="例：検品、バーコード、原価"
            />
          </label>
          <label>
            表示する広さ
            <select
              value={filters.range}
              onChange={(e) =>
                onChange({ range: e.target.value as LandscapeFilters["range"] })
              }
            >
              <option value="all">選んだ範囲の全体</option>
              <option value="focus">注目業務だけ</option>
              <option value="nearby">注目業務と直接の関係先</option>
              <option value="interests">関心業務と直接の関係先</option>
            </select>
          </label>
          <label>
            注目する業務
            <select
              value={filters.anchorId}
              onChange={(e) => onChange({ anchorId: e.target.value })}
            >
              <option value="">選択してください</option>
              {view.base.workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p>
          {view.workflows.length} / {view.base.workflows.length}業務を表示 ·
          関心業務{" "}
          {
            filters.pinnedIds.filter((id) =>
              graph.workflows.some((w) => w.id === id),
            ).length
          }
          件
        </p>
        <p className="uncertainty-note">
          近い範囲＝同じ製品ID・共通業務ID・共有データ・物の受け渡しで直接つながる業務。分類・拠点・製品・視点の条件を同時に適用します。
        </p>
        <button
          onClick={() =>
            onChange({
              domain: "",
              site: "",
              product: "",
              perspective: "",
              query: "",
              range: "all",
              anchorId: "",
            })
          }
        >
          範囲をリセット
        </button>
        {filters.pinnedIds.length ? (
          <details>
            <summary>関心業務を管理する</summary>
            <div className="bird-assets">
              {filters.pinnedIds
                .filter((id) => graph.workflows.some((w) => w.id === id))
                .map((id) => (
                  <button key={id} onClick={() => toggle(id)}>
                    {name(id)}を関心から外す
                  </button>
                ))}
            </div>
          </details>
        ) : null}
      </section>
      <div className="landscape-topics" role="group" aria-label="見たい関係">
        {(
          [
            ["relations", "分類と関係"],
            ["product", "製品の視点"],
            ["common", "共通業務と工場差分"],
            ["material", "物とデータ"],
            ["data", "データ利用"],
            ["business", "目的と手順"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            aria-pressed={filters.topic === key}
            onClick={() => onChange({ topic: key })}
          >
            {label}
            {key === "material" &&
            view.materialFlows.some((h) => h.dataContinuity === "broken")
              ? " · 途切れあり"
              : ""}
          </button>
        ))}
      </div>
      {filters.topic === "relations" ? (
        <>
          <section className="landscape-lanes" aria-label="分類ごとの業務">
            <h2>分類をまたいで位置づけを見る</h2>
            {domains
              .filter((d) =>
                view.workflows.some((w) => w.landscape?.domains.includes(d)),
              )
              .concat(
                view.workflows.some((w) => !w.landscape?.domains.length)
                  ? ["分類未登録"]
                  : [],
              )
              .map((d) => (
                <article className="landscape-lane" key={d}>
                  <h3>{d}</h3>
                  <div className="landscape-node-list">
                    {view.workflows
                      .filter((w) =>
                        d === "分類未登録"
                          ? !w.landscape?.domains.length
                          : w.landscape?.domains.includes(d),
                      )
                      .map((w) => (
                        <div className="landscape-node" key={w.id}>
                          <button
                            className="landscape-name"
                            onClick={() => onOpen(w.id)}
                          >
                            {w.name} →
                          </button>
                          <p>
                            {w.landscape?.site || "拠点未登録"} ·{" "}
                            {w.landscape?.perspective || "視点未登録"} ·{" "}
                            {scenario(w.id)}
                          </p>
                          <small>
                            {w.landscape?.productId
                              ? `${w.landscape.productLabel || "製品"} · ${w.landscape.productId}`
                              : "製品未登録"}
                          </small>
                          <button
                            aria-pressed={filters.pinnedIds.includes(w.id)}
                            onClick={() => toggle(w.id)}
                          >
                            {filters.pinnedIds.includes(w.id)
                              ? "★ 関心に登録済み"
                              : "☆ 関心に登録"}
                          </button>
                        </div>
                      ))}
                  </div>
                </article>
              ))}
            {!view.workflows.length ? (
              <p>
                条件に合う業務がありません。範囲をリセットするか、注目・関心業務を選んでください。
              </p>
            ) : null}
          </section>
          <section className="landscape-relations">
            <h2>業務どうしの関係</h2>
            <p>
              同じ製品や共通業務は関連の理由です。処理の順序や受け渡しは、それぞれの記録で確認します。
            </p>
            {view.relations.length ? (
              <ul>
                {view.relations.slice(0, relationLimit).map((r) => (
                  <li key={`${r.source}/${r.target}`}>
                    <strong>
                      {name(r.source)} — {name(r.target)}
                    </strong>
                    <div className="bird-assets">
                      {r.reasons.map((reason) => (
                        <span key={reason}>{reason}</span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                {view.boundaryRelations.length
                  ? "表示中の業務どうしを結ぶ関係はありません。範囲外の関係は下で確認できます。"
                  : "この範囲で業務どうしを結ぶ関係は未登録です。製品ID・共通業務IDや利用データ、物の受け渡しを補足できます。"}
              </p>
            )}
            {view.relations.length > relationLimit ? (
              <button onClick={() => setRelationLimit((n) => n + 24)}>
                関係をさらに表示（残り{view.relations.length - relationLimit}
                件）
              </button>
            ) : null}
            {view.boundaryRelations.length ? (
              <details>
                <summary>
                  選んだ範囲の外にも {view.boundaryRelations.length}
                  件の関係があります
                </summary>
                <ul>
                  {view.boundaryRelations.slice(0, relationLimit).map((r) => (
                    <li key={`${r.source}/${r.target}`}>
                      {name(r.source)} — {name(r.target)}
                      <p>{r.reasons.join(" / ")}</p>
                      <button
                        onClick={() =>
                          onChange({
                            domain: "",
                            site: "",
                            product: "",
                            perspective: "",
                            query: "",
                            range: "nearby",
                            anchorId: view.visible.has(r.source)
                              ? r.source
                              : r.target,
                          })
                        }
                      >
                        この関係を含めて見る
                      </button>
                    </li>
                  ))}
                </ul>
                {view.boundaryRelations.length > relationLimit ? (
                  <button onClick={() => setRelationLimit((n) => n + 24)}>
                    範囲外の関係をさらに表示（残り
                    {view.boundaryRelations.length - relationLimit}件）
                  </button>
                ) : null}
              </details>
            ) : null}
          </section>
        </>
      ) : null}
      {filters.topic === "product" && productIds.length ? (
        <section className="landscape-products">
          <h2>同じ製品を違う視点で見る</h2>
          {productIds.map((id) => (
            <article key={id}>
              <h3>製品 {id}</h3>
              <div className="landscape-node-list">
                {view.workflows
                  .filter((w) => w.landscape?.productId === id)
                  .map((w) => (
                    <div className="landscape-node" key={w.id}>
                      <strong>
                        {w.landscape?.perspective || "視点未登録"} ·{" "}
                        {scenario(w.id)}
                      </strong>
                      <p>
                        {w.landscape?.productLabel || id} ·{" "}
                        {w.landscape?.site || "拠点未登録"} · {scenario(w.id)}
                      </p>
                      <button onClick={() => onOpen(w.id)}>{w.name} →</button>
                      <small>根拠：{w.landscape?.evidence || "未登録"}</small>
                    </div>
                  ))}
              </div>
            </article>
          ))}
        </section>
      ) : null}
      {filters.topic === "product" && !productIds.length ? (
        <p>
          この範囲の製品IDは未登録です。製品IDと視点を登録すると並べて見られます。
        </p>
      ) : null}
      {filters.topic === "common" && commonIds.length ? (
        <section className="landscape-variants">
          <h2>共通業務と工場ごとの実施方法</h2>
          {commonIds.map((id) => (
            <article key={id}>
              <h3>共通業務 {id}</h3>
              <div className="overview-table-scroll">
                <table className="overview-table">
                  <thead>
                    <tr>
                      <th>業務・位置づけ</th>
                      <th>工場・拠点</th>
                      <th>実施方法・差分</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.workflows
                      .filter((w) => w.landscape?.commonProcessId === id)
                      .map((w) => (
                        <tr key={w.id}>
                          <th>
                            <button onClick={() => onOpen(w.id)}>
                              {w.name}
                            </button>
                            <small>
                              {w.landscape?.processRole === "common"
                                ? "共通の業務定義"
                                : w.landscape?.processRole === "site"
                                  ? "拠点での実施"
                                  : "個別業務"}
                            </small>
                          </th>
                          <td>
                            {w.landscape?.site || "拠点未登録"} ·{" "}
                            {scenario(w.id)}
                          </td>
                          <td>
                            {w.landscape?.variantNote ||
                              "実施方法・差分は未登録"}
                            <small>
                              根拠：{w.landscape?.evidence || "未登録"}
                            </small>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </section>
      ) : null}
      {filters.topic === "common" && !commonIds.length ? (
        <p>
          共通業務IDを登録すると、共通の定義と工場別の実施方法を比較できます。
        </p>
      ) : null}
      {filters.topic === "material" ? (
        <section className="material-map">
          <h2>物の流れとデータの対応</h2>
          <p>
            物の移動を先に登録できます。データが未登録でも「未確認」として見えます。
          </p>
          {view.materialFlows.length ? (
            view.materialFlows.map((h) => (
              <article
                className={`material-route material-route-${h.dataContinuity}`}
                key={`${h.sourceWorkflowId}/${h.id}`}
              >
                <div className="material-journey">
                  <span>
                    {name(h.sourceWorkflowId)}
                    <small>
                      {site(h.sourceWorkflowId)} ·{" "}
                      {scenario(h.sourceWorkflowId)}
                      {h.sourceLocation ? ` / ${h.sourceLocation}` : ""}
                    </small>
                  </span>
                  <strong>→ {h.material} →</strong>
                  <span>
                    {name(h.targetWorkflowId)}
                    <small>
                      {site(h.targetWorkflowId)} ·{" "}
                      {scenario(h.targetWorkflowId)}
                      {h.targetLocation ? ` / ${h.targetLocation}` : ""}
                    </small>
                  </span>
                </div>
                <p>
                  {h.productId ? `製品 ${h.productId}` : "製品ID未登録"} ·{" "}
                  {h.traceKey || "ロット・追跡キー未登録"}
                </p>
                <strong>
                  {h.dataContinuity === "linked"
                    ? "物とデータの対応を確認済み"
                    : h.dataContinuity === "broken"
                      ? "物は流れるが、データ対応に途切れあり"
                      : "物とデータの対応は未確認"}
                </strong>
                <p>
                  対応データ：
                  {h.dataIds
                    .map(
                      (id) =>
                        graph.nodes.find((n) => n.id === id)?.label ||
                        "データ参照未確認",
                    )
                    .join(" / ") || "未登録"}
                </p>
                <p>根拠：{h.evidence || "未登録"}</p>
                {!view.visible.has(h.sourceWorkflowId) ||
                !view.visible.has(h.targetWorkflowId) ? (
                  <small>受け渡しの片側は現在の表示範囲外です。</small>
                ) : null}
              </article>
            ))
          ) : (
            <p>
              この範囲の物の受け渡しは未登録です。下の登録欄から追加できます。
            </p>
          )}
        </section>
      ) : null}
    </>
  );
}
