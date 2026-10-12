import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InputDialogue } from '../components/InputDialogue';
import { InputWorkbench } from '../components/InputWorkbench';
import { InputInsertionComposer } from '../components/InputInsertionComposer';
import { focusedDialogueQuestion, appendDialogueAnswer } from '../lib/input-dialogue';
import { extractGroundedLocal } from '../lib/local-review';
import { previewReviewGraph } from '../lib/review-workbench';
import { emptyDialoguePlan } from '../lib/dialogue-operations';

const source='品質担当がExcelで検査値を確認する。LIMSが規格と照合する。';
const review=extractGroundedLocal(source);
review.questions=[{question:'承認するのは誰ですか？',reason:'承認担当は書かれていません。',target:'owner'},
  {question:'承認結果はどこへ残しますか？',reason:'承認記録は不明です。',target:'data'}];
const workflow={id:'quality',name:'検査結果を確認する'};
const blank={workflows:[],nodes:[],edges:[],dataFlows:[]};
const props={source,onSource:()=>{},review,history:[],answers:{[review.questions[0].question]:'品質責任者です。'},onAnswerText:()=>{},
  onStart:async()=>true,onAnswer:async()=>true,onDefer:()=>{},correctionText:'受取担当は購買です。',onCorrectionText:()=>{},
  correctionScope:'all',onCorrectionScope:()=>{},onCorrectIndex:()=>{},onCorrection:async()=>true,busy:false,blockedReason:''};

test('answering and conversation display one composer, with independent draft text and an explicit target',()=>{
  const before=JSON.stringify(props);
  const change=renderToStaticMarkup(createElement(InputDialogue,{...props,focus:{kind:'change'},onFocus:()=>{}}));
  const answer=renderToStaticMarkup(createElement(InputDialogue,{...props,focus:{kind:'question',question:review.questions[0].question},onFocus:()=>{}}));
  assert.equal((change.match(/<textarea/g)??[]).length,1);
  assert.equal((answer.match(/<textarea/g)??[]).length,1);
  assert.match(change,/受取担当は購買です。<\/textarea>/);
  assert.match(answer,/品質責任者です。<\/textarea>/);
  assert.match(answer,/承認するのは誰ですか？/);
  assert.match(answer,/話を足す・直す · 書きかけ/);
  assert.equal(JSON.stringify(props),before);
});

test('question focus follows a selected deferred question, but cannot answer a removed question',()=>{
  const history=appendDialogueAnswer([],review.questions[0].question,'まだ分からない','deferred');
  assert.equal(focusedDialogueQuestion(review.questions,history)?.question,review.questions[1].question);
  assert.equal(focusedDialogueQuestion(review.questions,history,review.questions[0].question)?.question,review.questions[0].question);
  assert.equal(focusedDialogueQuestion([review.questions[1]],history,review.questions[0].question)?.question,review.questions[1].question);
  assert.equal(focusedDialogueQuestion([],history,review.questions[0].question),undefined);
});

test('workbench has one search and routes the question list to the composer; operation clarification replaces ordinary conversation',()=>{
  const graph=previewReviewGraph(blank,workflow,review);
  const common={projectId:'qa',graph,selectedId:workflow.id,onSelect:()=>{},transcripts:{quality:source},onTranscripts:()=>{},drafts:{},onDraft:()=>{},onGraphApply:()=>{}};
  const html=renderToStaticMarkup(createElement(InputWorkbench,common));
  assert.equal((html.match(/aria-label="メモ一覧を検索"/g)??[]).length,1);
  assert.equal((html.match(/aria-label="対話からの補足・訂正"/g)??[]).length,1);
  const questionList=html.split('class="input-questions"')[1]?.split('</details>')[0];
  assert.ok(questionList);
  assert.doesNotMatch(questionList,/<textarea/);
  assert.match(questionList,/この確認に答える/);
  assert.doesNotMatch(html,/保存した話・下書きに戻る|分かったことを足す|流れへの補足・訂正/);
  const draft={workflow,review,sourceNotes:source,baseline:review,provider:'test',answers:{},answerHistory:[],dialogueSession:{turns:[],plan:emptyDialoguePlan('対象を確認する','どの手順をつなぎますか？')}};
  const asked=renderToStaticMarkup(createElement(InputWorkbench,{...common,drafts:{quality:draft}}));
  assert.match(asked,/aria-label="操作案への返答"/);
  assert.doesNotMatch(asked,/aria-label="対話からの補足・訂正"/);
});

test('insertion retains its place and needs an explicit branch before submitting',()=>{
  const branches={...review,transitions:[{fromStepKey:review.steps[0].stepKey,toStepKey:review.steps[1].stepKey,condition:'規格内',evidence:'規格内なら続ける',certainty:'confirmed' as const}]};
  const html=renderToStaticMarkup(createElement(InputInsertionComposer,{review:branches,insertion:{afterStepKey:review.steps[0].stepKey},note:'物流担当が確認する。',busy:false,inputRef:React.createRef<HTMLTextAreaElement>(),onNote:()=>{},onPlacement:()=>{},onSubmit:async()=>{},onPause:()=>{},onCancel:()=>{}}));
  assert.equal((html.match(/<textarea/g)??[]).length,1);
  assert.match(html,/どの続きに追加しますか？/);
  assert.match(html,/<button[^>]*type="submit"[^>]*disabled/);
  assert.match(html,/規格内/);
  assert.match(html,/ここに作業を追加/);
});
