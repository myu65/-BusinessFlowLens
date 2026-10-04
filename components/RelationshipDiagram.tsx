"use client";
import React, { useEffect, useId, useState } from "react";
import type { OverviewNode, OverviewRelation } from "@/lib/relationship-overview";
import { readingPage } from "@/lib/overview-reading";

export const relationLabels = { handoff: "受渡し・参照", transfer: "情報の受渡し", dependency: "稼働の依存" };
export const certaintyLabels = { confirmed: "確認済み", inferred: "推定", unknown: "未確認" };

export function RelationshipDiagram({ nodes, edges, layoutEdges = edges, selectedId, onNode, onEdge, label }: {
  nodes: OverviewNode[]; edges: OverviewRelation[]; layoutEdges?: OverviewRelation[]; selectedId?: string;
  onNode: (id: string) => void; onEdge: (id: string) => void; label: string;
}) {
  const marker = useId().replace(/:/g, "");
  const selected = nodes.some(n => n.id === selectedId);
  const degree = (id: string) => new Set(layoutEdges.filter(e => e.source === id || e.target === id).flatMap(e => [e.source, e.target])).size;
  const hub = selected ? nodes.find(n => n.id === selectedId) : [...nodes].sort((a, b) => degree(b.id) - degree(a.id))[0];
  const positions = new Map<string, { x: number; y: number }>();
  const available = [{ x: 130, y: 180 }, { x: 790, y: 180 }, { x: 460, y: 55 }, { x: 460, y: 305 },
    { x: 130, y: 55 }, { x: 790, y: 55 }, { x: 130, y: 305 }, { x: 790, y: 305 }];
  if (hub) positions.set(hub.id, { x: 460, y: 180 });
  const neighbors = nodes.filter(n => n.id !== hub?.id).sort((a, b) =>
    Number(layoutEdges.some(e => (e.source === hub?.id && e.target === b.id) || (e.target === hub?.id && e.source === b.id))) -
    Number(layoutEdges.some(e => (e.source === hub?.id && e.target === a.id) || (e.target === hub?.id && e.source === a.id))));
  for (const node of neighbors) {
    const incoming = layoutEdges.some(e => e.source === node.id && e.target === hub?.id);
    const outgoing = layoutEdges.some(e => e.target === node.id && e.source === hub?.id);
    const slot = incoming ? available.findIndex(p => p.x === 130) : outgoing ? available.findIndex(p => p.x === 790)
      : available.findIndex(p => p.x === 460);
    positions.set(node.id, available.splice(slot < 0 ? 0 : slot, 1)[0]);
  }
  return <div className="relationship-scroll" role="region" aria-label={label} tabIndex={0}>
    <div className="relationship-stage">
      <svg className="relationship-lines" viewBox="0 0 920 360" aria-label={`${label}の関係`}>
        <defs>{["handoff", "transfer", "dependency"].map(kind => <marker key={kind} id={`${marker}-${kind}`}
          viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className={`relationship-arrow relationship-arrow--${kind}`} />
        </marker>)}</defs>
        {edges.map(edge => {
          const s = positions.get(edge.source)!, t = positions.get(edge.target)!;
          const dx = t.x - s.x, dy = t.y - s.y, length = Math.hypot(dx, dy);
          const trim = Math.min(104 / Math.max(Math.abs(dx), 1), 58 / Math.max(Math.abs(dy), 1));
          const offset = layoutEdges.some(e => e.id !== edge.id && ((e.source === edge.target && e.target === edge.source) ||
            (e.source === edge.source && e.target === edge.target))) ? (edge.kind === "dependency" ? 62 : 35) : 0;
          const cx = (s.x + t.x) / 2 - dy / length * offset, cy = (s.y + t.y) / 2 + dx / length * offset;
          const path = `M ${s.x + dx * trim} ${s.y + dy * trim} Q ${cx} ${cy} ${t.x - dx * trim} ${t.y - dy * trim}`;
          const text = `${edge.kind === "dependency" ? "依存" : "受渡し"} ${edge.references.length}`;
          const lx = (s.x + t.x) / 2 - dy / length * offset / 2, ly = (s.y + t.y) / 2 + dx / length * offset / 2;
          const description = `${nodes.find(n => n.id === edge.source)?.label} → ${nodes.find(n => n.id === edge.target)?.label}・${relationLabels[edge.kind]} ${edge.references.length}件・${certaintyLabels[edge.certainty]}・根拠を見る`;
          return <g key={edge.id} className={`relationship-edge relationship-edge--${edge.kind}`} role="button"
            tabIndex={0} aria-label={description} onClick={() => onEdge(edge.id)} onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onEdge(edge.id); }
            }}>
            <title>{description}</title>
            <path className="relationship-hit" d={path} />
            <path className="relationship-line" d={path} strokeDasharray={edge.certainty !== "confirmed" ? "5 5" : undefined}
              markerEnd={`url(#${marker}-${edge.kind})`} />
            <g transform={`translate(${lx},${ly})`}><rect x="-37" y="-11" width="74" height="22" rx="11" />
              <text textAnchor="middle" dominantBaseline="central">{text}</text></g>
          </g>;
        })}
      </svg>
      {nodes.map(node => {
        const position = positions.get(node.id)!;
        return <button key={node.id} className={`relationship-node ${node.kindLabel === "道具" ? "relationship-node--tool" : ""}`} style={{ left: `${position.x / 9.2}%`, top: position.y }}
          aria-pressed={node.id === selectedId} onClick={() => onNode(node.id)}>
          {node.kindLabel && <small className="relationship-node-kind">{node.kindLabel}</small>}<strong>{node.label}</strong><span>{node.subtitle}</span>{node.note && <small>{node.note}</small>}
        </button>;
      })}
    </div>
  </div>;
}

