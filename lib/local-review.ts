import type { ExtractionReview, TechnicalDetail } from "./graph";
import { preserveRefinements } from "./refinement";

function technicalDetail(text: string, system: string): TechnicalDetail | null {
  const field = (pattern: RegExp) => text.match(pattern)?.[1]?.trim() ?? null;
  const module = field(/(?:モジュール|業務領域)\s*[:：=]\s*([^、。;；\n]+)/);
  const transaction = field(
    /(?:トランザクション(?:コード)?|T-?code|アプリ)\s*[:：=]\s*([^、。;；\n]+)/i,
  );
  const hanaArea = field(
    /(?:HANA領域|スキーマ|HANA\s*(?:領域|schema))\s*[:：=]\s*([^、。;；\n]+)/i,
  );
  const objects = field(
    /(?:テーブル|ビュー|オブジェクト)\s*[:：=]\s*([^、。;；\n]+)/,
  );
  return module || transaction || hanaArea || objects
    ? { system, module, transaction, hanaArea, objects, evidence: text }
    : null;
}

// A grounded fallback: sentence segmentation, never SAP domain inference.
export function extractGroundedLocal(
  interview: string,
  previous?: ExtractionReview | null,
): ExtractionReview {
  const sentences = interview
    .split(/[。\n]+/)
    .map((text) => text.trim())
    .filter(Boolean);
  const review: ExtractionReview = {
    summary:
      "入力されたメモを手順の候補として整理しました。順序・担当・詳細は確認しながら補足できます。",
    trigger: null,
    outcome: null,
    steps: sentences.map((text, index) => {
      const systems = [
        ...new Set(
          text.match(
            /(?:SAP(?:\s+S\/4HANA)?|ERP)(?:\s*(?:本番|開発|検証|テスト)(?:環境)?)?|HANA|Excel|WMS|メール/gi,
          ) ?? [],
        ),
      ];
      const detail = technicalDetail(
        text,
        systems.find((name) => /SAP|ERP/i.test(name)) ?? systems[0] ?? "未確認",
      );
      return {
        stepKey: `note-${index + 1}`,
        name: text.length > 30 ? `${text.slice(0, 30)}…` : text,
        order: index + 1,
        actor: null,
        department: null,
        responsiblePerson: null,
        action: text,
        certainty: "inferred" as const,
        evidence: text,
        systems: systems.map((name) => ({
          name,
          interaction: "other" as const,
          evidence: text,
        })),
        data: [],
        technicalDetails: detail ? [detail] : [],
        detailSteps: [],
      };
    }),
    transitions: [],
    dataFlows: [],
    questions: [
      {
        question: "この手順の順序・分岐と、担当者は合っていますか？",
        reason: "原文を区切った候補のため",
        target: "scope",
      },
    ],
    warnings: [
      "AI未接続：原文を区切った候補です。順序や意味は推定しています。技術詳細はラベル付きの明示情報だけを抽出します。",
    ],
  };
  if (!previous?.steps.length) return review;
  // Keep saved human structure; add genuinely new notes for human placement.
  const additions = review.steps.filter(
    (step) =>
      !previous.steps.some(
        (prior) =>
          prior.evidence.includes(step.action) ||
          prior.action.includes(step.action),
      ),
  );
  return preserveRefinements(
    {
      ...previous,
      steps: [
        ...previous.steps,
        ...additions.map((step, index) => ({
          ...step,
          stepKey: `note-added-${previous.steps.length + index + 1}`,
          order: previous.steps.length + index + 1,
        })),
      ],
      warnings: [
        ...new Set([
          ...previous.warnings,
          ...review.warnings,
          ...(additions.length
            ? [
                "追加メモを末尾に配置しました。正しい業務ステップへ移動・編集してください。",
              ]
            : []),
        ]),
      ],
    },
    previous,
  );
}
