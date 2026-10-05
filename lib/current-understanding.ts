import type { ExtractionQuestion, ExtractionReview, LensGraph } from './graph';
import {normalizeAssetName} from './asset-identity';

export type ReadingHistory = { summary: string; reason: string; evidence: string };
export type QuestionReview = {
  id: string; question: ExtractionQuestion; state: 'resolved' | 'reopened';
  evidence: string; reviewedAt: string; origin: 'human';
};

/** Logical question identity. A paraphrased or broader question stays unconfirmed. */
export const reviewQuestionId = (question: ExtractionQuestion) =>
  `question:${question.target}:${question.question.normalize('NFKC').trim()}`;

export function latestQuestionReviews(review: ExtractionReview) {
  return [...new Map((review.questionReviews ?? []).map(item => [item.id, item])).values()];
}

export function reviewQuestion(review: ExtractionReview, id: string, state: QuestionReview['state'], evidence: string, reviewedAt: string): ExtractionReview {
  if (!evidence.trim()) throw new Error('確認した内容を言葉で残してください。');
  const question = state === 'resolved'
    ? review.questions.find(q => reviewQuestionId(q) === id)
    : latestQuestionReviews(review).find(q => q.id === id && q.state === 'resolved')?.question;
  if (!question) throw new Error('確認事項が変わっています。いまの質問をもう一度選んでください。');
  return {
    ...review,
    questions: state === 'resolved' ? review.questions.filter(q => reviewQuestionId(q) !== id)
      : [...review.questions.filter(q => reviewQuestionId(q) !== id), question],
    questionReviews: [...(review.questionReviews ?? []), { id, question, state, evidence: evidence.trim(), reviewedAt, origin: 'human' }],
  };
}

/** Human review is independent of extraction. Do not resolve by name matching. */
export function retainQuestionReviews(review: ExtractionReview, previous: ExtractionReview): ExtractionReview {
  const questionReviews = [...new Map([...(previous.questionReviews ?? []), ...(review.questionReviews ?? [])]
    .map(item => [JSON.stringify(item), item])).values()];
  const previousOpen=new Set(previous.questions.map(reviewQuestionId));
  const resolved = new Set(latestQuestionReviews({ ...review, questionReviews }).filter(q => q.state === 'resolved'&&!previousOpen.has(q.id)).map(q => q.id));
  return { ...review, questionReviews, questions: review.questions.filter(q => !resolved.has(reviewQuestionId(q))) };
}

/** Describe registered work, not an invented end-to-end sequence or successful outcome. */
export function summaryFromStructure(review: ExtractionReview): string {
  if (!review.steps.length) return '図に登録された手順はまだありません。';
  const steps = [...review.steps].sort((a, b) => a.order - b.order);
  const work = steps.slice(0, 3).map(step => `${step.actor ? `${step.actor}による` : '担当が未確認の'}「${step.name}」`).join('、');
  const tools = [...new Set(steps.flatMap(step => [...step.systems.map(s => s.name), ...(step.executingSystem ? [step.executingSystem] : [])]))];
  const data=[...new Set(steps.flatMap(step=>step.data.map(item=>item.name)))];
  const result = `図に登録されている作業は${work}${steps.length > 3 ? `など、計${steps.length}手順` : ''}です。`;
  return result + (tools.length ? `関係する道具は${tools.slice(0, 5).join('・')}${tools.length > 5 ? `など${tools.length}件` : ''}です。` : '使う道具は未確認です。')
    + (data.length?`扱う情報は${data.slice(0,5).join('・')}${data.length>5?`など${data.length}件`:''}です。`:'')
    + (steps.length > 1 ? '作業の前後・条件・戻り先は、図の矢印で確認できます。' : '');
}

export function withCurrentExplanation(review: ExtractionReview, previous: ExtractionReview, reason: string, evidence: string): ExtractionReview {
  const summary = summaryFromStructure(review);
  const history = [...(previous.readingHistory ?? []), ...(review.readingHistory ?? [])];
  for (const old of [previous.summary, review.summary]) if (old && old !== summary)
    history.push({ summary: old, reason, evidence });
  return { ...review, summary, summaryBasis: 'structure', readingHistory: [...new Map(history.map(h => [JSON.stringify(h), h])).values()] };
}

export function reviewStructureChanged(before: ExtractionReview, after: ExtractionReview) {
  return ['steps', 'transitions', 'dataFlows', 'handoffs', 'incomingHandoffs'].some(key =>
    JSON.stringify(before[key as keyof ExtractionReview]) !== JSON.stringify(after[key as keyof ExtractionReview]));
}

/** Only a recorded human rename/identity decision can canonicalize an old name. */
export function applyConfirmedAssetNames(review:ExtractionReview,graph:LensGraph):ExtractionReview{
  const used=new Map<string,string>();
  const name=(kind:'system'|'data',value:string)=>{
    const matches=graph.nodes.filter(node=>node.kind===kind&&node.humanEdits?.some(edit=>edit.field==='identity'||edit.field==='label')
      &&[node.label,...node.aliases??[]].some(alias=>normalizeAssetName(alias)===normalizeAssetName(value)));
    if(matches.length!==1)return value;
    if(matches[0].label!==value)used.set(matches[0].id,(matches[0].humanEdits??[]).filter(edit=>edit.field==='identity'||edit.field==='label').map(edit=>edit.evidence).join('\n'));
    return matches[0].label;
  };
  const aligned={...review,
    steps:review.steps.map(step=>({...step,executingSystem:step.executingSystem?name('system',step.executingSystem):step.executingSystem,
      systems:step.systems.map(system=>({...system,name:name('system',system.name)})),data:step.data.map(data=>({...data,name:name('data',data.name)}))})),
    dataFlows:review.dataFlows.map(flow=>({...flow,sourceSystem:name('system',flow.sourceSystem),targetSystem:name('system',flow.targetSystem),data:flow.data.map(data=>name('data',data))})),
    handoffs:review.handoffs?.map(handoff=>({...handoff,data:handoff.data.map(data=>name('data',data))})),
    incomingHandoffs:review.incomingHandoffs?.map(handoff=>({...handoff,data:handoff.data.map(data=>name('data',data))})),
    systemProfiles:review.systemProfiles?.map(profile=>({...profile,name:name('system',profile.name)})),
    systemDependencies:review.systemDependencies?.map(dependency=>({...dependency,system:name('system',dependency.system),prerequisite:name('system',dependency.prerequisite)})),
  };
  return used.size?withCurrentExplanation(aligned,review,'人が確認したシステム・情報の呼び名を保持',[...used.values()].join('\n')):aligned;
}
