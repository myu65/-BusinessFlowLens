import type { ExtractionReview, ExtractionReviewStep, ExtractionTransition } from './graph';
import { sourceEvidence } from './source-evidence';

const compact = (text: string) => text.normalize('NFKC').replace(/[\s「」『』]/g, '');
const actionName = (text: string) => compact(text).replace(/分析機器/g, '機器').replace(/(?:へ|に)(?=セット)/g, 'へ').replace(/(?:する|します|の)$/, '');
const uncertain = /不明|分から|未確認|未定|予定|検討|戻(?:らない|りません|さない)|再(?:測定|確認|試験|調製)(?:しない|しません|せず)/;

/** Repeating a named earlier check is response work while the result remains held. */
export function statedReworkReturn(review: ExtractionReview, from: ExtractionReviewStep, target: ExtractionReviewStep, edge: ExtractionTransition, source: string): boolean {
  const quote = sourceEvidence(source, edge.evidence), fromQuote = sourceEvidence(source, from.evidence);
  if (!quote || !fromQuote || target.order >= from.order || !sourceEvidence(source, target.evidence)) return false;
  const text = compact(quote);
  if (uncertain.test(text) || !/再調製|作り直|調製し直|再検査|再測定|再確認/.test(fromQuote)) return false;
  const named = text.match(/(?:後は|後、|後に)(.{2,60}?)(?:の)?(?:手順|工程)(?:から|へ|に)/)?.[1]
    ?? text.match(/同じ(.{1,35}?)(?:の)?(?:手順|工程)(?:へ|に)戻/)?.[1];
  if (!named || !/戻|再測定|再確認|再試験|再検査/.test(text)) return false;
  const name = actionName(named);
  const matches = review.steps.filter(step => step.order < from.order && sourceEvidence(source, step.evidence) &&
    (actionName(step.action).includes(name) || actionName(step.name).includes(name)));
  return matches.length === 1 && matches[0].stepKey === target.stepKey;
}

/** A withheld result has not been written; an explicitly recorded incident can still be an output. */
export function discardWithheldResultWrites<T extends ExtractionReview>(review: T, source: string): T {
  const warnings = [...review.warnings];
  const steps = review.steps.map(step => {
    if (step.humanEdits?.some(edit => edit.field === 'data' || edit.field.startsWith('data.'))) return step;
    if (!step.meaning?.halt && !/(?:登録|更新|入力)(?:を|は)(?:保留|停止|止め|行わず|しない|しません)/.test(step.action)) return step;
    const quote = sourceEvidence(source, step.evidence);
    if (!quote) return step;
    const clauses = source.split(/(?<=[。！？\n])/).filter(sentence => sourceEvidence(sentence, quote));
    if (clauses.length !== 1 || !/(?:登録|更新|入力)(?:を|は)(?:保留|停止|止め|行わず|しない|しません)/.test(clauses[0])) return step;
    const clause = clauses[0];
    const data = step.data.filter(item => {
      if (!['create','update'].includes(item.operation)) return true;
      const ownQuote = sourceEvidence(clause, item.evidence);
      const name = compact(item.name).replace(/(?:の)?(?:記録|データ|情報)$/, '');
      const at = ownQuote ? compact(clause).indexOf(compact(ownQuote)) : -1;
      const postponed = at >= 0 && /後(?:は|に|、)|(?:正常|解消|解除|承認|修正).{0,8}(?:したら|されたら|後|になったら)/.test(compact(clause).slice(0,at));
      // Holding a result write does not deny the explicitly performed rework,
      // such as re-preparing the sample itself or rewriting a report.
      const transformed = ownQuote && !/記録|データ|情報$/.test(item.name) && compact(ownQuote).includes(compact(item.name)) &&
        /(?:再調製|再加工)(?:する|します|し(?=[て、。]))|(?:調製し直|作り直)(?:す|します|し(?=[て、。]))/.test(ownQuote) &&
        !/(?:再調製|再加工)(?:しない|しません|せず)|(?:調製し直|作り直)(?:さない|しません|さず)|未確認|未定/.test(ownQuote);
      if (transformed && !postponed) return true;
      if (ownQuote && name && compact(ownQuote).includes(name) && /(?:登録|記録|保存|更新|作成)(?:する|します|した|し(?=[て、。]))/.test(ownQuote) &&
        !postponed && !/(?:登録|更新|入力)(?:を|は)(?:保留|停止|止め|行わず|しない|しません)/.test(ownQuote)) return true;
      warnings.push(`${step.name}：登録を保留する段階では「${item.name}」を更新したと確認できません。更新の候補を外し、作業と原文を残しました。`);
      return false;
    });
    return data.length === step.data.length ? step : { ...step, data };
  });
  return { ...review, steps, warnings: [...new Set(warnings)] };
}
