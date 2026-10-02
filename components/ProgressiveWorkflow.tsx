"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  getAssetUsages,
  getProcessAssetLinks,
  getWorkflowProcesses,
  type ExtractionReviewStep,
  type LensGraph,
  type LensNode,
} from "@/lib/graph";
import { mergeAssets } from "@/lib/refinement";

export function StepDetailEditor({
  step,
  onChange,
}: {
  step: ExtractionReviewStep;
  onChange: (patch: Partial<ExtractionReviewStep>) => void;
}) {
  return (
    <details className="progressive-editor">
      <summary>
        詳細を補足する ·{" "}
        {(step.detailSteps?.length ?? 0) + (step.technicalDetails?.length ?? 0)}
        件
      </summary>
      <p>
        分かる項目だけ入力できます。業務データと、物理テーブル・ビューは別に記録します。
      </p>
      <h4>このステップの詳細手順</h4>
      {(step.detailSteps ?? []).map((detail, index) => (
        <div className="detail-edit-row" key={detail.id}>
          <label>
            操作 {index + 1}
            <input
              value={detail.action}
              onChange={(event) =>
                onChange({
                  detailSteps: step.detailSteps!.map((item, i) =>
                    i === index
                      ? { ...item, action: event.target.value }
                      : item,
                  ),
                })
              }
            />
          </label>
          <label>
            実行条件（任意）
            <input
              value={detail.condition ?? ""}
              onChange={(event) =>
                onChange({
                  detailSteps: step.detailSteps!.map((item, i) =>
                    i === index
                      ? { ...item, condition: event.target.value || null }
                      : item,
                  ),
                })
              }
            />
          </label>
          <label>
            根拠・補足
            <input
              value={detail.evidence}
              onChange={(event) =>
                onChange({
                  detailSteps: step.detailSteps!.map((item, i) =>
                    i === index
                      ? { ...item, evidence: event.target.value }
                      : item,
                  ),
                })
              }
            />
          </label>
          <div className="detail-actions">
            <button
              disabled={index === 0}
              onClick={() => {
                const items = [...step.detailSteps!];
                [items[index - 1], items[index]] = [
                  items[index],
                  items[index - 1],
                ];
                onChange({ detailSteps: items });
              }}
            >
              上へ
            </button>
            <button
              onClick={() =>
                onChange({
                  detailSteps: step.detailSteps!.filter((_, i) => i !== index),
                })
              }
            >
              手順を削除
            </button>
          </div>
        </div>
      ))}
      <button
        onClick={() =>
          onChange({
            detailSteps: [
              ...(step.detailSteps ?? []),
              {
                id: crypto.randomUUID(),
                action: "",
                condition: null,
                evidence: "",
              },
            ],
          })
        }
      >
        ＋ 詳細手順を追加
      </button>
      <h4>システムの技術詳細</h4>
      {(step.technicalDetails ?? []).map((detail, index) => (
        <div className="detail-edit-row" key={index}>
          {(
            [
              ["system", "対象システム／環境"],
              ["module", "SAPモジュール／業務領域"],
              ["transaction", "トランザクション／アプリ"],
              ["hanaArea", "HANA領域／スキーマ"],
              ["objects", "物理テーブル／ビュー"],
              ["evidence", "根拠・補足"],
            ] as const
          ).map(([field, label]) => (
            <label key={field}>
              {label}
              <input
                value={detail[field] ?? ""}
                onChange={(event) =>
                  onChange({
                    technicalDetails: step.technicalDetails!.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            [field]:
                              event.target.value ||
                              (field === "system" || field === "evidence"
                                ? ""
                                : null),
                          }
                        : item,
                    ),
                  })
                }
              />
            </label>
          ))}
          <button
            onClick={() =>
              onChange({
                technicalDetails: step.technicalDetails!.filter(
                  (_, i) => i !== index,
                ),
              })
            }
          >
            技術詳細を削除
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          onChange({
            technicalDetails: [
              ...(step.technicalDetails ?? []),
              {
                system: step.systems[0]?.name ?? "",
                module: null,
                transaction: null,
                hanaArea: null,
                objects: null,
                evidence: "",
              },
            ],
          })
        }
      >
        ＋ 技術詳細を追加
      </button>
    </details>
  );
}

export function TechnicalDetails({ node }: { node: LensNode }) {
  return (
    <div className="technical-details">
      {!(node.detailSteps?.length || node.technicalDetails?.length) ? (
        <p className="detail-empty">
          詳細未登録。業務入力で、このステップの詳細を補足できます。
        </p>
      ) : null}
      {node.detailSteps?.length ? (
        <ol className="detail-operations">
          {node.detailSteps.map((detail) => (
            <li key={detail.id}>
              <strong>{detail.action || "操作未記入"}</strong>
              {detail.condition ? <span>条件：{detail.condition}</span> : null}
              <small>根拠：{detail.evidence || "未確認"}</small>
            </li>
          ))}
        </ol>
      ) : null}
      {(node.technicalDetails ?? []).map((detail, index) => (
        <dl key={index} className="technical-grid">
          {(
            [
              ["system", "対象システム／環境"],
              ["module", "モジュール／業務領域"],
              ["transaction", "トランザクション／アプリ"],
              ["hanaArea", "HANA領域／スキーマ"],
              ["objects", "物理テーブル／ビュー"],
              ["evidence", "根拠"],
            ] as const
          ).map(([field, label]) => (
            <div key={field}>
              <dt>{label}</dt>
              <dd>{detail[field] || "未確認"}</dd>
            </div>
          ))}
        </dl>
      ))}
    </div>
  );
}

