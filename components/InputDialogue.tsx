"use client";
import React, { useRef, useState } from 'react';
import type { ExtractionReview, FollowUpAnswer } from '@/lib/graph';
import { dialogueAnswerStatus, dialogueQuestions, focusedDialogueQuestion, type DialogueInputFocus } from '@/lib/input-dialogue';
import type { DialogueSession } from '@/lib/dialogue-operations';

type Props = {
  source: string; onSource: (text: string) => void;
  review: ExtractionReview | null; history: FollowUpAnswer[];
  answers: Record<string, string>; onAnswerText: (question: string, text: string) => void;
  onStart: () => Promise<boolean>; onAnswer: (question: string, text: string) => Promise<boolean>;
  onDefer: (question: string) => void;
  correctionText: string; onCorrectionText: (text: string) => void;
  correctionScope: string; onCorrectionScope: (scope: string) => void; selectedName?: string;
  correctIndex?: number; onCorrectIndex: (index: number | undefined) => void;
  onCorrection: (text: string, correctIndex?: number) => Promise<boolean>;
  focus: DialogueInputFocus; onFocus: (focus: DialogueInputFocus) => void;
  busy: boolean; blockedReason: string;
  operationSession?: DialogueSession;
};

/** Answers and free conversation share one visible composer; switching keeps both drafts. */
export function InputDialogue(props: Props) {
  const { review, history, busy, blockedReason, correctIndex, focus } = props;
  const [notice, setNotice] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const questions = dialogueQuestions(review?.questions ?? [], history);
  const current = focusedDialogueQuestion(review?.questions ?? [], history, focus.question);
  const answering = focus.kind === 'question' && current && correctIndex === undefined;
  const answer = current ? props.answers[current.question] ?? '' : '';
  const disabled = busy || !!blockedReason;
  const corrected = new Set(history.map(a => a.supersedes).filter(Boolean));
  const pendingAnswers = Object.values(props.answers).filter(text => text.trim()).length;

  const entry = (item: FollowUpAnswer, index: number) => <article key={item.id ?? index} className="input-dialogue-entry">
    <small>{dialogueAnswerStatus(item, history)}</small>
    <p className="input-dialogue-question">{item.question}</p>
    {item.reference ? <details><summary>{item.reference.workflowName}の話を補足にした</summary><blockquote>{item.answer}</blockquote></details>
      : <p className="input-dialogue-answer">{item.kind === 'deferred' ? 'まだ分からない。未確認のまま残す。' : item.answer}</p>}
    {item.kind !== 'deferred' && (!item.id || !corrected.has(item.id)) && <button className="input-text-button"
      disabled={disabled || !!props.correctionText.trim()} onClick={() => {
        props.onCorrectIndex(index); props.onFocus({ kind: 'change' });
        props.onCorrectionText(item.reference ? '' : item.answer);
        setNotice('訂正後の回答を書いてください。以前の回答も履歴に残ります。');
        requestAnimationFrame(() => inputRef.current?.focus());
      }}>この回答を訂正する</button>}
  </article>;

  return <section className="input-dialogue" aria-label="図を見ながら対話で整理する">
    {!review ? <>
      <p className="input-dialogue-question">どんな仕事の話ですか？ 一部分から始められます。</p>
      <label className="kg-edit-field">知っていることを書く<textarea aria-label="最初の仕事の話" disabled={busy} value={props.source}
        placeholder="例えば、注文がメールで届いて、誰かが内容を確認しています。細かいことはまだ分かりません。"
        onChange={event => props.onSource(event.target.value)} /></label>
      <button className="button-primary" disabled={busy || !props.source.trim()} onClick={() => void props.onStart()}>図にして確かめる</button>
      <p className="input-growing-hint">名前や担当は、図を見てから補足できます。</p>
    </> : <>
      <nav className="input-composer-intents" aria-label="この流れへの入力">
        <button aria-pressed={!answering} disabled={busy || correctIndex !== undefined} onClick={() => props.onFocus({ ...focus, kind: 'change' })}>
          話を足す・直す{props.correctionText.trim() ? ' · 書きかけ' : ''}
        </button>
        <button aria-pressed={!!answering} disabled={busy || correctIndex !== undefined || !current} onClick={() => props.onFocus({ kind: 'question', question: current?.question })}>
          未確認に答える · {review.questions.length}{pendingAnswers ? ' · 書きかけ' : ''}
        </button>
      </nav>
      <div className="input-composer-body">
        {answering ? <>
          <label className="kg-edit-field">答える確認事項<select aria-label="対話で答える確認事項" disabled={busy}
            value={current.question} onChange={event => props.onFocus({ kind: 'question', question: event.target.value })}>
            {[...questions.ready, ...questions.deferred].map(q => <option key={q.question} value={q.question}>
              {questions.deferred.includes(q) ? '後で確かめる：' : ''}{q.question}{props.answers[q.question]?.trim() ? ' · 書きかけ' : ''}
            </option>)}
          </select></label>
          <p className="input-dialogue-question">{current.question}</p>
          <details><summary>確認が必要な理由</summary><p>{current.reason}</p></details>
        </> : <>
          {correctIndex !== undefined ? <p className="input-dialogue-question">訂正する回答<br />{history[correctIndex]?.question}</p>
            : <label className="kg-edit-field">話す対象<select aria-label="対話で補足・訂正する範囲" disabled={busy}
              value={props.correctionScope} onChange={event => props.onCorrectionScope(event.target.value)}>
              <option value="all">この仕事の流れ全体</option>{props.selectedName && <option value="step">選んだ手順：{props.selectedName}</option>}
            </select></label>}
          <p className="input-growing-hint">続きや訂正を書けます。「この二つをつなぐ」「同じ仕事としてまとめる」というお願いもできます。</p>
        </>}
        <label className="kg-edit-field">{answering ? '分かっていること' : correctIndex !== undefined ? '訂正後の回答' : '足したい話・直したいこと'}
          <textarea ref={inputRef} aria-label={answering ? 'この確認への回答' : '対話からの補足・訂正'} disabled={disabled}
            value={answering ? answer : props.correctionText}
            onChange={event => answering ? props.onAnswerText(current.question, event.target.value) : props.onCorrectionText(event.target.value)}
            placeholder={answering ? '分かっている範囲で答えてください。分からなければ後で確認できます。'
              : '例：受け取るのは購買担当です。／確認の後に、品質担当がLIMSへ結果を入力します。'} />
        </label>
        <div className="input-dialogue-actions">
          <button className="button-primary" disabled={disabled || !(answering ? answer : props.correctionText).trim()} onClick={async () => {
            const applied = answering ? await props.onAnswer(current.question, answer) : await props.onCorrection(props.correctionText, correctIndex);
            if (applied) { props.onCorrectIndex(undefined); if (answering) props.onFocus({ kind: 'question' }); setNotice('図と変更内容を確かめてから保存できます。'); }
          }}>{answering ? '回答を図に反映する' : correctIndex !== undefined ? '訂正を図に反映する' : '変更案を図で確かめる'}</button>
          {answering && !answer.trim() && <button disabled={disabled} onClick={() => {
            props.onDefer(current.question);
            props.onFocus(questions.ready.length<=1?{kind:'change',question:current.question}:{kind:'question'});
            setNotice('未確認のまま残しました。分かったときに回答できます。');
          }}>まだ分からない</button>}
          {(answering ? !!answer.trim() : !!props.correctionText.trim() || correctIndex !== undefined) && <button disabled={busy} onClick={() => {
            if (answering) props.onAnswerText(current.question, ''); else { props.onCorrectionText(''); props.onCorrectIndex(undefined); }
            setNotice('書きかけの入力を取り消しました。図とこれまでの話は残っています。');
          }}>書きかけを取り消す</button>}
        </div>
        {blockedReason && <p role="status">{blockedReason}</p>}
        {notice && <p className="input-growing-hint" role="status">{notice}</p>}
      </div>
      {!!history.length && <details className="input-dialogue-history"><summary>これまでの回答・訂正 · {history.length}件</summary>{history.map(entry)}</details>}
      {!!props.operationSession?.turns.length && <details className="input-operation-conversation"><summary>図へのお願いと返答 · {props.operationSession.turns.filter(t => t.role === 'user').length}件</summary>
        {props.operationSession.turns.map(turn => <article key={turn.id}><small>{turn.role === 'user' ? 'あなた' : '図の確認'}{turn.state === 'applied' ? ' · 反映済み' : turn.state === 'cancelled' ? ' · 取り消し' : ''}</small><p>{turn.text}</p></article>)}
      </details>}
    </>}
  </section>;
}
