"use client";

import { useMemo, useState } from "react";
import type { LensGraph, LensNode } from "@/lib/graph";
import {
  compareWorkflow,
  knowledgeIndex,
  knowledgeReport,
  type KnowledgeScope,
} from "@/lib/knowledge";
import { WorkflowReading } from "./WorkflowReading";
import { CompanyOrientation } from "./CompanyOrientation";
import { termExplanation } from "@/lib/knowledge-guide";
import { KnowledgeEditor } from "./KnowledgeEditor";
import { createChemicalCompany } from "@/lib/chemical-company";

type Focus =
  | { kind: "company" | "systems" }
  | {
      kind: "activity" | "capability" | "workflow" | "process" | "asset";
      id: string;
    };
const mode = {
  manual: "人による作業",
  automatic: "システム自動処理",
  mixed: "人＋自動処理",
  unknown: "実行方法未確認",
};

export function KnowledgeExplorer({
  projectId,
  graph,
  onGraphApply,
  onOpenWorkflow,
}: {
  projectId: string;
  graph: LensGraph;
  onGraphApply: (g: LensGraph) => void;
  onOpenWorkflow: (id: string) => void;
}) {
  const [report, setReport] = useState<{ text: string; url: string } | null>(
    null,
  );
  const [focus, setFocus] = useState<Focus>({ kind: "company" });
  const [history, setHistory] = useState<
    Array<{
      focus: Focus;
      scope: KnowledgeScope;
      query: string;
      department: string;
      category: string;
    }>
  >([]);
  const [scope, setScope] = useState<KnowledgeScope>("current");
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(0);
  const [readStepId, setReadStep] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [dependencyId, setDependencyId] = useState("");
  const [dependencyReason, setDependencyReason] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const view = useMemo(
    () => knowledgeIndex(graph, scope, query, department),
    [graph, scope, query, department],
  );
  const go = (next: Focus) => {
    setHistory((h) => [...h, { focus, scope, query, department, category }]);
    setFocus(next);
    setPage(0);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const row =
    focus.kind === "workflow"
      ? view.rows.find((r) => r.workflow.id === focus.id)
      : undefined;
  const asset =
    focus.kind === "asset" || focus.kind === "process"
      ? view.nodeById.get(focus.id)
      : undefined;
  const activity =
    focus.kind === "activity"
      ? view.activities.find((a) => a.id === focus.id)
      : undefined;
  const cap =
    focus.kind === "capability"
      ? view.activities
          .flatMap((a) => a.capabilities)
          .find((c) => c.id === focus.id)
      : undefined;
  const impact =
    focus.kind === "asset" ? view.systemProfile(focus.id) : undefined;
  const label = (id: string) => view.nodeById.get(id)?.label ?? id;
  const assetButton = (n: LensNode) => (
    <button
      className={`kg-chip kg-chip--${n.kind}`}
      key={n.id}
      title={
        termExplanation(n.label) ??
        (n.kind === "system"
          ? "この道具が支える仕事を見る"
          : "この情報を使う仕事を見る")
      }
      onClick={() => go({ kind: "asset", id: n.id })}
    >
      {n.label}
    </button>
  );
  const workflowButton = (id: string) => (
    <button key={id} onClick={() => go({ kind: "workflow", id })}>
      {graph.workflows.find((w) => w.id === id)?.name ?? id}
    </button>
  );
  const download = () => {
    const content = knowledgeReport(
      graph,
      scope,
      query,
      department,
      selectedRows.map((r) => r.workflow.id),
      focus.kind === "asset" ? focus.id : undefined,
    );
    const params = new URLSearchParams({
      projectId,
      scope,
      query,
      department,
      workflows: selectedRows.map((r) => r.workflow.id).join(","),
    });
    if (focus.kind === "asset") params.set("assetId", focus.id);
    setReport({ text: content, url: `/api/report?${params.toString()}` });
  };
  const loadExample = async () => {
    setError("");
    try {
      // Separate project snapshot prevents the example from replacing the user's working graph.
      const response = await fetch("/api/project?projectId=chemical-demo");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      if (!payload.project) {
        const result = await fetch("/api/project", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: "chemical-demo",
            projectName: "青葉ケミカル（検証用）",
            graph: createChemicalCompany(),
            transcripts: {},
          }),
        });
        if (!result.ok)
          throw new Error("化学メーカーのサンプルを保存できませんでした");
      }
      window.location.assign("/?projectId=chemical-demo");
    } catch (e) {
      setError(e instanceof Error ? e.message : "サンプル読込に失敗しました");
      setImporting(false);
    }
  };
  const systems = graph.nodes
    .filter((n) => n.kind === "system")
    .filter(
      (n) =>
        (!category ||
          graph.knowledge?.systems.find((s) => s.systemId === n.id)
            ?.categoryId === category) &&
        (!query ||
          `${n.label} ${n.description} ${(n.aliases ?? []).join(" ")}`
            .toLowerCase()
            .includes(query.toLowerCase()) ||
          view.systemProfile(n.id).direct.length),
    )
    .filter(
      (n) =>
        !department ||
        view.systemProfile(n.id).direct.length ||
        view.systemProfile(n.id).indirect.length,
    );
  const processRow =
    focus.kind === "process"
      ? view.rows.find((r) => r.workflow.id === asset?.workflowId)
      : undefined;
  const selectedRows =
    focus.kind === "workflow"
      ? row
        ? [row]
        : []
      : focus.kind === "process"
        ? processRow
          ? [processRow]
          : []
        : focus.kind === "systems" && category
          ? view.rows.filter((r) =>
              systems.some((n) => {
                const p = view.systemProfile(n.id);
                return p.direct.includes(r) || p.indirect.includes(r);
              }),
            )
          : (activity?.rows ?? cap?.rows ?? impact?.direct ?? view.rows);
  const list = (rows: typeof view.rows) => (
    <>
      <p>
        {rows.length}業務 /{" "}
        {rows.length
          ? `${page * 20 + 1}–${Math.min(rows.length, (page + 1) * 20)}`
          : "0"}
        を表示
      </p>
      <div className="kg-workflows">
        {rows.slice(page * 20, (page + 1) * 20).map((r) => (
          <article key={r.workflow.id}>
            {workflowButton(r.workflow.id)}
            <p>{r.workflow.description}</p>
            <span>
              {r.departments.join(" / ")} · {r.processes.length}工程 ·{" "}
              {r.assets.filter((n) => n.kind === "system").length} System
            </span>
            {graph.knowledge?.criticalWorkflows.some(
              (w) => w.workflowId === r.workflow.id,
            ) && <strong className="kg-important">重要業務</strong>}
          </article>
        ))}
      </div>
      <div className="kg-toolbar">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          前の20件
        </button>
        <button
          disabled={(page + 1) * 20 >= rows.length}
          onClick={() => setPage((p) => p + 1)}
        >
          次の20件
        </button>
      </div>
    </>
  );
  return (
    <section className="page-view kg-view">
      <div className="eyebrow">会社のしくみを知る</div>
      <h1>{graph.knowledge?.name ?? "会社がどう動いているかを探索する"}</h1>
      <p>
        {graph.knowledge?.description ??
          "会社の活動から業務を読み、System・Dataから支えている活動へ戻れます。未分類の業務も下の一覧から探索できます。"}
      </p>
      {focus.kind === "company" && (
        <CompanyOrientation
          graph={graph}
          workflowIds={view.rows.map((r) => r.workflow.id)}
          onWorkflow={(id) => go({ kind: "workflow", id })}
          onSystems={() => go({ kind: "systems" })}
          onActivity={(id) => go({ kind: "activity", id })}
        />
      )}
      <div className="kg-toolbar">
        <button
          onClick={() => {
            go({ kind: "company" });
            setQuery("");
            setDepartment("");
            setCategory("");
          }}
        >
          会社全体
        </button>
        <button onClick={() => go({ kind: "systems" })}>
          システム・道具の全体像
        </button>
        <button
          disabled={!history.length}
          onClick={() => {
            const previous = history.at(-1)!;
            setFocus(previous.focus);
            setScope(previous.scope);
            setQuery(previous.query);
            setDepartment(previous.department);
            setCategory(previous.category);
            setHistory((h) => h.slice(0, -1));
            setPage(0);
            window.scrollTo({ top: 0, behavior: "instant" });
          }}
        >
          ひとつ戻る
        </button>
        <button onClick={download}>この範囲をレポート出力</button>
      </div>
      <details className="kg-secondary">
        <summary>サンプル・プロジェクトの切替</summary>
        <div className="kg-toolbar">
          <button
            disabled={importing}
            onClick={() => {
              setImporting(true);
              void loadExample();
            }}
          >
            架空の化学メーカー300業務を開く
          </button>
          <a href="/?projectId=default">自分のプロジェクトへ</a>
        </div>
      </details>
      {error && <p role="alert">{error}</p>}
      {report && (
        <section aria-label="レポートプレビュー">
          <h2>レポートプレビュー</h2>
          <p>
            出力時点の条件・業務・依存関係を確認できます。ファイルは保存済みプロジェクトから生成します。
          </p>
          <div className="kg-toolbar">
            <a href={report.url} download>
              Markdownファイルをダウンロード
            </a>
            <button onClick={() => setReport(null)}>プレビューを閉じる</button>
          </div>
          <textarea
            aria-label="レポート本文"
            readOnly
            value={report.text}
            style={{ width: "100%", height: 300 }}
          />
        </section>
      )}

      <div className="kg-toolbar">
        <label>
          表示する状態
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as KnowledgeScope);
              setFocus({ kind: "company" });
              setHistory([]);
              setPage(0);
            }}
          >
            <option value="current">現在の仕事（Current）</option>
            <option value="future">改善後の案（Future）</option>
            <option value="alternative">別の案（Alternative）</option>
          </select>
        </label>
        <label>
          部署
          <select
            value={department}
            onChange={(e) => {
              setDepartment(e.target.value);
              setPage(0);
            }}
          >
            <option value="">すべての部署</option>
            {view.departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          会社内を検索
          <input
            value={query}
            placeholder="業務名・部署・システム・情報・工場"
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <span>
          検索対象：{view.rows.length}業務 ·{" "}
          {view.rows.reduce((s, r) => s + r.processes.length, 0)}工程
        </span>
      </div>
      {(query || department) && (
        <button
          onClick={() => {
            setQuery("");
            setDepartment("");
            setPage(0);
          }}
        >
          検索・部署の条件をクリア
        </button>
      )}
      <p className="kg-trail" aria-label="現在の探索位置">
        会社全体
        {activity
          ? ` → ${activity.name}`
          : cap
            ? ` → ${view.activities.find((a) => a.capabilities.some((c) => c.id === cap.id))?.name} → ${cap.name}`
            : row
              ? ` → ${row.capabilities.map((c) => `${c.activity.name} → ${c.capability.name}`).join(" / ")} → ${row.workflow.name}`
              : asset
                ? ` → ${asset.kind === "process" ? "ひとつの手順" : asset.kind === "system" ? "システム・道具" : "業務で使う情報"} → ${asset.label}`
                : focus.kind === "systems"
                  ? " → システム・道具の全体像"
                  : ""}
      </p>
      {(row || processRow || cap || activity) && (
        <nav className="kg-toolbar" aria-label="大きな視点へ戻る">
          {(row ?? processRow)?.capabilities.slice(0, 1).map((c) => (
            <span key={c.capability.id}>
              <button
                onClick={() => go({ kind: "activity", id: c.activity.id })}
              >
                ↑ 活動全体：{c.activity.name}
              </button>{" "}
              <button
                onClick={() => go({ kind: "capability", id: c.capability.id })}
              >
                ↑ 仕事の種類：{c.capability.name}
              </button>
            </span>
          ))}
          {processRow && (
            <button
              onClick={() =>
                go({ kind: "workflow", id: processRow.workflow.id })
              }
            >
              ↑ 業務の流れに戻る
            </button>
          )}
        </nav>
      )}
      {focus.kind === "company" && (
        <>
          <h2>会社の活動</h2>
          <p>
            「何のために働くか」でまとめた、大きな仕事です。気になる活動を選んでください。
          </p>
          <div className="kg-cards">
            {view.activities
              .filter((a) => a.rows.length)
              .map((a) => (
                <button
                  key={a.id}
                  onClick={() => go({ kind: "activity", id: a.id })}
                >
                  <strong>{a.name}</strong>
                  <p>{a.description}</p>
                  <span>
                    {a.capabilities.filter((c) => c.rows.length).length}{" "}
                    種類の仕事 · {a.rows.length}業務
                  </span>
                  <p>
                    {[...new Set(a.rows.flatMap((r) => r.departments))].join(
                      " / ",
                    )}
                  </p>
                </button>
              ))}
          </div>
          <h2>
            {graph.knowledge
              ? "対象範囲の業務"
              : "登録済み業務（活動の分類は未登録）"}
          </h2>
          <details>
            <summary>業務の一覧を直接見る（{view.rows.length}件）</summary>
            {list(view.rows)}
          </details>
          <KnowledgeEditor graph={graph} onApply={onGraphApply} />
        </>
      )}
      {activity && (
        <>
          <h2>{activity.name}</h2>
          <p>{activity.description}</p>
          <p className="kg-context">
            ここでは、この活動に必要な「仕事の種類」を選びます。たとえば受注登録は仕事の種類で、工場ごとに担当部署や手順が違います。
          </p>
          <h3>どの仕事を知りたいですか？</h3>
          <div className="kg-cards">
            {activity.capabilities
              .filter((c) => c.rows.length)
              .map((c) => (
                <button
                  key={c.id}
                  onClick={() => go({ kind: "capability", id: c.id })}
                >
                  <strong>{c.name}</strong>
                  <p>{c.description}</p>
                  {c.rows.length}業務
                </button>
              ))}
          </div>
          <h3>この活動を支えるSystem</h3>
          {[
            ...new Map(
              activity.rows
                .flatMap((r) => r.assets.filter((n) => n.kind === "system"))
                .map((n) => [n.id, n]),
            ).values(),
          ].map(assetButton)}
          <h3>関係部署</h3>
          <p>
            {[...new Set(activity.rows.flatMap((r) => r.departments))].join(
              " / ",
            )}
          </p>
          {list(activity.rows)}
        </>
      )}
      {cap && (
        <>
          <h2>{cap.name}</h2>
          <p>{cap.description}</p>
          <p className="kg-context">
            同じ仕事でも、部署・工場・製品ごとに行い方が違います。ひとつ選ぶと、開始から完了までの手順がわかります。
          </p>
          {list(cap.rows)}
        </>
      )}
      {row && (
        <>
          <h2>{row.workflow.name}</h2>
          <p className="kg-context">
            ひとつの業務を、上から順番に読んでください。手順を押すと判断や個別作業が、青いラベルを押すとシステムの役割が、緑のラベルを押すと情報の使われ方がわかります。
          </p>
          <p>{row.workflow.description}</p>
          <p>
            起点: {row.workflow.trigger ?? "未登録"} → 成果:{" "}
            {row.workflow.outcome ?? "未登録"}
          </p>
          <p>
            重要性:{" "}
            {graph.knowledge?.criticalWorkflows.find(
              (w) => w.workflowId === row.workflow.id,
            )?.reason ?? "未評価"}
          </p>
          <div className="kg-toolbar">
            <button onClick={() => onOpenWorkflow(row.workflow.id)}>
              業務フロー図・詳細編集を開く
            </button>
            {row.capabilities.map((c) => (
              <button
                key={c.capability.id}
                onClick={() => go({ kind: "activity", id: c.activity.id })}
              >
                {c.activity.name}へ戻る
              </button>
            ))}
          </div>
          <details>
            <summary>この業務で使うシステム・情報をまとめて見る</summary>
            <h3>システム・道具</h3>
            {row.assets.filter((n) => n.kind === "system").map(assetButton)}
            <h3>記録・ファイルなどの情報</h3>
            {row.assets.filter((n) => n.kind === "data").map(assetButton)}
          </details>
          <h3>業務の流れ</h3>
          <WorkflowReading
            key={row.workflow.id}
            graph={graph}
            workflowId={row.workflow.id}
            initialStepId={readStepId}
            onDetail={(id) => {
              setReadStep(id);
              go({ kind: "process", id });
            }}
            onAsset={(n, stepId) => {
              setReadStep(stepId);
              go({ kind: "asset", id: n.id });
            }}
          />
          <h3>前後の業務・活動</h3>
          <div className="kg-links">
            {(graph.knowledge?.handoffs ?? [])
              .filter(
                (h) =>
                  h.sourceWorkflowId === row.workflow.id ||
                  h.targetWorkflowId === row.workflow.id,
              )
              .map((h) => {
                const target =
                  h.sourceWorkflowId === row.workflow.id
                    ? h.targetWorkflowId
                    : h.sourceWorkflowId;
                return (
                  <article key={h.id}>
                    {h.sourceWorkflowId === row.workflow.id ? "次へ" : "前へ"} (
                    {h.kind === "information" ? "情報受渡し" : "物の受渡し"}):{" "}
                    {workflowButton(target)}
                    <p>{h.description}</p>
                    {h.dataIds
                      .map((id) => view.nodeById.get(id))
                      .filter((n): n is LensNode => !!n)
                      .map(assetButton)}
                    <p>{h.evidence}</p>
                  </article>
                );
              })}
          </div>
          <details>
            <summary>改善すると何が変わるか（現状と将来案）</summary>
            {compareWorkflow(graph, row.workflow.id).length ? (
              compareWorkflow(graph, row.workflow.id).map((c) => (
                <article key={c.workflow.id}>
                  <button
                    onClick={() => {
                      setScope(c.workflow.scenario ?? "current");
                      setQuery("");
                      setDepartment("");
                      go({ kind: "workflow", id: c.workflow.id });
                    }}
                  >
                    {c.workflow.name}
                  </button>
                  <p>
                    有効日: {c.workflow.effectiveFrom ?? "未定"} · 手動受渡し{" "}
                    {c.beforeManual} → {c.afterManual}
                  </p>
                  <p>
                    削除される工程:{" "}
                    {c.removed.map((n) => n.label).join(" / ") || "なし"}
                  </p>
                  <p>
                    追加される工程:{" "}
                    {c.added.map((n) => n.label).join(" / ") || "なし"}
                  </p>
                  <p>
                    System: {c.beforeSystems.map((n) => n.label).join(" / ")} →{" "}
                    {c.afterSystems.map((n) => n.label).join(" / ")}
                  </p>
                </article>
              ))
            ) : (
              <p>比較できる同一業務の別シナリオは未登録です。</p>
            )}
          </details>
        </>
      )}
      {focus.kind === "workflow" && !row && (
        <p role="status">
          この業務は現在のシナリオ・検索・部署の対象外です。条件を戻すと表示できます。
        </p>
      )}
      {focus.kind === "process" && asset && processRow && (
        <>
          <h2>{asset.label}</h2>
          {termExplanation(asset.label) && (
            <p className="kg-term">{termExplanation(asset.label)}</p>
          )}
          <p>{asset.action ?? asset.description}</p>
          <p>
            {mode[asset.executionMode ?? "unknown"]} · 管理部署:{" "}
            {asset.department ?? "未登録"}
          </p>
          <div className="kg-toolbar">
            {asset.workflowId && workflowButton(asset.workflowId)}
          </div>
          <h3>使う道具と、受け取る・作る情報</h3>
          {view.assetsFor([asset]).map(assetButton)}
          <p>
            自動処理を行うシステム:{" "}
            {graph.edges
              .filter((e) => e.relation === "executes" && e.target === asset.id)
              .map((e) => label(e.source))
              .join(" / ") || "人による実行 / 未登録"}
          </p>
          <p>
            入力:{" "}
            {graph.edges
              .filter(
                (e) =>
                  (e.source === asset.id || e.target === asset.id) &&
                  e.relation === "reads",
              )
              .map((e) => label(e.source === asset.id ? e.target : e.source))
              .join(" / ") || "未登録"}
          </p>
          <p>
            出力:{" "}
            {graph.edges
              .filter(
                (e) =>
                  (e.source === asset.id || e.target === asset.id) &&
                  ["writes", "sends"].includes(e.relation),
              )
              .map((e) => label(e.source === asset.id ? e.target : e.source))
              .join(" / ") || "未登録"}
          </p>
          <h3>いつ始まり、何を判断するか</h3>
          <p>始まるきっかけ: {asset.executionContext?.trigger ?? "未登録"}</p>
          <p>確認・判断すること: {asset.executionContext?.rule ?? "未登録"}</p>
          <p>
            うまく進まないときの対応:{" "}
            {asset.executionContext?.exception ?? "未登録"}
          </p>
          <details>
            <summary>起点・ルール・例外を編集</summary>
            {(["trigger", "rule", "exception"] as const).map((key, i) => (
              <label className="kg-edit-field" key={key}>
                {["起点", "ルール / 判断", "失敗 / 例外"][i]}
                <textarea
                  value={asset.executionContext?.[key] ?? ""}
                  onChange={(e) =>
                    onGraphApply({
                      ...graph,
                      nodes: graph.nodes.map((n) =>
                        n.id === asset.id
                          ? {
                              ...n,
                              executionContext: {
                                trigger: "",
                                rule: "",
                                exception: "",
                                ...n.executionContext,
                                [key]: e.target.value,
                              },
                            }
                          : n,
                      ),
                    })
                  }
                />
              </label>
            ))}
          </details>
          <h3>具体的に行うこと（個別作業）</h3>
          <ol>
            {(asset.detailSteps ?? []).map((t) => (
              <li key={t.id}>
                {t.action}
                {t.condition && ` / 条件: ${t.condition}`}
              </li>
            ))}
          </ol>
          <p>根拠: {asset.evidence ?? "未登録"}</p>
        </>
      )}
      {focus.kind === "process" && !processRow && (
        <p role="status">
          この工程は現在の条件の対象外です。条件をクリアするか、ひとつ戻ると探索を続けられます。
        </p>
      )}
      {focus.kind === "systems" && (
        <>
          <h2>会社を支えるシステム・道具</h2>
          <p>
            業務システムだけでなく、Teams・Excel・認証・ネットワークも会社を動かす道具です。ひとつ選ぶと、誰がどの仕事で使い、何と情報をやり取りしているかがわかります。
          </p>
          <label>
            道具の種類
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(0);
              }}
            >
              <option value="">すべて</option>
              {graph.knowledge?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="kg-cards">
            {systems.map((n) => {
              const profile = graph.knowledge?.systems.find(
                (s) => s.systemId === n.id,
              );
              const related = view.systemProfile(n.id);
              return (
                <button
                  key={n.id}
                  onClick={() => go({ kind: "asset", id: n.id })}
                >
                  <strong>{n.label}</strong>
                  <p>{profile?.purpose ?? n.description}</p>
                  <span>
                    {graph.knowledge?.categories.find(
                      (c) => c.id === profile?.categoryId,
                    )?.name ?? "分類未登録"}{" "}
                    · 直接 {related.direct.length}業務 · 間接{" "}
                    {related.indirect.length}業務
                  </span>
                </button>
              );
            })}
          </div>
          {graph.knowledge && (
            <details>
              <summary>System分類を追加・変更する</summary>
              {graph.knowledge.categories.map((c) => (
                <label className="kg-edit-field" key={c.id}>
                  分類名
                  <input
                    aria-label={`分類名 ${c.name}`}
                    value={c.name}
                    onChange={(e) =>
                      onGraphApply({
                        ...graph,
                        knowledge: {
                          ...graph.knowledge!,
                          categories: graph.knowledge!.categories.map((n) =>
                            n.id === c.id ? { ...n, name: e.target.value } : n,
                          ),
                        },
                      })
                    }
                  />
                </label>
              ))}
              <label>
                新しい分類
                <input
                  value={categoryName}
                  onChange={(e) => setCategoryName(e.target.value)}
                />
              </label>
              <button
                disabled={!categoryName.trim()}
                onClick={() => {
                  onGraphApply({
                    ...graph,
                    knowledge: {
                      ...graph.knowledge!,
                      categories: [
                        ...graph.knowledge!.categories,
                        {
                          id: `category:${crypto.randomUUID()}`,
                          name: categoryName.trim(),
                          description: "",
                        },
                      ],
                    },
                  });
                  setCategoryName("");
                }}
              >
                分類を追加
              </button>
            </details>
          )}
        </>
      )}
      {focus.kind === "asset" && asset && impact && (
        <>
          <h2>{asset.label}</h2>
          {termExplanation(asset.label) && (
            <p className="kg-term">{termExplanation(asset.label)}</p>
          )}
          <p>{impact.profile?.purpose ?? asset.description}</p>
          <p>管理部署: {impact.profile?.owner ?? "未登録"}</p>
          <p className="kg-context">
            {asset.kind === "data"
              ? "これは業務で受け取り、参照・更新する情報です。下で、その情報を使う仕事と、受渡し先を確かめられます。"
              : "直接は、その道具を使う業務。間接は、その道具に頼る別のシステムを通じて支えられる業務です。件数は登録された関係の範囲です。"}
          </p>
          {asset.kind === "system" && graph.knowledge && (
            <label>
              分類
              <select
                value={impact.profile?.categoryId ?? ""}
                onChange={(e) =>
                  onGraphApply({
                    ...graph,
                    knowledge: {
                      ...graph.knowledge!,
                      systems: [
                        ...graph.knowledge!.systems.filter(
                          (s) => s.systemId !== asset.id,
                        ),
                        {
                          systemId: asset.id,
                          categoryId: e.target.value,
                          owner: impact.profile?.owner ?? "",
                          purpose: impact.profile?.purpose ?? asset.description,
                          dependsOn: impact.profile?.dependsOn ?? [],
                        },
                      ],
                    },
                  })
                }
              >
                <option value="">未分類</option>
                {graph.knowledge.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <h3>会社のどの活動を支えているか</h3>
          <div className="kg-toolbar">
            {view.activities
              .filter((a) =>
                a.rows.some(
                  (r) =>
                    impact.direct.includes(r) || impact.indirect.includes(r),
                ),
              )
              .map((a) => (
                <button
                  key={a.id}
                  onClick={() => go({ kind: "activity", id: a.id })}
                >
                  {a.name} · 直接
                  {a.rows.filter((r) => impact.direct.includes(r)).length}業務 /
                  間接{a.rows.filter((r) => impact.indirect.includes(r)).length}
                  業務
                </button>
              ))}
          </div>
          <p>
            {[
              ...new Set(
                [...impact.direct, ...impact.indirect].flatMap((r) =>
                  r.capabilities.map((c) => c.capability.name),
                ),
              ),
            ].join(" / ")}
          </p>
          <h3>使用部署</h3>
          <p>
            {[
              ...new Set(
                [...impact.direct, ...impact.indirect].flatMap(
                  (r) => r.departments,
                ),
              ),
            ].join(" / ") || "登録なし"}
          </p>
          <h3>自動処理・個別工程（{impact.processes.length}）</h3>
          <div className="kg-links">
            {impact.processes.slice(0, 30).map((p) => (
              <button
                key={p.id}
                onClick={() => go({ kind: "process", id: p.id })}
              >
                {p.label} · {mode[p.executionMode ?? "unknown"]} ·{" "}
                {graph.workflows.find((w) => w.id === p.workflowId)?.name}
              </button>
            ))}
          </div>
          {impact.processes.length > 30 && (
            <p>
              先頭30工程を表示。部署・検索で絞るか、関連業務からすべての工程を読めます。
            </p>
          )}
          <h3>
            情報はどこから来て、どこへ渡るか（
            {impact.flows.length}）
          </h3>
          <div className="kg-links">
            {impact.flows.slice(0, 30).map((f) => (
              <article key={f.id}>
                <div>
                  {view.nodeById.get(f.sourceSystemId) &&
                    assetButton(view.nodeById.get(f.sourceSystemId)!)}
                  <span aria-label="受渡しの方向"> → </span>
                  {view.nodeById.get(f.targetSystemId) &&
                    assetButton(view.nodeById.get(f.targetSystemId)!)}
                  <span>
                    {" "}
                    ·{" "}
                    {(
                      {
                        manual: "人が転記・受渡し",
                        email: "メール",
                        api: "システム間連携",
                        file: "ファイル",
                      } as Record<string, string>
                    )[f.transferType] ?? f.transferType}{" "}
                    / {mode[f.automation]}
                  </span>
                </div>
                <div>
                  {f.dataIds
                    .map((id) => view.nodeById.get(id)!)
                    .filter(Boolean)
                    .map(assetButton)}
                </div>
                <p>{f.evidence}</p>
                {f.workflowIds
                  .filter((id) => view.rows.some((r) => r.workflow.id === id))
                  .slice(0, 3)
                  .map(workflowButton)}
                {f.workflowIds.filter((id) =>
                  view.rows.some((r) => r.workflow.id === id),
                ).length > 3 && (
                  <p>ほかの関連業務は下の一覧・レポートで確認できます。</p>
                )}
              </article>
            ))}
          </div>
          {impact.flows.length > 30 && (
            <p>
              先頭30受渡しを表示。レポートにはこの条件の全受渡しを出力します。
            </p>
          )}
          <h3>動くために必要な仕組み</h3>
          {impact.profile?.dependsOn.length ? (
            impact.profile.dependsOn.map((d) => (
              <p key={d.systemId}>
                <button onClick={() => go({ kind: "asset", id: d.systemId })}>
                  {label(d.systemId)}
                </button>{" "}
                · {d.reason}
              </p>
            ))
          ) : (
            <p>未登録</p>
          )}
          {asset.kind === "system" && graph.knowledge && (
            <details>
              <summary>Systemの役割・管理部署・基盤依存を編集</summary>
              {(["purpose", "owner"] as const).map((key, i) => (
                <label className="kg-edit-field" key={key}>
                  {["会社での役割", "管理部署"][i]}
                  <input
                    value={impact.profile?.[key] ?? ""}
                    onChange={(e) =>
                      onGraphApply({
                        ...graph,
                        knowledge: {
                          ...graph.knowledge!,
                          systems: [
                            ...graph.knowledge!.systems.filter(
                              (s) => s.systemId !== asset.id,
                            ),
                            {
                              systemId: asset.id,
                              categoryId: impact.profile?.categoryId ?? "",
                              owner: impact.profile?.owner ?? "",
                              purpose:
                                impact.profile?.purpose ?? asset.description,
                              dependsOn: impact.profile?.dependsOn ?? [],
                              [key]: e.target.value,
                            },
                          ],
                        },
                      })
                    }
                  />
                </label>
              ))}
              <label className="kg-edit-field">
                依存先System
                <select
                  value={dependencyId}
                  onChange={(e) => setDependencyId(e.target.value)}
                >
                  <option value="">選択してください</option>
                  {graph.nodes
                    .filter((n) => n.kind === "system" && n.id !== asset.id)
                    .map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.label}
                      </option>
                    ))}
                </select>
              </label>
              <label className="kg-edit-field">
                依存の理由
                <input
                  value={dependencyReason}
                  onChange={(e) => setDependencyReason(e.target.value)}
                />
              </label>
              <button
                disabled={!dependencyId || !dependencyReason.trim()}
                onClick={() => {
                  onGraphApply({
                    ...graph,
                    knowledge: {
                      ...graph.knowledge!,
                      systems: [
                        ...graph.knowledge!.systems.filter(
                          (s) => s.systemId !== asset.id,
                        ),
                        {
                          systemId: asset.id,
                          categoryId: impact.profile?.categoryId ?? "",
                          owner: impact.profile?.owner ?? "",
                          purpose: impact.profile?.purpose ?? asset.description,
                          dependsOn: [
                            ...(impact.profile?.dependsOn ?? []).filter(
                              (d) => d.systemId !== dependencyId,
                            ),
                            {
                              systemId: dependencyId,
                              reason: dependencyReason.trim(),
                            },
                          ],
                        },
                      ],
                    },
                  });
                  setDependencyId("");
                  setDependencyReason("");
                }}
              >
                依存関係を登録
              </button>
              {(impact.profile?.dependsOn ?? []).map((d) => (
                <p key={d.systemId}>
                  {label(d.systemId)}: {d.reason}{" "}
                  <button
                    onClick={() =>
                      onGraphApply({
                        ...graph,
                        knowledge: {
                          ...graph.knowledge!,
                          systems: graph.knowledge!.systems.map((s) =>
                            s.systemId === asset.id
                              ? {
                                  ...s,
                                  dependsOn: s.dependsOn.filter(
                                    (n) => n.systemId !== d.systemId,
                                  ),
                                }
                              : s,
                          ),
                        },
                      })
                    }
                  >
                    依存を解除
                  </button>
                </p>
              ))}
            </details>
          )}
          <h3>この仕組みを必要とするシステム</h3>
          {impact.dependents.map(assetButton)}
          <p>
            間接影響: {impact.indirect.length}
            業務。Systemの明示的な依存を辿った範囲です。
          </p>
          {impact.indirect.length > 0 && (
            <details>
              <summary>間接影響の業務を確認</summary>
              <div className="kg-links">
                {impact.indirect.map((r) => workflowButton(r.workflow.id))}
              </div>
            </details>
          )}
          <h3>依存する重要業務</h3>
          <div className="kg-links">
            {[...impact.direct, ...impact.indirect]
              .filter((r) =>
                graph.knowledge?.criticalWorkflows.some(
                  (w) => w.workflowId === r.workflow.id,
                ),
              )
              .map((r) => (
                <article key={r.workflow.id}>
                  {workflowButton(r.workflow.id)}
                  <p>
                    {
                      graph.knowledge?.criticalWorkflows.find(
                        (w) => w.workflowId === r.workflow.id,
                      )?.reason
                    }
                  </p>
                </article>
              ))}
          </div>
          <h3>このシステム・情報を使う業務</h3>
          {list(impact.direct)}
        </>
      )}
      {view.rows.length === 0 && (
        <p role="status">
          この条件に一致する業務はありません。検索・部署・シナリオを変更して探索できます。
        </p>
      )}
    </section>
  );
}