export function WorkflowExplorer({
  graph,
  workflowId,
  selectedStepId,
  onSelectWorkflow,
  onEdit,
  children,
}: {
  graph: LensGraph;
  workflowId: string;
  selectedStepId?: string;
  onSelectWorkflow: (id: string) => void;
  onEdit: () => void;
  children: ReactNode;
}) {
  const [level, setLevel] = useState<"overview" | "business" | "detail">(
    "overview",
  );
  const [stepId, setStepId] = useState<string | null>(null);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [level, workflowId]);
  const workflow = graph.workflows.find((item) => item.id === workflowId);
  const steps = getWorkflowProcesses(graph, workflowId);
  const selected = steps.find((node) => node.id === stepId) ?? steps[0];
  const systemLabel = (id: string) =>
    graph.nodes.find((node) => node.id === id)?.label ?? "未確認";
  return (
    <div className="workflow-explorer">
      <div className="level-toolbar">
        <div>
          <strong>どの深さで見ますか？</strong>
          <span>全体をつかみ、手順を辿り、必要な詳細へ。</span>
        </div>
        <div className="level-switch" role="group" aria-label="表示レベル">
          {(
            [
              ["overview", "鳥瞰"],
              ["business", "業務通常"],
              ["detail", "詳細"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={level === id}
              className={level === id ? "active" : ""}
              onClick={() => {
                if (id === "detail" && selectedStepId)
                  setStepId(selectedStepId);
                setLevel(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {level === "business" ? (
        <>
          {children}
          <div className="drill-footer">
            <p>操作や技術情報まで確認する場合は、詳細へ進めます。</p>
            <button
              onClick={() => {
                if (selectedStepId) setStepId(selectedStepId);
                setLevel("detail");
              }}
            >
              この業務の詳細を見る →
            </button>
          </div>
        </>
      ) : null}
      {level === "overview" ? (
        <section className="page-view bird-view">
          <div className="eyebrow">まず、全体をつかむ</div>
          <h1>業務はどこでつながっている？</h1>
          <p>
            共有システムは共通の接点です。実際の受け渡しは、記録済みのデータフローとして分けて表示します。
          </p>
          <div className="bird-grid">
            {graph.workflows.map((item) => {
              const processes = getWorkflowProcesses(graph, item.id);
              const assets = new Map(
                processes
                  .flatMap((node) => getProcessAssetLinks(graph, node.id))
                  .map((link) => [link.asset.id, link.asset]),
              );
              const shared = [...assets.values()].filter(
                (node) =>
                  new Set(
                    getAssetUsages(graph, node.id).map(
                      (usage) => usage.workflowId,
                    ),
                  ).size > 1,
              );
              return (
                <article className="bird-card" key={item.id}>
                  <small>
                    {item.scenario === "future" ? "将来案" : "業務"} ·{" "}
                    {processes.length}ステップ
                  </small>
                  <h2>{item.name}</h2>
                  <p>{item.description || "概要はまだ未登録です"}</p>
                  <div className="bird-journey">
                    {processes.length
                      ? `${processes[0].label} → ${processes.at(-1)!.label}`
                      : "手順は未登録。メモから始められます。"}
                  </div>
                  <div className="bird-assets">
                    {[...assets.values()]
                      .filter((node) => node.kind === "system")
                      .map((node) => (
                        <span key={node.id}>
                          {node.label}
                          {shared.some((asset) => asset.id === node.id)
                            ? " · 共有"
                            : ""}
                        </span>
                      ))}
                  </div>
                  <p className="uncertainty-note">
                    {
                      processes.filter((node) => node.status !== "confirmed")
                        .length
                    }
                    ステップが要確認 · 詳細あり{" "}
                    {
                      processes.filter(
                        (node) =>
                          node.technicalDetails?.length ||
                          node.detailSteps?.length,
                      ).length
                    }
                    件
                  </p>
                  <button
                    onClick={() => {
                      onSelectWorkflow(item.id);
                      setStepId(null);
                      setLevel("business");
                    }}
                  >
                    手順を読む →
                  </button>
                </article>
              );
            })}
          </div>
          <section className="bird-transfers">
            <h2>記録済みの受け渡し</h2>
            {graph.dataFlows.length ? (
              graph.dataFlows.map((flow) => (
                <article key={flow.id}>
                  <strong>
                    {systemLabel(flow.sourceSystemId)} →{" "}
                    {systemLabel(flow.targetSystemId)}
                  </strong>
                  <span>
                    {flow.dataIds.map(systemLabel).join(" / ") ||
                      "データ未確認"}{" "}
                    ·{" "}
                    {flow.automation === "manual"
                      ? "手動"
                      : flow.automation === "automatic"
                        ? "自動"
                        : "方式要確認"}
                  </span>
                  <small>
                    {flow.workflowIds
                      .map(
                        (id) =>
                          graph.workflows.find((item) => item.id === id)?.name,
                      )
                      .join(" / ")}{" "}
                    · {flow.evidence || "根拠未確認"}
                  </small>
                </article>
              ))
            ) : (
              <p>
                受け渡しは未登録です。システムを共有しているだけでは、連携があるとは決めません。
              </p>
            )}
          </section>
        </section>
      ) : null}
      {level === "detail" ? (
        <section className="page-view">
          <button className="back-link" onClick={() => setLevel("business")}>
            ← 業務通常に戻る
          </button>
          <div className="eyebrow">必要なところを、具体的に</div>
          <h1>{workflow?.name}の詳細</h1>
          <div className="detail-picker">
            <label>
              業務
              <select
                value={workflowId}
                onChange={(event) => {
                  onSelectWorkflow(event.target.value);
                  setStepId(null);
                }}
              >
                {graph.workflows.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              ステップ
              <select
                value={selected?.id ?? ""}
                onChange={(event) => setStepId(event.target.value)}
              >
                {steps.map((node, index) => (
                  <option key={node.id} value={node.id}>
                    {node.stepOrder ?? index + 1}. {node.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selected ? (
            <article className="detail-card">
              <h2>{selected.label}</h2>
              <p>{selected.action || selected.description}</p>
              <p className="uncertainty-note">
                {selected.status === "confirmed"
                  ? "確認済み"
                  : "要確認・推定を含む"}{" "}
                · {selected.department || selected.actor || "担当未確認"} ·
                根拠：{selected.evidence || "未確認"}
              </p>
              <TechnicalDetails node={selected} />
              <button onClick={onEdit}>業務入力で詳細を補足する →</button>
            </article>
          ) : (
            <div className="empty-state">
              手順はまだ未登録です。
              <button onClick={onEdit}>メモを入力する</button>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

export function AssetMergePanel({
  graph,
  source,
  onApply,
}: {
  graph: LensGraph;
  source: LensNode;
  onApply: (graph: LensGraph) => void;
}) {
  const [targetId, setTargetId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const target = graph.nodes.find(
    (node) =>
      node.id === targetId &&
      node.kind === source.kind &&
      node.id !== source.id,
  );
  const candidates = graph.nodes.filter(
    (node) => node.kind === source.kind && node.id !== source.id,
  );
  const affectedSteps = graph.nodes.filter(
    (node) =>
      node.kind === "process" &&
      getProcessAssetLinks(graph, node.id).some(
        (link) => link.asset.id === source.id || link.asset.id === targetId,
      ),
  );
  const affectedFlows = graph.dataFlows.filter((flow) =>
    [flow.sourceSystemId, flow.targetSystemId, ...flow.dataIds].some(
      (id) => id === source.id || id === targetId,
    ),
  );
  return (
    <details className="asset-merge">
      <summary>同じシステム・データの表記を統合する</summary>
      <p>
        ERPとSAPなど、実際に同じ資産と確認できた場合に使います。異なる環境は別のままにできます。
      </p>
      <label>
        「{source.label}」の統合先
        <select
          value={target?.id ?? ""}
          onChange={(event) => {
            setTargetId(event.target.value);
            setConfirmed(false);
          }}
        >
          <option value="">統合先を選択</option>
          {candidates.map((node) => (
            <option key={node.id} value={node.id}>
              {node.label} · {node.description}
            </option>
          ))}
        </select>
      </label>
      {target ? (
        <div className="merge-preview">
          <strong>
            {source.label} → {target.label}
          </strong>
          <p>
            業務は個別に維持し、共有資産の参照をまとめます。旧名称は別名として保存します。
          </p>
          <p>
            {new Set(affectedSteps.map((node) => node.workflowId)).size}業務 ·{" "}
            {affectedSteps.length}ステップ · {affectedFlows.length}
            データフローが影響範囲
          </p>
          <ul>
            {affectedSteps.map((node) => (
              <li key={node.id}>
                {
                  graph.workflows.find((item) => item.id === node.workflowId)
                    ?.name
                }{" "}
                / {node.label}
              </li>
            ))}
          </ul>
          <label className="merge-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            同一の資産・環境であることを確認した
          </label>
          <button
            disabled={!confirmed}
            onClick={() => {
              onApply(mergeAssets(graph, source.id, target.id));
              setTargetId("");
              setConfirmed(false);
            }}
          >
            確認した資産を統合して保存
          </button>
        </div>
      ) : null}
    </details>
  );
}
