import type {ExtractionReview,ExtractionTransition} from './graph';

export const transitionKey=(edge:ExtractionTransition)=>JSON.stringify([edge.fromStepKey,edge.toStepKey,edge.condition?.trim()||null]);
const value=(edge:ExtractionTransition)=>({fromStepKey:edge.fromStepKey,toStepKey:edge.toStepKey,condition:edge.condition,holdEffect:edge.holdEffect,certainty:edge.certainty,sourceVariant:edge.sourceVariant});
const snapshot=(review:ExtractionReview,edge:ExtractionTransition)=>({...value(edge),fromName:review.steps.find(step=>step.stepKey===edge.fromStepKey)?.name,toName:review.steps.find(step=>step.stepKey===edge.toStepKey)?.name,evidence:edge.evidence,sourceRefs:edge.sourceRefs});
const unique=(edges:ExtractionTransition[])=>[...new Map(edges.map(edge=>[transitionKey(edge),edge])).values()];

/** A human graph operation, kept separately from the literal source. */
export function changeReviewConnection(review:ExtractionReview,previous:ExtractionTransition|null,next:ExtractionTransition|null):ExtractionReview{
  if(!previous&&!next)throw new Error('接続を選んでください。');
  if(previous&&!review.transitions.some(edge=>transitionKey(edge)===transitionKey(previous)))throw new Error('接続が変わりました。もう一度選んでください。');
  if(next&&(!review.steps.some(step=>step.stepKey===next.fromStepKey)||!review.steps.some(step=>step.stepKey===next.toStepKey)))throw new Error('この業務の手順を選んでください。');
  const accepted=next?{...next,condition:next.condition?.trim()||null,sourceVariant:undefined,sourceRefs:next.sourceRefs??previous?.sourceRefs,
    evidence:next.evidence.trim()||'利用者が図の上で接続を確認',
    humanEdits:[...(previous?.humanEdits??next.humanEdits??[]),{field:'connection',before:previous?snapshot(review,previous):null,after:snapshot(review,{...next,sourceVariant:undefined}),evidence:next.evidence.trim()||'利用者が図の上で接続を確認'}]}:null;
  const removal=previous&&(!accepted||transitionKey(previous)!==transitionKey(accepted))?{
    ...previous,humanEdits:[...(previous.humanEdits??[]),{field:'connection',before:snapshot(review,previous),after:null,evidence:'利用者が図の上でこの接続を除外'}],
  }:null;
  return {...review,
    transitions:unique([...review.transitions.filter(edge=>(!previous||transitionKey(edge)!==transitionKey(previous))&&(!accepted||transitionKey(edge)!==transitionKey(accepted))),...(accepted?[accepted]:[])]),
    excludedTransitions:unique([...(review.excludedTransitions??[]),...(removal?[removal]:[])]).filter(edge=>!accepted||transitionKey(edge)!==transitionKey(accepted)),
  };
}

export function recordConnectionEdits(before:ExtractionReview,after:ExtractionReview):ExtractionReview{
  let review={...after,excludedTransitions:unique([...(before.excludedTransitions??[]),...(after.excludedTransitions??[])])};
  for(const edge of before.transitions.filter(old=>!after.transitions.some(next=>transitionKey(old)===transitionKey(next)))){
    review.excludedTransitions=unique([...review.excludedTransitions,{...edge,humanEdits:[...(edge.humanEdits??[]),{field:'connection',before:snapshot(before,edge),after:null,evidence:'利用者が接続の編集でこの矢印を除外'}]}]);
  }
  for(const edge of after.transitions){
    const old=before.transitions.find(old=>transitionKey(old)===transitionKey(edge));
    if(!old||JSON.stringify(value(old))!==JSON.stringify(value(edge)))review=changeReviewConnection(review,old??null,edge) as typeof review;
  }
  return review;
}
