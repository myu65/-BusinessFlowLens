"use client";

import { useState } from "react";
import type {
  LensGraph,
  MaterialHandoff,
  WorkflowLandscape,
} from "@/lib/graph";
import {
  BUSINESS_DOMAINS,
  duplicateSiteWorkflow,
  emptyLandscape,
  validateLandscape,
} from "@/lib/landscape";

function Editor({
  graph,
  workflowId,
  onApply,
}: {
  graph: LensGraph;
  workflowId: string;
  onApply: (graph: LensGraph) => void;
}) {
  const workflow = graph.workflows.find((w) => w.id === workflowId)!;
  const [draft, setDraft] = useState<WorkflowLandscape>(() =>
    structuredClone(workflow.landscape ?? emptyLandscape()),
  );
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [customDomains, setCustomDomains] = useState(() =>
    (workflow.landscape?.domains ?? [])
      .filter((d) => !BUSINESS_DOMAINS.includes(d))
      .join(", "),
  );
  const patch = (value: Partial<WorkflowLandscape>) => {
    setDraft((d) => ({ ...d, ...value }));
    setSaved(false);
    setError("");
  };
  const handoff = (id: string, value: Partial<MaterialHandoff>) =>
    patch({
      materialHandoffs: draft.materialHandoffs.map((h) =>
        h.id === id ? { ...h, ...value } : h,
      ),
    });
  const split = (value: string) => [
    ...new Set(
      value
        .split(/[,、\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  return (
    <form
      className="landscape-editor"
      onSubmit={(e) => {
        e.preventDefault();
        const normalized = {
          ...draft,
          domains: draft.domains.map((s) => s.trim()).filter(Boolean),
          site: draft.site.trim(),
          productId: draft.productId.trim(),
          commonProcessId: draft.commonProcessId.trim(),
          perspective: draft.perspective.trim(),
        };
        const invalid = validateLandscape(graph, workflowId, normalized);
        if (invalid) {
          setError(invalid);
          return;
        }
        onApply({
          ...graph,
          workflows: graph.workflows.map((w) =>
            w.id === workflowId ? { ...w, landscape: normalized } : w,
          ),
        });
        setDraft(normalized);
        setSaved(true);
      }}
    >
      <fieldset>
        <legend>業務の位置づけ</legend>
        <p>
          同じ製品・共通業務はIDを揃えて関連づけます。分類は複数指定でき、工場や視点は独立して持てます。
        </p>
        <div className="landscape-domain-checks">
          {BUSINESS_DOMAINS.map((domain) => (
            <label key={domain}>
              <input
                type="checkbox"
                checked={draft.domains.includes(domain)}
                onChange={(e) =>
                  patch({
                    domains: e.target.checked
                      ? [...draft.domains, domain]
                      : draft.domains.filter((d) => d !== domain),
                  })
                }
              />
              {domain}
            </label>
          ))}
        </div>
        <label>
          追加の分類（カンマ区切り）
          <input
            value={customDomains}
            onChange={(e) => {
              setCustomDomains(e.target.value);
              patch({
                domains: [
                  ...draft.domains.filter((d) => BUSINESS_DOMAINS.includes(d)),
                  ...split(e.target.value),
                ],
              });
            }}
            placeholder="例：安全衛生、法務"
          />
        </label>
        <div className="landscape-fields">
          <label>
            工場・拠点
            <input
              value={draft.site}
              onChange={(e) => patch({ site: e.target.value })}
              placeholder="例：A工場、全社共通"
            />
          </label>
          <label>
            製品ID
            <input
              value={draft.productId}
              onChange={(e) => patch({ productId: e.target.value })}
              placeholder="例：P-100"
            />
          </label>
          <label>
            製品名
            <input
              value={draft.productLabel}
              onChange={(e) => patch({ productLabel: e.target.value })}
              placeholder="例：ポンプA"
            />
          </label>
          <label>
            製品を見る視点
            <input
              value={draft.perspective}
              onChange={(e) => patch({ perspective: e.target.value })}
              placeholder="例：設計、製造、原価、品質"
            />
          </label>
          <label>
            共通業務ID
            <input
              value={draft.commonProcessId}
              onChange={(e) => patch({ commonProcessId: e.target.value })}
              placeholder="例：RECEIVING"
            />
          </label>
          <label>
            業務の位置づけ
            <select
              value={draft.processRole}
              onChange={(e) =>
                patch({
                  processRole: e.target
                    .value as WorkflowLandscape["processRole"],
                })
              }
            >
              <option value="independent">個別業務・未整理</option>
              <option value="common">共通の業務定義</option>
              <option value="site">拠点での実施</option>
            </select>
          </label>
        </div>
        <label>
          実施方法・共通業務との差分
          <textarea
            value={draft.variantNote}
            onChange={(e) => patch({ variantNote: e.target.value })}
            placeholder="例：A工場はバーコード、B工場は紙で検品。共通の検査基準は同じ。"
          />
        </label>
        <label>
          分類・同一性を確認した根拠
          <textarea
            value={draft.evidence}
            onChange={(e) => patch({ evidence: e.target.value })}
            placeholder="例：製品台帳P-100、標準作業書、担当者ヒアリング"
          />
        </label>
      </fieldset>
      <fieldset>
        <legend>この業務からの物の受け渡し</legend>
        <p>
          実物の移動を登録します。データ対応が未登録なら「未確認」、切れていると確認した場合に「途切れ」を選びます。
        </p>
        {draft.materialHandoffs.map((h, i) => (
          <article className="material-editor" key={h.id}>
            <h4>受け渡し {i + 1}</h4>
            <div className="landscape-fields">
              <label>
                受け渡し先業務
                <select
                  value={h.targetWorkflowId}
                  onChange={(e) =>
                    handoff(h.id, { targetWorkflowId: e.target.value })
                  }
                >
                  <option value="">選択してください</option>
                  {graph.workflows.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} · {w.landscape?.site || "拠点未登録"} ·{" "}
                      {w.scenario === "future"
                        ? "将来案"
                        : w.scenario === "alternative"
                          ? "代替案"
                          : "現状"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                送り元の場所・工程
                <input
                  value={h.sourceLocation || ""}
                  onChange={(e) =>
                    handoff(h.id, { sourceLocation: e.target.value })
                  }
                  placeholder="例：加工ライン、部品倉庫"
                />
              </label>
              <label>
                送り先の場所・工程
                <input
                  value={h.targetLocation || ""}
                  onChange={(e) =>
                    handoff(h.id, { targetLocation: e.target.value })
                  }
                  placeholder="例：組立ライン、出荷倉庫"
                />
              </label>
              <label>
                受け渡す物
                <input
                  value={h.material}
                  onChange={(e) => handoff(h.id, { material: e.target.value })}
                  placeholder="例：加工済み部品"
                />
              </label>
              <label>
                流れる物の製品ID
                <input
                  value={h.productId || ""}
                  onChange={(e) => handoff(h.id, { productId: e.target.value })}
                />
              </label>
              <label>
                ロット・追跡キー
                <input
                  value={h.traceKey || ""}
                  onChange={(e) => handoff(h.id, { traceKey: e.target.value })}
                  placeholder="例：ロット番号、シリアル番号"
                />
              </label>
              <label>
                物とデータの対応
                <select
                  value={h.dataContinuity}
                  onChange={(e) =>
                    handoff(h.id, {
                      dataContinuity: e.target
                        .value as MaterialHandoff["dataContinuity"],
                    })
                  }
                >
                  <option value="unknown">未確認</option>
                  <option value="linked">対応を確認済み</option>
                  <option value="broken">途切れを確認</option>
                </select>
              </label>
            </div>
            <div
              className="landscape-domain-checks"
              role="group"
              aria-label={`受け渡し${i + 1}の対応データ`}
            >
              {graph.nodes
                .filter((n) => n.kind === "data")
                .map((n) => (
                  <label key={n.id}>
                    <input
                      type="checkbox"
                      checked={h.dataIds.includes(n.id)}
                      onChange={(e) =>
                        handoff(h.id, {
                          dataIds: e.target.checked
                            ? [...h.dataIds, n.id]
                            : h.dataIds.filter((id) => id !== n.id),
                        })
                      }
                    />
                    {n.label}
                  </label>
                ))}
            </div>
            {!graph.nodes.some((n) => n.kind === "data") ? (
              <p>業務データは未登録です。業務入力で追加できます。</p>
            ) : null}
            <label>
              対応・途切れの根拠
              <textarea
                value={h.evidence}
                onChange={(e) => handoff(h.id, { evidence: e.target.value })}
                placeholder="例：部品は届くがロット番号が記録に引き継がれない"
              />
            </label>
            <button
              type="button"
              onClick={() =>
                patch({
                  materialHandoffs: draft.materialHandoffs.filter(
                    (item) => item.id !== h.id,
                  ),
                })
              }
            >
              この受け渡しを外す
            </button>
          </article>
        ))}
        <button
          type="button"
          onClick={() =>
            patch({
              materialHandoffs: [
                ...draft.materialHandoffs,
                {
                  id: crypto.randomUUID(),
                  targetWorkflowId: "",
                  material: "",
                  productId: draft.productId,
                  traceKey: "",
                  dataIds: [],
                  dataContinuity: "unknown",
                  evidence: "",
                },
              ],
            })
          }
        >
          ＋ 物の受け渡しを追加
        </button>
      </fieldset>
      {error ? (
        <p role="alert" className="landscape-error">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status">
          鳥瞰に反映しました。画面上部で保存状態を確認できます。
        </p>
      ) : null}
      <button type="submit">位置づけ・物の流れを反映</button>
      <button
        type="button"
        onClick={() => {
          setDraft(structuredClone(workflow.landscape ?? emptyLandscape()));
          setCustomDomains(
            (workflow.landscape?.domains ?? [])
              .filter((d) => !BUSINESS_DOMAINS.includes(d))
              .join(", "),
          );
          setError("");
          setSaved(false);
        }}
      >
        編集を戻す
      </button>
    </form>
  );
}

export function LandscapeEditor({
  graph,
  initialWorkflowId,
  onApply,
}: {
  graph: LensGraph;
  initialWorkflowId?: string;
  onApply: (graph: LensGraph) => void;
}) {
  const [id, setId] = useState(
    initialWorkflowId ?? graph.workflows[0]?.id ?? "",
  );
  const [variantName, setVariantName] = useState("");
  const [variantSite, setVariantSite] = useState("");
  const [cloneError, setCloneError] = useState("");
  const selectedId = graph.workflows.some((w) => w.id === id)
    ? id
    : graph.workflows[0]?.id;
  return (
    <details className="landscape-config">
      <summary>分類・工場・製品・共通業務・物の流れを登録する</summary>
      {selectedId ? (
        <>
          <label>
            位置づけを編集する業務
            <select value={selectedId} onChange={(e) => setId(e.target.value)}>
              {graph.workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <Editor
            key={selectedId}
            graph={graph}
            workflowId={selectedId}
            onApply={onApply}
          />
          <details className="landscape-clone">
            <summary>この業務から別の拠点での実施を作る</summary>
            <p>
              保存済みの手順と技術詳細を複製し、共通業務IDで関連づけます。物の受け渡しは拠点ごとに登録してください。上の編集中の内容は先に反映してください。
            </p>
            <label>
              複製する業務名
              <input
                value={variantName}
                onChange={(e) => setVariantName(e.target.value)}
                placeholder="例：B工場の検品"
              />
            </label>
            <label>
              複製先の工場・拠点
              <input
                value={variantSite}
                onChange={(e) => setVariantSite(e.target.value)}
                placeholder="例：B工場"
              />
            </label>
            {cloneError ? <p role="alert">{cloneError}</p> : null}
            <button
              onClick={() => {
                try {
                  const nextId = `site-${crypto.randomUUID()}`;
                  onApply(
                    duplicateSiteWorkflow(
                      graph,
                      selectedId,
                      nextId,
                      variantName,
                      variantSite,
                    ),
                  );
                  setId(nextId);
                  setVariantName("");
                  setVariantSite("");
                  setCloneError("");
                } catch (e) {
                  setCloneError(
                    e instanceof Error ? e.message : "複製できませんでした。",
                  );
                }
              }}
            >
              拠点別の実施を作成
            </button>
          </details>
        </>
      ) : (
        <p>業務を作成すると位置づけを登録できます。</p>
      )}
    </details>
  );
}