function ReferenceEvidence({ reference, graph, onWorkflow }: {
  reference: OverviewRelation["references"][number]; graph: import("@/lib/graph").LensGraph;
  onWorkflow: (id: string, stepId?: string) => void;
}) {
  const [page, setPage] = useState(0);
  const workflows = readingPage(reference.workflowIds, page, 6);
  return <article>
    <span>{certaintyLabels[reference.certainty]}{reference.kind === "handoff" && (reference.via === "reference" ? " · 情報の参照" : " · 仕事の受渡し")}</span>
    {reference.kind !== "handoff" && <strong> {graph.nodes.find(n => n.id === reference.source)?.label} → {graph.nodes.find(n => n.id === reference.target)?.label}</strong>}
    <p>{reference.description}</p>
    {reference.dataIds.length > 0 && <p>渡す・参照する情報：{reference.dataIds.map(id => graph.nodes.find(n => n.id === id)?.label ?? id).join(" / ")}</p>}
    {reference.evidence ? <blockquote>{reference.evidence}</blockquote> : <p>原文の根拠は未登録です。</p>}
    <div>{workflows.items.map(id => {
      const steps = reference.processIds.map(processId => graph.nodes.find(n => n.id === processId))
        .filter(n => n?.workflowId === id && n.kind === "process");
      const step = steps.length === 1 ? steps[0] : undefined;
      return <button key={id} onClick={() => onWorkflow(id, step?.id)}>
        {graph.workflows.find(w => w.id === id)?.name ?? id} →
        {step && <small>「{step.label}」の手順へ</small>}
      </button>;
    })}</div>
    {workflows.last > 0 && <div className="relationship-pagination" role="group" aria-label="この根拠に関連する業務のページ">
      <button disabled={!workflows.page} onClick={() => setPage(workflows.page - 1)}>前の6関連業務</button>
      <span>{workflows.start}–{workflows.end} / {workflows.total}関連業務</span>
      <button disabled={workflows.page === workflows.last} onClick={() => setPage(workflows.page + 1)}>次の6関連業務</button>
    </div>}
  </article>;
}

export function RelationshipEvidence({ edge, nodes, graph, onWorkflow, onClose, title }: {
  edge: OverviewRelation; nodes: readonly OverviewNode[]; graph: import("@/lib/graph").LensGraph;
  onWorkflow: (id: string, stepId?: string) => void; onClose?: () => void; title?: string;
}) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [edge.id]);
  const references = readingPage(edge.references, page, 3);
  const label = (id: string) => nodes.find(n => n.id === id)?.label ?? id;
  return <aside className="relationship-evidence" aria-label="選んだ関係の根拠">
    <header><h3>{title ?? `${label(edge.source)} → ${label(edge.target)}`}</h3>{onClose && <button onClick={onClose}>根拠を閉じる</button>}</header>
    <p>{relationLabels[edge.kind]} · {edge.references.length}件。{edge.kind === "dependency" && `${label(edge.source)}が動くために${label(edge.target)}を必要とします。`}</p>
    {references.items.map((reference, i) => <ReferenceEvidence key={`${edge.id}:${references.page}:${i}`} reference={reference} graph={graph} onWorkflow={onWorkflow} />)}
    {references.last > 0 && <div className="relationship-pagination" role="group" aria-label="関係の根拠のページ">
      <button disabled={!references.page} onClick={() => setPage(references.page - 1)}>前の3根拠</button>
      <span>{references.start}–{references.end} / {references.total}根拠</span>
      <button disabled={references.page === references.last} onClick={() => setPage(references.page + 1)}>次の3根拠</button>
    </div>}
  </aside>;
}
