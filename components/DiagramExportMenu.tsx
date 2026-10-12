"use client";
import React, { useEffect, useState } from 'react';
import { diagramFilename, type DiagramExport } from '@/lib/diagram-export';
import type { DiagramFormat } from '@/lib/diagram-renderer';

export function DiagramExportMenu({ model }: { model: DiagramExport }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [preview, setPreview] = useState<{ url: string; title: string }>();
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  async function output(format: DiagramFormat, copy = false) {
    if (busy) return;
    const captured = model;
    setBusy(true); setMessage('図を出力しています。');
    try {
      if (copy && (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined')) throw new Error('このブラウザーでは画像をコピーできません。PNGを保存してPowerPointへ挿入できます。');
      const pending = fetch('/api/diagram-export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: captured, format }) }).then(async response => {
        if (!response.ok) throw new Error((await response.json()).error || '図を出力できませんでした。');
        return response.blob();
      });
      // A rejected clipboard request must not leave a pending fetch rejection unhandled.
      void pending.catch(() => {});
      if (copy) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pending })]);
      }
      const blob = await pending;
      if (format === 'png' || format === 'drawio.png') setPreview({ url: URL.createObjectURL(blob), title: captured.title });
      if (!copy) { const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = diagramFilename(captured.title, format); link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); }
      setMessage(copy ? '画像をコピーしました。PowerPointで貼り付けできます。' : `「${captured.title}」の${format}を出力しました。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '図を出力できませんでした。'); }
    finally { setBusy(false); }
  }
  return <details className="diagram-export" aria-label="図の出力"><summary>この図を出力</summary>
    <p>{model.scope.label}・{model.scope.state}</p><p>表示中のまとまりと関係を出力します。推定・未確認の内容も残ります。</p>
    <div className="diagram-export-actions"><button disabled={busy || !model.view.nodes.length} onClick={() => void output('png', true)}>画像をコピー（PowerPoint）</button>
      <button disabled={busy || !model.view.nodes.length} onClick={() => void output('png')}>PNGを保存</button>
      <button disabled={busy || !model.view.nodes.length} onClick={() => void output('drawio.png')}>drawio.pngを保存</button>
      <button disabled={busy || !model.view.nodes.length} onClick={() => void output('svg')}>SVGを保存（拡大用）</button></div>
    <p>drawio.pngは画像として貼れます。draw.ioで開くと、図形と矢印を編集できます。</p>
    <details><summary>編集・連携用のデータ</summary><div className="diagram-export-actions"><button disabled={busy} onClick={() => void output('drawio')}>draw.ioの図を保存</button><button disabled={busy} onClick={() => void output('json')}>構造データを保存</button></div></details>
    {!!model.checks.length && <details><summary>図で確認する点・{model.checks.length}件</summary>{model.checks.map((check, index) => <p key={index}>{check.message}</p>)}<p>構造の確認項目です。業務の説明が正しいかは、原文と合わせて確認できます。</p></details>}
    {message && <p role="status">{message}</p>}{preview && <details><summary>出力した画像を見る</summary><img src={preview.url} alt={`${preview.title}の出力画像`} /></details>}
  </details>;
}
