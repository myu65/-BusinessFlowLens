"use client";
import { useState } from "react";
import type { CompanyKnowledge, LensGraph } from "@/lib/graph";

export function KnowledgeEditor({
  graph,
  onApply,
}: {
  graph: LensGraph;
  onApply: (g: LensGraph) => void;
}) {
  const [activityId, setActivityId] = useState("");
  const [activityName, setActivityName] = useState("");
  const [capabilityName, setCapabilityName] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [capabilityId, setCapabilityId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [dataId, setDataId] = useState("");
  const [handoffNote, setHandoffNote] = useState("");
  const [handoffKind, setHandoffKind] = useState<"information" | "material">(
    "information",
  );
  const knowledge: CompanyKnowledge = graph.knowledge ?? {
    name: "会社の活動",
    description: "",
    activities: [],
    categories: [],
    systems: [],
    criticalWorkflows: [],
  };
  const apply = (next: CompanyKnowledge) =>
    onApply({ ...graph, knowledge: next });
  return (
    <details className="kg-editor">
      <summary>会社の活動・仕事の種類を登録 / 業務を分類する</summary>
      <label className="kg-edit-field">
        会社名
        <input
          value={knowledge.name}
          onChange={(e) => apply({ ...knowledge, name: e.target.value })}
        />
      </label>
      <label className="kg-edit-field">
        会社の説明
        <textarea
          value={knowledge.description}
          onChange={(e) => apply({ ...knowledge, description: e.target.value })}
        />
      </label>
      <label className="kg-edit-field">
        新しいActivity名
        <input
          value={activityName}
          onChange={(e) => setActivityName(e.target.value)}
        />
      </label>
      <button
        disabled={!activityName.trim()}
        onClick={() => {
          const id = `activity:${crypto.randomUUID()}`;
          apply({
            ...knowledge,
            activities: [
              ...knowledge.activities,
              {
                id,
                name: activityName.trim(),
                description: "",
                capabilities: [],
              },
            ],
          });
          setActivityId(id);
          setActivityName("");
        }}
      >
        Activityを追加
      </button>
      <label className="kg-edit-field">
        編集するActivity
        <select
          value={activityId}
          onChange={(e) => setActivityId(e.target.value)}
        >
          <option value="">選択してください</option>
          {knowledge.activities.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {knowledge.activities
        .filter((a) => a.id === activityId)
        .map((a) => (
          <div key={a.id}>
            <label className="kg-edit-field">
              Activity名
              <input
                value={a.name}
                onChange={(e) =>
                  apply({
                    ...knowledge,
                    activities: knowledge.activities.map((n) =>
                      n.id === a.id ? { ...n, name: e.target.value } : n,
                    ),
                  })
                }
              />
            </label>
            <label className="kg-edit-field">
              Activityの説明
              <textarea
                value={a.description}
                onChange={(e) =>
                  apply({
                    ...knowledge,
                    activities: knowledge.activities.map((n) =>
                      n.id === a.id ? { ...n, description: e.target.value } : n,
                    ),
                  })
                }
              />
            </label>
            {a.capabilities.map((c) => (
              <label className="kg-edit-field" key={c.id}>
                Capability名
                <input
                  value={c.name}
                  onChange={(e) =>
                    apply({
                      ...knowledge,
                      activities: knowledge.activities.map((n) =>
                        n.id === a.id
                          ? {
                              ...n,
                              capabilities: n.capabilities.map((k) =>
                                k.id === c.id
                                  ? { ...k, name: e.target.value }
                                  : k,
                              ),
                            }
                          : n,
                      ),
                    })
                  }
                />
              </label>
            ))}
          </div>
        ))}
      <label className="kg-edit-field">
        新しいCapability名
        <input
          value={capabilityName}
          onChange={(e) => setCapabilityName(e.target.value)}
        />
      </label>
      <button
        disabled={!activityId || !capabilityName.trim()}
        onClick={() => {
          apply({
            ...knowledge,
            activities: knowledge.activities.map((a) =>
              a.id === activityId
                ? {
                    ...a,
                    capabilities: [
                      ...a.capabilities,
                      {
                        id: `capability:${crypto.randomUUID()}`,
                        name: capabilityName.trim(),
                        description: "",
                        workflowIds: [],
                      },
                    ],
                  }
                : a,
            ),
          });
          setCapabilityName("");
        }}
      >
        選択ActivityにCapabilityを追加
      </button>
      <label className="kg-edit-field">
        分類する業務
        <select
          value={workflowId}
          onChange={(e) => setWorkflowId(e.target.value)}
        >
          <option value="">選択してください</option>
          {graph.workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      <label className="kg-edit-field">
        紐づけるCapability
        <select
          value={capabilityId}
          onChange={(e) => setCapabilityId(e.target.value)}
        >
          <option value="">選択してください</option>
          {knowledge.activities.flatMap((a) =>
            a.capabilities.map((c) => (
              <option key={c.id} value={c.id}>
                {a.name} → {c.name}
              </option>
            )),
          )}
        </select>
      </label>
      <button
        disabled={!workflowId || !capabilityId}
        onClick={() =>
          apply({
            ...knowledge,
            activities: knowledge.activities.map((a) => ({
              ...a,
              capabilities: a.capabilities.map((c) =>
                c.id === capabilityId
                  ? {
                      ...c,
                      workflowIds: [...new Set([...c.workflowIds, workflowId])],
                    }
                  : c,
              ),
            })),
          })
        }
      >
        業務を紐づける
      </button>
      {workflowId && (
        <div className="kg-links">
          {knowledge.activities.flatMap((a) =>
            a.capabilities
              .filter((c) => c.workflowIds.includes(workflowId))
              .map((c) => (
                <div key={c.id}>
                  {a.name} → {c.name}{" "}
                  <button
                    onClick={() =>
                      apply({
                        ...knowledge,
                        activities: knowledge.activities.map((n) => ({
                          ...n,
                          capabilities: n.capabilities.map((k) =>
                            k.id === c.id
                              ? {
                                  ...k,
                                  workflowIds: k.workflowIds.filter(
                                    (id) => id !== workflowId,
                                  ),
                                }
                              : k,
                          ),
                        })),
                      })
                    }
                  >
                    この紐づけを解除
                  </button>
                </div>
              )),
          )}
        </div>
      )}
      {workflowId && (
        <>
          <label className="kg-edit-field">
            この業務の重要性・停止時の影響
            <textarea
              value={
                knowledge.criticalWorkflows.find(
                  (w) => w.workflowId === workflowId,
                )?.reason ?? ""
              }
              onChange={(e) =>
                apply({
                  ...knowledge,
                  criticalWorkflows: [
                    ...knowledge.criticalWorkflows.filter(
                      (w) => w.workflowId !== workflowId,
                    ),
                    ...(e.target.value.trim()
                      ? [{ workflowId, reason: e.target.value }]
                      : []),
                  ],
                })
              }
            />
          </label>
          <h3>この業務から次の業務への受渡し</h3>
          <label className="kg-edit-field">
            次の業務
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            >
              <option value="">選択してください</option>
              {graph.workflows
                .filter((w) => w.id !== workflowId)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="kg-edit-field">
            受け渡すData
            <select value={dataId} onChange={(e) => setDataId(e.target.value)}>
              <option value="">未特定</option>
              {graph.nodes
                .filter((n) => n.kind === "data")
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
            </select>
          </label>
          <label className="kg-edit-field">
            受渡しの種類
            <select
              value={handoffKind}
              onChange={(e) =>
                setHandoffKind(e.target.value as "information" | "material")
              }
            >
              <option value="information">情報受渡し</option>
              <option value="material">物の受渡し</option>
            </select>
          </label>
          <label className="kg-edit-field">
            受渡し内容・確認根拠
            <textarea
              value={handoffNote}
              onChange={(e) => setHandoffNote(e.target.value)}
            />
          </label>
          <button
            disabled={!targetId || !handoffNote.trim()}
            onClick={() => {
              apply({
                ...knowledge,
                handoffs: [
                  ...(knowledge.handoffs ?? []),
                  {
                    id: `handoff:${crypto.randomUUID()}`,
                    sourceWorkflowId: workflowId,
                    targetWorkflowId: targetId,
                    dataIds: dataId ? [dataId] : [],
                    kind: handoffKind,
                    description: handoffNote.trim(),
                    evidence: handoffNote.trim(),
                  },
                ],
              });
              setHandoffNote("");
            }}
          >
            受渡しを登録
          </button>
          <div className="kg-links">
            {(knowledge.handoffs ?? [])
              .filter((h) => h.sourceWorkflowId === workflowId)
              .map((h) => (
                <div key={h.id}>
                  {
                    graph.workflows.find((w) => w.id === h.targetWorkflowId)
                      ?.name
                  }
                  : {h.description}{" "}
                  <button
                    onClick={() =>
                      apply({
                        ...knowledge,
                        handoffs: knowledge.handoffs?.filter(
                          (k) => k.id !== h.id,
                        ),
                      })
                    }
                  >
                    この受渡しを解除
                  </button>
                </div>
              ))}
          </div>
        </>
      )}
    </details>
  );
}
