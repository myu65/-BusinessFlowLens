import type { ExtractionReview } from "../graph";
import { sourceEvidence } from "../source-evidence";
import { splitVisualSource } from "../source-document";

// A matching quote is not a semantic verification of all the model's fields.
// Unmatched proposals remain reviewable, but cannot masquerade as source text.
// Apply this before preserving the user's field corrections.
export function groundStepEvidence<T extends ExtractionReview>(review: T, source: string): T {
  const {literal:literalSource,interpretations} = splitVisualSource(source);
  const warnings = [...review.warnings];
  const steps = review.steps.map(step => {
    const unmatched: string[] = [];
    let interpreted = false;
    const quote = (evidence: string | undefined, label: string, required = true) => {
      const proposal = typeof evidence === "string" ? evidence : "";
      // A model may label its quote with the source block's visual marker.
      // Strip that wrapper only for an exact match inside the AI interpretation,
      // and keep the evidence inferred even if the same phrase occurs in text.
      const labeledVisual = /^\[AI画像解釈[^\]]*\]/.test(proposal);
      const visualQuote = proposal.replace(/^\[AI画像解釈[^\]]*\]\s*/, "").replace(/\s*\[\/AI画像解釈\]$/, "");
      if (labeledVisual && interpretations.some(text => sourceEvidence(text, visualQuote))) { interpreted = true; return visualQuote; }
      const literal = sourceEvidence(literalSource, proposal);
      if (literal) return literal;
      if (interpretations.some(text=>sourceEvidence(text,proposal))) { interpreted = true; return proposal; }
      if (proposal || required) unmatched.push(`${label}：${proposal || "引用未登録"}`);
      return "";
    };
    const evidence = quote(step.evidence, "作業", step.certainty === "explicit");
    const boundaryEvidence = step.boundary && quote(step.boundary.evidence, "社内・社外の範囲", step.boundary.certainty === "confirmed");
    const boundary = step.boundary && { ...step.boundary, evidence: boundaryEvidence || "",
      certainty: (!boundaryEvidence || interpreted) && step.boundary.certainty === "confirmed" ? "inferred" as const : step.boundary.certainty };
    const meaningEvidence = step.meaning && quote(step.meaning.evidence ?? "", "結果",
      step.meaning.certainty === "confirmed");
    const meaning = step.meaning && { ...step.meaning,
      evidence: meaningEvidence,
      certainty: (!meaningEvidence || interpreted) && step.meaning.certainty === "confirmed"
        ? "inferred" as const : step.meaning.certainty,
    };
    const systems = step.systems.map(system => ({ ...system,
      evidence: quote(system.evidence, `道具「${system.name}」`, step.certainty === "explicit"),
    }));
    const data = step.data.map(item => ({ ...item,
      evidence: quote(item.evidence, `情報「${item.name}」`, step.certainty === "explicit"),
    }));
    const technicalDetails = step.technicalDetails?.map(detail => ({ ...detail,
      evidence: quote(detail.evidence ?? "", "システムの詳細", step.certainty === "explicit"),
    }));
    const detailSteps = step.detailSteps?.map(detail => ({ ...detail,
      evidence: quote(detail.evidence ?? "", "個別作業", step.certainty === "explicit"),
    }));
    if (unmatched.length) warnings.push(
      `「${step.name}」のAIの引用を原文で確認できませんでした。${[...new Set(unmatched)].join(" / ")}。一致しない引用は原文として使わず、推定として残しました。原文と見比べて訂正できます。`,
    );
    return { ...step, evidence, meaning, boundary, systems, data, technicalDetails, detailSteps,
      certainty: unmatched.length || interpreted ? "inferred" as const : step.certainty,
    };
  });
  return { ...review, steps, warnings };
}

/** A matching AI interpretation supports a proposal, not a confirmed source relation. */
export function groundVisualRelations<T extends ExtractionReview>(review:T,source:string):T {
  const {literal,interpretations}=splitVisualSource(source);
  const visualOnly=(evidence:string|undefined)=>Boolean(evidence&&!sourceEvidence(literal,evidence)&&interpretations.some(text=>sourceEvidence(text,evidence)));
  const downgrade=<V extends {evidence?:string;certainty?:string}>(value:V):V=>visualOnly(value.evidence)&&value.certainty!=="unknown"?{...value,certainty:"inferred"}:value;
  return {...review,organization:review.organization?downgrade(review.organization):review.organization,
    systemProfiles:review.systemProfiles?.map(downgrade),systemDependencies:review.systemDependencies?.map(downgrade),
    transitions:review.transitions.map(downgrade),dataFlows:review.dataFlows.map(downgrade),handoffs:review.handoffs?.map(downgrade),incomingHandoffs:review.incomingHandoffs?.map(downgrade)};
}
