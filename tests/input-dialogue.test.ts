import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendDialogueAnswer, dialogueAnswerStatus, dialogueQuestions, dialogueCitationSource, includePendingDialogueAnswers } from '../lib/input-dialogue';
import { groundStepEvidence } from '../lib/ai/source-grounding';
import { effectiveFollowUpAnswers, scopeReferenceDataFlows } from '../lib/question-evidence';
import { SqliteBusinessFlowRepository } from '../lib/storage/sqlite';
import { extractGroundedLocal } from '../lib/local-review';
import type { ExtractionQuestion, FollowUpAnswer } from '../lib/graph';

const question: ExtractionQuestion = { question: '誰が受け取りますか？', reason: '受取担当は未確認', target: 'owner' };

test('answering one question or rewriting the source also retains pending answers from the other input mode',()=>{
  const history=appendDialogueAnswer([],question.question,'品質担当です。');
  const submitted=includePendingDialogueAnswers(history,{[question.question]:'品質担当です。','使う道具は？':'LIMSです。','不明な欄':''});
  assert.equal(submitted.length,2);
  assert.equal(submitted[1].question,'使う道具は？');
  assert.equal(history.length,1);
  const corrected=appendDialogueAnswer(submitted,question.question,'購買担当です。','correction',0);
  const repeated=includePendingDialogueAnswers(corrected,{[question.question]:'品質課長です。'});
  assert.equal(repeated.at(-1)?.answer,'品質課長です。');
});

test('a corrected dialogue answer preserves its original words and replaces only the selected evidence', () => {
  const initial: FollowUpAnswer[] = [{ question: question.question, answer: '品質担当です。' }, { question: '何で渡しますか？', answer: 'Teamsです。' }];
  const before = structuredClone(initial);
  const corrected = appendDialogueAnswer(initial, question.question, '購買担当です。', 'correction', 0);
  assert.deepEqual(initial, before);
  assert.equal(corrected[0].answer, '品質担当です。');
  assert.equal(corrected[2].supersedes, corrected[0].id);
  assert.deepEqual(effectiveFollowUpAnswers(corrected).map(a => a.answer), ['Teamsです。', '購買担当です。']);
  assert.equal(dialogueAnswerStatus(corrected[0], corrected), '訂正前の回答');
  const again = appendDialogueAnswer(corrected, question.question, '今回は品質課長です。', 'correction', 2);
  assert.deepEqual(effectiveFollowUpAnswers(again).map(a => a.answer), ['Teamsです。', '今回は品質課長です。']);
});

test('deferring a question does not supply source evidence or remove an unknown, and answering brings it back into review', () => {
  const later = { ...question, question: '承認をどこに記録しますか？', target: 'data' as const };
  const history = appendDialogueAnswer([], question.question, 'まだ分からない', 'deferred');
  assert.deepEqual(effectiveFollowUpAnswers(history), []);
  assert.deepEqual(dialogueQuestions([question, later], history), { ready: [later], deferred: [question] });
  const answered = appendDialogueAnswer(history, question.question, '購買担当です。');
  assert.deepEqual(dialogueQuestions([question, later], answered), { ready: [question, later], deferred: [] });
  assert.equal(history[0].kind, 'deferred');
});

test('correcting a referenced answer retains the source snapshot but uses the new human answer', () => {
  const reference: FollowUpAnswer = { question: question.question, answer: '品質担当が受け取る。', reference: { workflowId: 'neighbor', workflowName: '成績書の受取', usedAt: '2026-10-05T00:00:00Z' } };
  const history = appendDialogueAnswer([reference], question.question, 'この工場では購買担当です。', 'correction', 0);
  assert.deepEqual(history[0].reference, reference.reference);
  assert.equal(history[0].answer, reference.answer);
  assert.equal(effectiveFollowUpAnswers(history).length, 1);
  assert.equal(effectiveFollowUpAnswers(history)[0].reference, undefined);
  assert.throws(() => appendDialogueAnswer(history, question.question, '', 'correction', 0));
  assert.throws(() => appendDialogueAnswer(history, question.question, '訂正', 'correction', 99));
});

