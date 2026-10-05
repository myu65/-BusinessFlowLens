"use client";

import React, { useEffect, useState, type ReactNode } from "react";
import {
  getProcessAssetLinks,
  getWorkflowProcesses,
  type ExtractionReviewStep,
  type LensGraph,
  type LensNode,
} from "@/lib/graph";
import { CompanyMap } from "./CompanyMap";
import { WorkflowReading } from "./WorkflowReading";
import type { FlowJourney } from "@/lib/flow-context";
import { BusinessOverview } from "./BusinessOverview";
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
  initialLevel = "overview",
  workflowId,
  selectedStepId,
  onFocusStep,
  onSelectWorkflow,
  onEdit,
  onGraphApply,
  children,
}: {
  graph: LensGraph;
  initialLevel?: "overview" | "business";
  workflowId: string;
  selectedStepId?: string;
  onFocusStep?: (workflowId: string, stepId: string) => void;
  onSelectWorkflow: (id: string) => void;
  onEdit: () => void;
  onGraphApply: (graph: LensGraph) => void;
  children: ReactNode;
}) {
  const [level, setLevel] = useState<"overview" | "business">(initialLevel);
  const [stepId, setStepId] = useState<string | null>(null);
  const [readerJourney, setReaderJourney] = useState<FlowJourney>();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [level, workflowId]);
  const workflow = graph.workflows.find((item) => item.id === workflowId);
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
              ["business", "流れと情報"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={level === id}
              className={level === id ? "active" : ""}
              onClick={() => {
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
          <section className="page-view kg-view">
            <h1>{workflow?.name}</h1>
            <p>{workflow?.description}</p>
            <WorkflowReading
              key={workflowId}
              journey={
                readerJourney?.workflowId === workflowId
                  ? readerJourney
                  : undefined
              }
              initialStepId={
                readerJourney?.workflowId === workflowId
                  ? readerJourney.stepId
                  : (stepId ?? selectedStepId)
              }
              initialDataId={
                readerJourney?.workflowId === workflowId
                  ? readerJourney.dataId
                  : undefined
              }
              initialLens={
                readerJourney?.workflowId === workflowId && readerJourney.dataId
                  ? "data"
                  : "work"
              }
              onStepChange={(id) => {
                setStepId(id);
                onFocusStep?.(workflowId, id);
              }}
              onGraphApply={onGraphApply}
              onNavigateWorkflow={(id, journey) => {
                setReaderJourney(journey);
                setStepId(journey.stepId ?? null);
                if (journey.stepId) onFocusStep?.(id, journey.stepId);
                onSelectWorkflow(id);
              }}
              graph={graph}
              workflowId={workflowId}
              onDetail={() => onEdit()}
            />
            <details>
              <summary>
                業務を切り替える・全手順のフロー図と関連情報を見る
              </summary>
              {children}
            </details>
          </section>
        </>
      ) : null}
      {level === "overview" && graph.knowledge ? (
        <section className="page-view kg-view">
          <h1>会社の仕事を鳥瞰する</h1>
          <CompanyMap
            graph={graph}
            workflowIds={graph.workflows
              .filter(
                (w) =>
                  (w.scenario ?? "current") ===
                  (workflow?.scenario ?? "current"),
              )
              .map((w) => w.id)}
            onWorkflow={(id) => {
              onSelectWorkflow(id);
              setLevel("business");
            }}
          />
          <details>
            <summary>条件で絞り込む・詳しい関係図を開く</summary>
            <BusinessOverview
              graph={graph}
              onEdit={onEdit}
              onGraphApply={onGraphApply}
              onOpen={(id) => {
                onSelectWorkflow(id);
                setLevel("business");
              }}
            />
          </details>
        </section>
      ) : null}
      {level === "overview" && !graph.knowledge ? (
        <BusinessOverview
          graph={graph}
          onEdit={onEdit}
          onGraphApply={onGraphApply}
          onOpen={(id) => {
            onSelectWorkflow(id);
            setStepId(null);
            setLevel("business");
          }}
        />
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
  const affectedProcessIds = new Set(
    target
      ? graph.edges
          .filter(
            (e) =>
              [source.id, targetId].includes(e.source) ||
              [source.id, targetId].includes(e.target),
          )
          .flatMap((e) => [e.source, e.target])
      : [],
  );
  const affectedSteps = graph.nodes.filter(
    (node) => node.kind === "process" && affectedProcessIds.has(node.id),
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
            {affectedSteps.slice(0, 8).map((node) => (
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
