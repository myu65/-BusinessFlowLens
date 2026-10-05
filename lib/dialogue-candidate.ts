import type {ExtractionReview,FollowUpAnswer,Workflow} from './graph';
import {addReviewNote,appendReviewSource,type ReviewInsertion} from './review-addition';
import {reviewedWorkflowName} from './input-knowledge';
import type {InputDraft} from './review-workbench';

/** A reading of an added fragment must never replace answers about the existing work. */
export function dialogueCandidate(args:{action:'insert'|'refine';workflow:Workflow;before:ExtractionReview;source:string;evidence:string;answers:FollowUpAnswer[];placement:ReviewInsertion;noteId:string;extracted:{review:ExtractionReview;provider:string;followUpAnswers?:FollowUpAnswer[]}}):InputDraft{
  const {action,workflow,before,source,evidence,answers,placement,noteId,extracted}=args;
  const review=action==='insert'
    ?addReviewNote(before,extracted.review,placement,evidence,noteId).review
    :{...extracted.review,documentEvidence:before.documentEvidence};
  return {
    workflow:action==='insert'?workflow:{...workflow,name:reviewedWorkflowName(workflow,review,before.organization?.title)},
    review,baseline:before,sourceNotes:action==='insert'?appendReviewSource(source,evidence):source,
    provider:extracted.provider,answers:{},
    answerHistory:action==='insert'?answers:extracted.followUpAnswers??answers,
  };
}
