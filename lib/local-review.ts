import type {
  ExtractionReview,
  ExtractionReviewStep,
  FollowUpAnswer,
  LensGraph,
  TechnicalDetail,
} from "./graph";
import { preserveRefinements } from "./refinement";
import { effectiveFollowUpAnswers } from './question-evidence';

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

const systemPattern =
  /(?:SAP(?:\s+S\/4HANA)?|ERP)(?:\s*(?:本番|開発|検証|テスト)(?:環境)?)?|Snowflake|SharePoint|Teams|Outlook|Excel(?:\s*Macro|\s*VBA)?|Access|WMS|MES|LIMS|QMS|PLM|DCS|HANA|メール|ファイルサーバ|Entra ID/gi;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hash = (s: string) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
};
const similarity = (a: string, b: string) => {
  const grams = (s: string) => new Set([...s].slice(1).map((c, i) => s[i] + c));
  const x = grams(a),
    y = grams(b);
  return [...x].filter((c) => y.has(c)).length / Math.max(1, x.size, y.size);
};

// Literal mentions and verbs only. Conditions and sequence remain candidates;
// no SAP rules, results, departments, API protocols or resume points are invented.
export function extractGroundedLocal(
  interview: string,
  previous?: ExtractionReview | null,
  graph?: LensGraph,
  followUpAnswers: FollowUpAnswer[] = [],
): ExtractionReview {
  const sentences = interview
    .split(/[。\n]+/)
    .map((text) => text.trim())
    .filter(Boolean);
  const review: ExtractionReview = {
    summary:
      "原文にある行為・道具・情報を整理しました。接続の推定と未確認の結果を確かめてください。",
    trigger: null,
    outcome: null,
    steps: sentences.map((text, index) => {
      const systems = [...new Set(text.match(systemPattern) ?? [])];
      const detail = technicalDetail(
        text,
        systems.find((name) => /SAP|ERP/i.test(name)) ?? systems[0] ?? "未確認",
      );
      const executingSystem =
        systems.find(
          (name) =>
            text.includes(`${name}が自動`) ||
            text.includes(`${name}は自動`) ||
            new RegExp(`${escape(name)}から.+自動(?:送信|連携)`).test(text),
        ) ?? null;
      const condition =
        text.match(/^(.{1,65}?(?:場合|とき|時|なら|後))[、,]/)?.[1] ??
        text.match(
          /^(.{1,40}?(?:なら|ければ|したら|超えたら|だったら))/,
        )?.[1] ??
        "";
      const main = condition
        ? text
            .slice(condition.length)
            .replace(/^[、,]/, "")
            .trim()
        : text;
      const literalActor =
        main.match(
          /^(.{1,35}?(?:さん|担当者|担当|責任者|部|課|者))(?:が|は)/,
        )?.[1] ?? null;
      const actor = /誰か|担当の人|いい感じ/.test(main) ? null : literalActor;
      const department =
        actor?.match(/([\p{L}\p{N}]+(?:部|課|室))/u)?.[1] ?? null;
      const data: ExtractionReviewStep["data"] = [
        ...text.matchAll(/[「『]([^」』]+)[」』]/g),
      ]
        .filter(
          (m) => !systems.some((s) => s.toLowerCase() === m[1].toLowerCase()),
        )
        .map((m) => {
          const tail = text
            .slice((m.index ?? 0) + m[0].length)
            .split(/[、,「『]/)[0];
          const verb = tail.match(
            /受け取|受信|送信|渡す|転記|作成|確定|決定|記録|登録|更新|入力|修正|参照|確認|読/,
          )?.[0];
          const operation =
            verb && /受け取|受信/.test(verb)
              ? "receive"
              : verb && /送信|渡す|転記/.test(verb)
                ? "send"
                : verb && /作成|確定|決定|記録|登録/.test(verb)
                  ? "create"
                  : verb && /更新|入力|修正/.test(verb)
                    ? "update"
                    : "read";
          return { name: m[1], operation, evidence: text };
        });
      const result =
        main.match(
          /「[^」]+」(?:が|を)(?:確定|決定|判定|保留|更新|作成|登録|解除)(?:する|される|した|された)?/,
        )?.[0] ??
        main.match(
          /(?:価格|出荷可否|納期|在庫|数量|承認結果)(?:が|を)(?:確定|決定|判定|保留|更新|作成|登録|解除)[^、,]*/,
        )?.[0] ??
        main.match(
          /(?:不足|出荷可能|製造が必要)(?:と判断|が分か|と確定|にな)[^、,]*/,
        )?.[0] ??
        "";
      const basis =
        main.match(
          /(.{1,60}?)(?:を根拠に|に基づき|を参照し|を見ながら)/,
        )?.[1] ??
        data
          .filter((d) => ["read", "receive"].includes(d.operation))
          .map((d) => d.name)
          .join("、");
      return {
        stepKey: `note-${hash(text)}-${index}`,
        name: text.length > 30 ? `${text.slice(0, 30)}…` : text,
        order: index + 1,
        actor: actor && !systems.some((s) => actor.includes(s)) ? actor : null,
        department,
        responsiblePerson: actor?.match(/(?:の|^)([^の]+さん)$/)?.[1] ?? null,
        executionMode: executingSystem
          ? ("automatic" as const)
          : /手動|人手/.test(text) ||
              (!!actor && !systems.some((s) => actor.includes(s)))
            ? ("manual" as const)
            : ("unknown" as const),
        executingSystem,
        action: text,
        certainty:
          (actor || executingSystem || data.length) &&
          !/いい感じ|たぶん|かもしれ|曖昧/.test(text)
            ? ("explicit" as const)
            : ("inferred" as const),
        evidence: text,
        systems: systems.map((name) => ({
          name,
          interaction: "other" as const,
          evidence: text,
        })),
        data,
        meaning: {
          purpose: main.match(/(.{1,70}?)(?:ために|ため、)/)?.[1] ?? "",
          basis,
          result,
          next: main.match(/(?:その結果|これにより|→)(.+)$/)?.[1] ?? "",
          condition,
          halt: /(?:保留|停止|差戻|差し戻)/.test(main),
          certainty: "confirmed" as const,
          evidence: text,
        },
        technicalDetails: detail ? [detail] : [],
        detailSteps: [],
      };
    }),
    transitions: [],
    dataFlows: [],
    questions: [
      {
        question: "この手順の順序・分岐と、担当者は合っていますか？",
        reason:
          "記載順の接続は推定です。分岐先・合流先・再開先の記載がない場合は確定しません。",
        target: "scope",
      },
    ],
    warnings: [
      "AI未接続・簡易抽出：行為は原文の明示情報、通常の接続と条件の接続元は推定です。根拠・結果・再開先の未記載部分は未確認のまま残します。",
    ],
  };
  const matched = new Set<string>();
  for (const step of review.steps) {
    const prior = (previous?.steps ?? [])
      .filter((s) => !matched.has(s.stepKey))
      .map((s) => ({
        s,
        score: similarity(s.evidence || s.action, step.evidence),
      }))
      .sort((a, b) => b.score - a.score)[0];
    if (prior && prior.score >= 0.48) {
      step.stepKey = prior.s.stepKey;
      matched.add(prior.s.stepKey);
    }
  }
  let anchor: ExtractionReviewStep | undefined;
  let inBranches = false;
  for (const [i, step] of review.steps.entries()) {
    const condition = step.meaning?.condition;
    if (condition && anchor) {
      review.transitions.push({
        fromStepKey: anchor.stepKey,
        toStepKey: step.stepKey,
        condition,
        evidence: step.evidence,
        certainty: "inferred",
      });
      inBranches = true;
    } else {
      const prior = review.steps[i - 1];
      if (prior && !inBranches && !prior.meaning?.halt)
        review.transitions.push({
          fromStepKey: prior.stepKey,
          toStepKey: step.stepKey,
          condition: null,
          evidence: `${prior.evidence} → ${step.evidence}`,
          certainty: "inferred",
        });
      if (prior && (inBranches || prior.meaning?.halt))
        review.questions.push({
          question: `「${step.name}」へは、どの条件・手順から進みますか？`,
          reason: "分岐の合流または停止後の再開先が未確認",
          target: "handoff",
        });
      inBranches = false;
      anchor = step;
    }
    if (step.meaning?.halt)
      review.questions.push({
        question: `「${step.name}」の保留・差戻し後、誰が解除し、どの手順から再開しますか？`,
        reason: "停止後の接続を通常の次手順として補っていません",
        target: "exception",
      });
    const names = step.systems.map((s) => s.name);
    if (
      names.length >= 2 &&
      /から/.test(step.action) &&
      /転記|送信|連携/.test(step.action)
    ) {
      const pair = names.slice(0, 2);
      const t = step.action;
      if (
        new RegExp(`${escape(pair[0])}から`).test(t) &&
        new RegExp(`${escape(pair[1])}(?:へ|に)`).test(t)
      )
        review.dataFlows.push({
          sourceSystem: pair[0],
          targetSystem: pair[1],
          data: step.data
            .filter((d) => d.operation !== "read" || /転記/.test(t))
            .map((d) => d.name),
          transferType: /API/i.test(t)
            ? "api"
            : /手動|転記/.test(t)
              ? "manual"
              : "unknown",
          direction: "push",
          automation: step.executionMode,
          frequency: null,
          evidence: t,
          certainty: "explicit",
          relatedStepKeys: [step.stepKey],
        });
    }
  }
  if (effectiveFollowUpAnswers(followUpAnswers).some((a) => a.answer.trim()))
    review.warnings.push(
      "追加回答は根拠として保持しています。簡易抽出では自由な回答の解釈を確定できないため、本文への補足または候補の直接訂正で反映してください。",
    );
  review.handoffs = previous?.handoffs?.map((h) => ({
    ...h,
    data: [...h.data],
  }));
  if (graph)
    for (const step of review.steps) {
      const targets = graph.workflows.filter((w) =>
        step.action.includes(w.name),
      );
      if (targets.length === 1 && /依頼|渡|引き継/.test(step.action)) {
        review.handoffs ??= [];
        if (
          !review.handoffs.some(
            (h) =>
              h.fromStepKey === step.stepKey &&
              h.targetWorkflowId === targets[0].id,
          )
        )
          review.handoffs.push({
            fromStepKey: step.stepKey,
            targetWorkflowId: targets[0].id,
            data: step.data.map((d) => d.name),
            description: step.action,
            evidence: step.evidence,
            certainty: "inferred",
          });
      }
    }
  return preserveRefinements(review, previous);
}