test('a preserved older quote is a valid historical citation without becoming active evidence again', () => {
  const old='購買担当がOutlookで成績書を確認する。';
  let history=appendDialogueAnswer([],question.question,old);
  history=appendDialogueAnswer(history,question.question,'品質担当がOutlookで成績書を確認する。','correction',0);
  history=appendDialogueAnswer(history,'承認先は？','まだ分からない','deferred');
  const candidate=extractGroundedLocal(old);
  const grounded=groundStepEvidence(candidate,dialogueCitationSource(history));
  assert.equal(grounded.steps[0].evidence,candidate.steps[0].evidence);
  assert(!grounded.warnings.some(w=>w.includes('引用を原文で確認できません')));
  assert(!effectiveFollowUpAnswers(history).some(a=>a.answer===old));
  assert(!dialogueCitationSource(history).includes('まだ分からない'));
});

test('superseded transfer evidence cannot be reimported from a neighboring workflow', () => {
  const graph = { workflows: [{ id: 'current', name: 'この仕事' }], nodes: [], edges: [], dataFlows: [] };
  const review = extractGroundedLocal('担当者が確認する。');
  const flow = { sourceSystem: 'SAP', targetSystem: 'Excel', data: ['受注記録'], transferType: 'file' as const, direction: 'push' as const,
    automation: 'manual' as const, frequency: null, evidence: 'SAPから受注記録をExcelへ転記する', certainty: 'explicit' as const, relatedStepKeys: [] };
  review.dataFlows = [flow];
  let history = appendDialogueAnswer([], '転記するか', flow.evidence);
  history = appendDialogueAnswer(history, '転記するか', '転記しません。', 'correction', 0);
  history.push({ question: '関連する話', answer: '隣の業務だけでSAPからExcelへ転記する。', reference: { workflowId: 'peer', workflowName: '隣の業務', usedAt: '' } });
  assert.equal(scopeReferenceDataFlows(review, graph, 'current', '担当者が確認する。', history).dataFlows.length, 0);
});

test('dialogue corrections and deferred questions survive project and revision persistence with original source', async () => {
  const repository = new SqliteBusinessFlowRepository(join(mkdtempSync(join(tmpdir(), 'bfl-dialogue-')), 'test.sqlite'));
  const source = '届いた成績書を誰かが確認する。';
  const review = extractGroundedLocal(source); review.questions = [question];
  let history = appendDialogueAnswer([], question.question, '品質担当です。');
  history = appendDialogueAnswer(history, question.question, '購買担当です。', 'correction', 0);
  history = appendDialogueAnswer(history, '承認先は？', 'まだ分からない', 'deferred');
  const workflow = { id: 'test', name: '成績書を確認する', reviewContext: { summary: review.summary, trigger: review.trigger, outcome: review.outcome, questions: review.questions, warnings: [], followUpAnswers: history } };
  await repository.saveProject({ projectId: 'test', projectName: '対話の検証', graph: { workflows: [workflow], nodes: [], edges: [], dataFlows: [] }, transcripts: { test: source }, updatedAt: new Date().toISOString() });
  const revision = await repository.appendWorkflowRevision({ projectId: 'test', workflowId: 'test', workflowName: workflow.name, sourceNotes: source,
    followUpAnswers: history, review, updatedBy: 'test', createdAt: new Date().toISOString() });
  assert.deepEqual((await repository.loadProject('test'))?.graph.workflows[0].reviewContext?.followUpAnswers, history);
  assert.deepEqual((await repository.getWorkflowRevision('test', revision.id))?.followUpAnswers, history);
  assert.equal((await repository.loadProject('test'))?.transcripts.test, source);
});
