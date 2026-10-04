"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { KnowledgeReportDocument, KnowledgeReportSection } from "@/lib/knowledge";

function ReportText({ lines }: { lines: string[] }) {
  const blocks: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], key = i;
    if (!line.trim()) continue;
    if (line === "原文:") {
      const source: string[] = [];
      while (lines[i + 1]?.trim()) source.push(lines[++i]);
      blocks.push(<details className="kg-report-source" key={key}><summary>原文・結果の根拠・人の訂正を読む</summary><ReportText lines={source} /></details>);
      continue;
    }
    if (line.startsWith("同じ手順の変更: ")) {
      blocks.push(<details className="kg-report-source" key={key}><summary>同じ手順の変更：{line.slice(9).split(" / ")[0]}</summary><p>{line}</p></details>);
      continue;
    }
    if (line.startsWith("### ")) { blocks.push(<h4 key={key}>{line.slice(4)}</h4>); continue; }
    if (line.startsWith("> ")) {
      const source = [line.slice(2)];
      while (lines[i + 1]?.startsWith("> ")) source.push(lines[++i].slice(2));
      blocks.push(<blockquote key={key}>{source.join("\n")}</blockquote>); continue;
    }
    if (line.startsWith("- ")) {
      const items = [line.slice(2)];
      while (lines[i + 1]?.startsWith("- ")) items.push(lines[++i].slice(2));
      blocks.push(<ul key={key}>{items.map((item, n) => <li key={n}>{item}</li>)}</ul>); continue;
    }
    blocks.push(<p key={key}>{line}</p>);
  }
  return <div className="kg-report-text">{blocks}</div>;
}

export function KnowledgeReportPreview({ document, text, url, onClose }: {
  document: KnowledgeReportDocument; text: string; url: string; onClose: () => void;
}) {
  const [query, setQuery] = useState(""), [page, setPage] = useState(0);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [raw, setRaw] = useState(false);
  const preview = useRef<HTMLElement>(null);
  useEffect(() => { preview.current?.scrollIntoView({ block: "start", behavior: "instant" }); }, [document]);
  const entries = useMemo(() => document.workflows.filter(w => w.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [document, query]);
  const pageIndex = Math.min(page, Math.max(0, Math.ceil(entries.length / 6) - 1));
  const section = (item: KnowledgeReportSection, prefix: string) => {
    const id = `${prefix}:${item.id}`;
    return <details key={id} open={!!opened[id]} onToggle={e => {
      const open = e.currentTarget.open;
      setOpened(previous => previous[id] === open ? previous : { ...previous, [id]: open });
    }}>
      <summary>{item.title}</summary>
      {opened[id] && <ReportText lines={item.body} />}
    </details>;
  };
  return <section ref={preview} aria-label="レポートプレビュー" className="kg-report-preview">
    <h2>レポートプレビュー</h2>
    <p>表示した時の範囲と概要から、必要な仕事を開いて読めます。ファイルは保存済みのデータから生成します。</p>
    <div className="kg-toolbar">
      <a href={url} download>Markdownファイルをダウンロード</a>
      <button onClick={onClose}>プレビューを閉じる</button>
    </div>
    <h3>{document.title}</h3>
    <ReportText lines={document.introduction} />
    {document.context.map(c => section(c, "context"))}
    <h3>仕事ごとの詳しい内容</h3>
    <label className="kg-edit-field">レポート内の業務名を検索
      <input aria-label="レポート内の業務名を検索" aria-describedby="report-query-help"
        value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} />
      <small id="report-query-help">読む業務を探すための検索です。ファイルには、上に表示した出力範囲が入ります。</small>
    </label>
    <p>{entries.length}業務 / {entries.length ? pageIndex * 6 + 1 : 0}–{Math.min(entries.length, (pageIndex + 1) * 6)}を表示</p>
    {entries.slice(pageIndex * 6, (pageIndex + 1) * 6).map(w => section(w, "workflow"))}
    {!entries.length && <p>この範囲には、検索に合う業務がありません。</p>}
    <div className="kg-toolbar">
      <button disabled={!pageIndex} onClick={() => setPage(pageIndex - 1)}>前の6業務</button>
      <button disabled={(pageIndex + 1) * 6 >= entries.length} onClick={() => setPage(pageIndex + 1)}>次の6業務</button>
    </div>
    <details open={raw} onToggle={e => setRaw(e.currentTarget.open)}>
      <summary>出力するMarkdown本文を確認する</summary>
      {raw && <textarea aria-label="レポート本文" readOnly value={text} />}
    </details>
  </section>;
}
