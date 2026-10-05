import type { ExtractionQuestion, FollowUpAnswer } from './graph';

/** Append an answer without overwriting the words or attribution of an older one. */
export function appendDialogueAnswer(
  history: FollowUpAnswer[], question: string, answer: string,
  kind: NonNullable<FollowUpAnswer['kind']> = 'answer', correctIndex?: number,
): FollowUpAnswer[] {
  if (!question.trim() || (kind !== 'deferred' && !answer.trim())) throw new Error('話または回答を入力してください。');
  const next = [...history];
  let supersedes: string | undefined;
  if (correctIndex !== undefined) {
    const prior = next[correctIndex];
    if (!prior) throw new Error('訂正する回答をもう一度選んでください。');
    supersedes = prior.id ?? crypto.randomUUID();
    next[correctIndex] = { ...prior, id: supersedes };
  }
  return [...next, { id: crypto.randomUUID(), createdAt: new Date().toISOString(),
    kind, question: question.trim(), answer: answer.trim(), ...(supersedes ? { supersedes } : {}) }];
}

export function dialogueQuestions(questions: ExtractionQuestion[], history: FollowUpAnswer[]) {
  const deferred = new Set<string>();
  for (const answer of history) {
    if (answer.kind === 'deferred') deferred.add(answer.question);
    else deferred.delete(answer.question);
  }
  return { ready: questions.filter(q => !deferred.has(q.question)),
    deferred: questions.filter(q => deferred.has(q.question)) };
}

export function dialogueAnswerStatus(answer: FollowUpAnswer, history: FollowUpAnswer[]) {
  if (answer.id && history.some(later => later.supersedes === answer.id)) return '訂正前の回答';
  return answer.kind === 'deferred' ? '未確認のまま残した' : answer.kind === 'correction' ? '訂正した回答' : '回答・補足';
}

/** Literal citation history is wider than the currently effective business facts. */
export function dialogueCitationSource(history: FollowUpAnswer[]) {
  return [...new Set(history.filter(answer => answer.kind !== 'deferred' && !answer.reference)
    .map(answer => answer.answer).filter(Boolean))].join('\n');
}

export function includePendingDialogueAnswers(history: FollowUpAnswer[], pending: Record<string,string>) {
  return Object.entries(pending).reduce((answers,[question,text])=>{
    const latest=answers.filter(a=>a.question===question&&a.kind!=='deferred').at(-1);
    return !text.trim()||latest?.answer.trim()===text.trim()?answers:appendDialogueAnswer(answers,question,text);
  },history);
}
