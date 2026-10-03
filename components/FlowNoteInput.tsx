"use client";
import { useRef, useState } from "react";
import type { LensGraph } from "@/lib/graph";
import { applyFlowAddition, type FlowAddition } from "@/lib/flow-note";

export function FlowNoteInput({
  graph,
  workflowId,
  afterStepId,
  onApply,
  onAdded,
}: {
  graph: LensGraph;
  workflowId: string;
  afterStepId: string;
  onApply: (graph: LensGraph) => void;
  onAdded: (id: string) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [undo, setUndo] = useState<{
    before: LensGraph;
    after: LensGraph;
    anchor: string;
  } | null>(null);
  const current = useRef(graph);
  current.current = graph;
  const add = async () => {
    const before = current.current;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/flow-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          graph: before,
          workflowId,
          afterStepId,
          note,
          id: crypto.randomUUID(),
        }),
      });
      const result = (await response.json()) as {
        plan?: FlowAddition;
        error?: string;
      };
      if (!response.ok || !result.plan)
        throw new Error(result.error ?? "追加できませんでした");
      if (current.current !== before)
        throw new Error(
          "整理中に内容が変わりました。変更を保つため、もう一度追加してください。",
        );
      const after = applyFlowAddition(before, result.plan);
      onApply(after);
      setUndo({ before, after, anchor: afterStepId });
      setNote("");
      setWarnings(result.plan.warnings);
      setMessage(
        `${result.plan.stepIds.length}手順を接続しました。追加内容は要確認として保存されます。`,
      );
      onAdded(result.plan.stepIds[0]);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "追加できませんでした",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="flow-note">
      <summary>この手順の後に、メモを追加してつなぐ</summary>
      <p>
        今選んでいる手順の続きとして、作業を書いて追加します。道具名と情報名から接続するので、図を描いたりIDを選ぶ必要はありません。
      </p>
      <label className="kg-edit-field">
        追加する作業・情報の受渡し
        <textarea
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
          placeholder="例：営業担当がExcelから「受注確認リスト」をTeamsへ手動で転記する。"
        />
      </label>
      <p>
        情報名は「
        」で囲むと接続できます。担当や自動処理が不明な部分は、要確認として残します。
      </p>
      <button disabled={busy || !note.trim()} onClick={() => void add()}>
        {busy ? "整理して接続しています…" : "追加してつなぐ"}
      </button>
      {undo && (
        <button
          disabled={busy || current.current !== undo.after}
          onClick={() => {
            onApply(undo.before);
            setUndo(null);
            setMessage("追加前の状態に戻しました。");
            onAdded(undo.anchor);
          }}
        >
          直前の追加を取り消す
        </button>
      )}
      {message && <p role="status">{message}</p>}
      {warnings.length > 0 && (
        <details>
          <summary>追加時の確認事項（{warnings.length}件）</summary>
          {warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </details>
      )}
    </details>
  );
}
