"use client";
import React, { type RefObject } from 'react';
import type { ExtractionReview } from '@/lib/graph';
import type { ReviewInsertion } from '@/lib/review-addition';

export function InputInsertionComposer({review,insertion,note,busy,inputRef,onNote,onPlacement,onSubmit,onPause,onCancel}:{
  review:ExtractionReview;insertion:ReviewInsertion;note:string;busy:boolean;
  inputRef:RefObject<HTMLTextAreaElement|null>;onNote:(value:string)=>void;onPlacement:(placement:ReviewInsertion)=>void;
  onSubmit:()=>Promise<void>;onPause:()=>void;onCancel:()=>void;
}){
  const name=(key:string)=>review.steps.find(s=>s.stepKey===key)?.name??'手順は未確認';
  const branches=review.transitions.filter(t=>t.fromStepKey===insertion.afterStepKey);
  const needsBranch=!insertion.transition&&branches.length>0;
  return <form className="input-insertion-form input-composer-body" aria-label="図で選んだ場所に作業を追加" onSubmit={event=>{event.preventDefault();void onSubmit();}}>
    <strong>図で選んだ場所に追加</strong>
    <ol className="input-insertion-place"><li>{name(insertion.afterStepKey)}</li><li>ここに作業を追加</li><li>{insertion.transition?name(insertion.transition.toStepKey):'その後の接続は未確認'}</li></ol>
    {insertion.transition?.condition&&<p>この続きの条件<br/><strong>{insertion.transition.condition}</strong></p>}
    {needsBranch&&<fieldset disabled={busy} className="input-insertion-branches"><legend>どの続きに追加しますか？</legend>{branches.map((transition,index)=><button type="button" key={index} onClick={()=>onPlacement({afterStepKey:insertion.afterStepKey,transition})}>{transition.condition||'次の手順'}<br/>→ {name(transition.toStepKey)}</button>)}</fieldset>}
    <label className="kg-edit-field">追加する作業<textarea ref={inputRef} value={note} disabled={busy} onChange={event=>onNote(event.target.value)} placeholder="例えば、送る前に物流担当がExcelで重量を確認します。" maxLength={4000}/></label>
    <div className="input-dialogue-actions"><button type="submit" className="button-primary" disabled={busy||!note.trim()||needsBranch}>{busy?'追加した話を読んでいます…':'ここに追加して見る'}</button><button type="button" disabled={busy} onClick={onPause}>あとで続ける</button>{!!note.trim()&&<button type="button" disabled={busy} onClick={onCancel}>書きかけを取り消す</button>}</div>
    <p className="input-growing-hint">入力した話と追加した場所を残します。図で確かめてから保存できます。</p>
  </form>;
}
