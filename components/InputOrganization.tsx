"use client";
import type { ExtractionReview } from "@/lib/graph";

export function InputOrganization({
  review,
  busy,
  onChange,
}: {
  review: ExtractionReview;
  busy: boolean;
  onChange: (r: ExtractionReview) => void;
}) {
  const grouping = review.organization;
  if (!grouping) return null;
  const update = (field: "title" | "activity" | "capability", value: string) =>
    onChange({
      ...review,
      organization: {
        ...grouping,
        [field]: value,
        origin: "human",
        // Editing a label does not confirm every AI-proposed classification.
        certainty: grouping.certainty,
        evidence:
          grouping.origin === "human"
            ? grouping.evidence
            : `利用者が整理案の${{ title: "題名", activity: "会社の活動", capability: "仕事の種類" }[field]}を訂正。元の根拠：${grouping.evidence}`,
      },
    });
  return (
    <aside className="input-organization" aria-label="この話のまとまり">
      <div>
        <strong>{grouping.title || "題名は未確認"}</strong>
        <small>
          {grouping.origin === "human"
            ? "人が訂正したまとまり"
            : grouping.origin === "existing"
              ? "既存の分類を保持"
              : grouping.certainty === "confirmed"
                ? "原文にあるまとまり"
                : "整理案・要確認"}
        </small>
      </div>
      <p>
        会社の活動：{grouping.activity || "まだ分類していません"}
        {grouping.capability && <> → 仕事の種類：{grouping.capability}</>}
      </p>
      <details>
        <summary>題名・まとまりを確かめて直す</summary>
        <p>
          話を会社のどこへ置くかの整理案です。業務の順序や組織の上下関係を示すものではありません。
          活動や仕事の種類を空欄にすると、分類を決めずに保存できます。
        </p>
        <blockquote>{grouping.evidence || "根拠は未確認"}</blockquote>
        <label className="kg-edit-field">
          話の題名
          <input
            disabled={busy}
            value={grouping.title}
            onChange={(e) => update("title", e.target.value)}
          />
        </label>
        <label className="kg-edit-field">
          会社の活動
          <input
            disabled={busy}
            value={grouping.activity}
            onChange={(e) => update("activity", e.target.value)}
          />
        </label>
        <label className="kg-edit-field">
          仕事の種類
          <input
            disabled={busy}
            value={grouping.capability}
            onChange={(e) => update("capability", e.target.value)}
          />
        </label>
      </details>
    </aside>
  );
}
