import type { ExtractionReview } from "../graph";
import { sourceEvidence } from "../source-evidence";

// A matching quote is not a semantic verification of all the model's fields.
// Unmatched proposals remain reviewable, but cannot masquerade as source text.
// Apply this before preserving the user's field corrections.
export function groundStepEvidence<T extends ExtractionReview>(review: T, source: string): T {
  const warnings = [...review.warnings];
  const steps = review.steps.map(step => {
    const unmatched: string[] = [];
    const quote = (evidence: string | undefined, label: string, required = true) => {
      const proposal = typeof evidence === "string" ? evidence : "";
      const literal = sourceEvidence(source, proposal);
      if (literal) return literal;
      if (proposal || required) unmatched.push(`${label}：${proposal || "引用未登録"}`);
      return "";
    };
    const evidence = quote(step.evidence, "作業", step.certainty === "explicit");
    const meaningEvidence = step.meaning && quote(step.meaning.evidence ?? "", "結果",
      step.meaning.certainty === "confirmed");
    const meaning = step.meaning && { ...step.meaning,
      evidence: meaningEvidence,
      certainty: !meaningEvidence && step.meaning.certainty === "confirmed"
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
    return { ...step, evidence, meaning, systems, data, technicalDetails, detailSteps,
      certainty: unmatched.length ? "inferred" as const : step.certainty,
    };
  });
  return { ...review, steps, warnings };
}
