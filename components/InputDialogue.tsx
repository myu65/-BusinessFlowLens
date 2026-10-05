"use client";
import React, { useEffect, useRef, useState } from 'react';
import type { ExtractionReview, FollowUpAnswer } from '@/lib/graph';
import { dialogueAnswerStatus, dialogueQuestions } from '@/lib/input-dialogue';
import type {DialogueSession} from '@/lib/dialogue-operations';

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
  busy: boolean; blockedReason: string;
  operationSession?:DialogueSession;
};

export function InputDialogue(props: Props) {
  const { review, history, busy, blockedReason } = props;
  const [questionText, setQuestionText] = useState('');
  const [composing, setComposing] = useState(false);
  const {correctIndex,onCorrectIndex:setCorrectIndex}=props;
  const [notice, setNotice] = useState('');
  const historyRef=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{if(props.correctionText.trim())setComposing(true);},[props.correctionText]);
  useEffect(()=>{if(!props.correctionText.trim()){setComposing(false);setCorrectIndex(undefined);}},[review]);
  useEffect(()=>{if(props.operationSession?.plan?.action==='ask'&&props.operationSession.plan.question)setComposing(true);},[props.operationSession?.plan]);
  const questions = dialogueQuestions(review?.questions ?? [], history);
  const current = review?.questions.find(q => q.question === questionText) ?? questions.ready[0];
  const answer = current ? props.answers[current.question] ?? '' : '';
  const disabled = busy || !!blockedReason;
  const corrected = new Set(history.map(a => a.supersedes).filter(Boolean));

  const entry = (item: FollowUpAnswer, index: number) => <article key={item.id ?? index} className="input-dialogue-entry">
    <small>{dialogueAnswerStatus(item, history)}</small>
    <p className="input-dialogue-question">{item.question}</p>
    {item.reference ? <details><summary>{item.reference.workflowName}の話を補足にした</summary><blockquote>{item.answer}</blockquote></details>
      : <p className="input-dialogue-answer">{item.kind === 'deferred' ? 'まだ分からない。未確認のまま残す。' : item.answer}</p>}
    {item.kind !== 'deferred' && (!item.id || !corrected.has(item.id)) && <button className="input-text-button"
      disabled={disabled || !!props.correctionText.trim()} onClick={() => { setCorrectIndex(index); setComposing(true); props.onCorrectionText(item.reference ? '' : item.answer); setNotice('訂正後の内容を入力してください。以前の回答も履歴に残ります。'); }}>この回答を訂正する</button>}
  </article>;

  return <section className="input-dialogue" aria-label="図を見ながら対話で整理する">
    {!review ? <>
      <p className="input-dialogue-question">どんな仕事の話ですか？ 一部分だけで大丈夫です。</p>
      <label className="kg-edit-field">まず知っていることを話す<textarea aria-label="最初の仕事の話" disabled={busy} value={props.source}
        placeholder="例えば、注文がメールで届いて、誰かが内容を確認しています。細かいことはまだ分かりません。"
        onChange={event => props.onSource(event.target.value)} /></label>
      <button className="button-primary" disabled={busy || !props.source.trim()} onClick={() => void props.onStart()}>話から流れを作る</button>
      <p className="input-growing-hint">まず図で確認します。分からない箇所は、あとから一つずつ補足できます。</p>
    </> : <>
      <div className="input-dialogue-understanding"><small>{review.extraction?.method === 'local' ? '簡易整理による候補' : 'AIの読み取り候補'}</small>
        <p>{review.summary}</p><span>{review.steps.length}手順 · 確認事項 {review.questions.length}件</span>
      </div>
      {!!props.operationSession?.turns.length&&<div className="input-operation-conversation" aria-label="図へのお願いと返答">
        <details><summary>図へのお願い・操作履歴 · {props.operationSession.turns.filter(t=>t.role==='user').length}件</summary>{props.operationSession.turns.map(turn=><article key={turn.id}><small>{turn.role==='user'?'あなた':'図の確認'}{turn.state==='applied'?' · 反映済み':turn.state==='cancelled'?' · 取り消し':''}</small><p>{turn.text}</p></article>)}</details>
        {props.operationSession.turns.slice(-2).map(turn=><article key={turn.id}><small>{turn.role==='user'?'あなた':'図の確認'}{turn.state==='applied'?' · 反映済み':turn.state==='cancelled'?' · 取り消し':''}</small><p>{turn.text}</p></article>)}
      </div>}
      <details ref={historyRef} className="input-dialogue-history"><summary>これまでの対話 · {history.length}回答</summary>
        <details><summary>最初の話・本文を読む</summary><blockquote>{props.source}</blockquote></details>
        {history.map(entry)}
      </details>
      {!!history.length && <div className="input-dialogue-latest" aria-label="直前の回答">{entry(history[history.length - 1], history.length - 1)}<button className="input-text-button" onClick={()=>{if(historyRef.current){historyRef.current.open=true;historyRef.current.scrollIntoView({block:'nearest'});}}}>回答の全文・履歴を読む</button></div>}
      {!composing && !props.operationSession?.plan && current && <div className="input-dialogue-current">
        <small>次に確かめたいこと</small><p className="input-dialogue-question">{current.question}</p>
        <details><summary>なぜ確認するか</summary><p>{current.reason}</p></details>
        <label className="kg-edit-field">分かっていることを答える<textarea aria-label="この確認への回答" disabled={busy} value={answer}
          onChange={event => props.onAnswerText(current.question, event.target.value)} placeholder="分かっている範囲で答えてください。資料と違うところも説明できます。" /></label>
        <div className="input-dialogue-actions"><button className="button-primary" disabled={disabled || !answer.trim()}
          onClick={async () => { if (await props.onAnswer(current.question, answer)) { setQuestionText(''); setNotice('回答を反映した候補です。図の変更を確かめてから保存できます。'); } }}>回答を図に反映する</button>
          <button disabled={disabled || !!answer.trim()} onClick={() => { props.onDefer(current.question); setQuestionText(''); setNotice('この内容は未確認のまま残しました。分かったときに回答できます。'); }}>まだ分からない</button></div>
        {questions.ready.length > 1 && <details><summary>別の確認事項を選ぶ · {questions.ready.length}件</summary>
          <select aria-label="対話で答える確認事項" value={current.question} onChange={event => setQuestionText(event.target.value)}>{questions.ready.map(q => <option key={q.question} value={q.question}>{q.question}</option>)}</select>
        </details>}
      </div>}
      {!composing && !current && <p className="input-dialogue-question">{questions.deferred.length ? '分からないことは残したまま、続きを話せます。' : 'いまの理解を図で確かめてください。違うところや続きを話せます。'}</p>}
      {!composing && <button className="button-secondary" disabled={disabled} onClick={() => { setComposing(true); setCorrectIndex(undefined); }}>続きを話す・図を直す</button>}
      {composing && <div className="input-dialogue-compose">
        <strong>{correctIndex === undefined ? '続きを話す・つなぐ・まとめる' : '以前の回答を訂正する'}</strong>
        {correctIndex !== undefined && <p>{history[correctIndex]?.question}</p>}
        {correctIndex === undefined && <label>話す範囲<select aria-label="対話で補足・訂正する範囲" value={props.correctionScope} onChange={event => props.onCorrectionScope(event.target.value)}><option value="all">この仕事の流れ全体</option>{props.selectedName && <option value="step">選んだ手順：{props.selectedName}</option>}</select></label>}
        <label className="kg-edit-field">{correctIndex === undefined ? '補足・訂正する内容' : '訂正後の回答'}<textarea aria-label="対話からの補足・訂正" value={props.correctionText} disabled={busy}
          onChange={event => props.onCorrectionText(event.target.value)} placeholder="例：受け取るのは購買担当です。／確認の後へつないで。／この二つは同じ仕事です。" /></label>
        <button className="button-primary" disabled={disabled || !props.correctionText.trim()} onClick={async () => {
          if (await props.onCorrection(props.correctionText, correctIndex)) { setComposing(false); setCorrectIndex(undefined); setNotice('対話の返答と図を確認してください。変更前の内容も残っています。'); }
        }}>{correctIndex===undefined?'話す・操作をお願いする':'訂正を図に反映する'}</button>
        <button disabled={busy} onClick={() => { props.onCorrectionText(''); setComposing(false); setCorrectIndex(undefined); setNotice('入力中の補足・訂正を取り消しました。前の図と回答は残っています。'); }}>この入力を取り消す</button>
      </div>}
      {!!questions.deferred.length && <details className="input-dialogue-deferred"><summary>後で確かめる · {questions.deferred.length}件</summary>
        {questions.deferred.map(q => <button key={q.question} disabled={disabled} onClick={() => { setQuestionText(q.question); setComposing(false); }}>{q.question}に答える</button>)}
      </details>}
      {blockedReason && <p role="status">{blockedReason}</p>}
      {notice && <p className="input-growing-hint" role="status">{notice}</p>}
      <p className="input-growing-hint">回答と図の変更は、確認してから保存できます。元の話と訂正前の回答も残ります。</p>
    </>}
  </section>;
}
