"use client";
import React,{useState} from 'react';
import type {ExtractionReview,ExtractionReviewStep,ExtractionTransition} from '@/lib/graph';
import {changeReviewConnection,transitionKey} from '@/lib/review-connection-edits';
import {inputStepName} from '@/lib/input-canvas';
import {describeHumanEdit} from '@/lib/review-workbench';

export function FlowConnectionEditor({review,selected,disabled,onChange}:{review:ExtractionReview;selected:ExtractionReviewStep;disabled:boolean;onChange:(review:ExtractionReview)=>void}){
  const [editing,setEditing]=useState<{previous:ExtractionTransition|null;target:string;condition:string;progress:string;reason:string}|null>(null);
  const [undo,setUndo]=useState<{before:ExtractionReview;after:ExtractionReview}|null>(null),[error,setError]=useState('');
  const outgoing=review.transitions.filter(edge=>edge.fromStepKey===selected.stepKey),removed=review.excludedTransitions?.filter(edge=>edge.fromStepKey===selected.stepKey)??[];
  const name=(key:string)=>{const step=review.steps.find(step=>step.stepKey===key);return step?`${step.order}. ${inputStepName(step)}`:'以前の手順（現在の候補にはありません）';};
  const progress=(edge:ExtractionTransition)=>edge.holdEffect==='response'?'保留中の対応':edge.holdEffect==='resume'?'保留を解除して再開':edge.certainty==='unknown'?'進み方は未確認':'通常の流れ';
  function apply(next:ExtractionReview){setUndo({before:review,after:next});setError('');onChange(next);}
  function open(previous:ExtractionTransition|null){setEditing({previous,target:previous?.toStepKey??'',condition:previous?.condition??'',progress:previous?.holdEffect??(previous?.certainty==='unknown'||!previous&&selected.meaning?.halt?'unknown':'normal'),reason:''});setError('');}
  function save(){
    if(!editing?.target)return;
    try{apply(changeReviewConnection(review,editing.previous,{fromStepKey:selected.stepKey,toStepKey:editing.target,condition:editing.condition,evidence:editing.reason,
      certainty:editing.progress==='unknown'?'unknown':'confirmed',holdEffect:editing.progress==='response'||editing.progress==='resume'?editing.progress:undefined}));setEditing(null);}catch(cause){setError(cause instanceof Error?cause.message:'接続を直せませんでした。');}
  }
  return <section className="input-connection-editor" aria-label="次の手順と戻り先の編集"><h3>次の手順・戻り先を直す</h3>
    {outgoing.map(edge=><article key={transitionKey(edge)}><p>→ {name(edge.toStepKey)}{edge.condition&&` · ${edge.condition}`}</p><small>{progress(edge)} · {edge.humanEdits?.length?edge.certainty==='confirmed'?'利用者が確認':'利用者が編集 · 接続は要確認':edge.certainty==='confirmed'?'原文の根拠あり':'接続は要確認'}</small><div><button disabled={disabled} onClick={()=>open(edge)}>この矢印を直す</button><button disabled={disabled} onClick={()=>{apply(changeReviewConnection(review,edge,null));setEditing(null);}}>この矢印を除外</button></div><details><summary>接続の根拠・変更前を読む</summary><blockquote>{edge.evidence||'元の根拠は未確認'}</blockquote>{edge.humanEdits?.flatMap(describeHumanEdit).map((text,i)=><p key={i}>{text}</p>)}</details></article>)}
    {!outgoing.length&&<p>この先のつながりは、まだ登録されていません。</p>}
    {!editing&&<button disabled={disabled} onClick={()=>open(null)}>＋ 次の手順・戻り先をつなぐ</button>}
    {editing&&<fieldset disabled={disabled}><legend>{editing.previous?'選んだ矢印を直す':'次の手順・戻り先をつなぐ'}</legend>
      <label>進む手順<select aria-label="接続する次の手順・戻り先" value={editing.target} onChange={e=>setEditing({...editing,target:e.target.value})}><option value="">手順を選んでください</option>{review.steps.map(step=><option key={step.stepKey} value={step.stepKey}>{step.order}. {inputStepName(step)}</option>)}</select></label>
      <label>進む条件（なければ空欄）<input aria-label="この矢印を進む条件" value={editing.condition} onChange={e=>setEditing({...editing,condition:e.target.value})}/></label>
      <label>進み方<select aria-label="この矢印の進み方" value={editing.progress} onChange={e=>setEditing({...editing,progress:e.target.value})}><option value="normal">通常の流れ</option><option value="response">保留中の対応</option><option value="resume">保留を解除して再開</option><option value="unknown">進み方は未確認</option></select></label>
      <p>作り直しや解除の依頼は「保留中の対応」。通常の仕事を再開できると分かったときに「保留を解除して再開」を選びます。</p>
      <details><summary>確認した根拠・補足を残す</summary><label>接続の根拠<textarea aria-label="この矢印を確認した根拠" value={editing.reason} onChange={e=>setEditing({...editing,reason:e.target.value})}/></label></details>
      <button className="button-primary" disabled={!editing.target} onClick={save}>この矢印を図に反映</button><button onClick={()=>setEditing(null)}>矢印の編集をやめる</button>
    </fieldset>}
    {undo&&review===undo.after&&<button disabled={disabled} onClick={()=>{onChange(undo.before);setUndo(null);setEditing(null);}}>今回の矢印の変更を取り消す</button>}
    {!!removed.length&&<details><summary>除外した矢印 · {removed.length}件</summary>{removed.map(edge=><article key={transitionKey(edge)}><p>→ {name(edge.toStepKey)}{edge.condition&&` · ${edge.condition}`}</p><p>元の根拠：{edge.evidence||'未登録'}</p><button disabled={disabled||!review.steps.some(step=>step.stepKey===edge.toStepKey)} onClick={()=>{apply(changeReviewConnection(review,null,{...edge,certainty:edge.certainty??'unknown',evidence:'利用者が除外した矢印を図の上で戻した'}));}}>この矢印を戻す</button></article>)}</details>}
    {error&&<p role="alert">{error}</p>}<p className="input-growing-hint">図で変更を確かめてから保存できます。元の話と、以前の接続の根拠は残ります。</p>
  </section>;
}
