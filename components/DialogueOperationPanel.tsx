"use client";
import React, {useEffect,useState} from 'react';
import type {DialogueSession} from '@/lib/dialogue-operations';
export function DialogueOperationPanel({session,details,busy,onAccept,onCancel,onReply}:{session?:DialogueSession;details?:string[];busy:boolean;onAccept:()=>Promise<boolean>;onCancel:()=>void;onReply:(text:string)=>Promise<boolean>}){
  const [reply,setReply]=useState('');
  useEffect(()=>setReply(''),[session?.plan]);
  if(!session?.plan)return null;
  const asking=session.plan.action==='ask';
  return <aside className="dialogue-operation-proposal" aria-label={asking?'操作のための確認':'対話からの操作案'}>
    <strong>{asking?'操作の前に確かめたいこと':'この変更でよいですか？'}</strong><p>{asking?session.plan.question||session.plan.message:session.plan.message}</p>
    <p>{asking?'図はまだ変えていません。分からない場合も、そのまま答えられます。':'図は変更案です。元の話と変更前の内容を保持します。'}</p>
    {!!details?.length&&<details><summary>対象と採用する内容を確かめる · {details.length}件</summary>{details.map((text,i)=><p key={i}>{text}</p>)}</details>}
    <div>{!asking&&<button className="button-primary" disabled={busy} onClick={()=>void onAccept()}>この案を反映する</button>}<button disabled={busy} onClick={()=>onCancel()}>{asking?'このお願いを取り消す':'案を取り消して話し直す'}</button></div>
    <label className="kg-edit-field">{asking?'この確認への返答':'言葉で確認・変更もできます'}<textarea aria-label="操作案への返答" rows={2} value={reply} disabled={busy} onChange={e=>setReply(e.target.value)} placeholder={asking?'分かっていること、まだ分からないことを答えてください。':'それで反映して。／やっぱり戻り先は確認作業にしたい。'}/></label>
    <button disabled={busy||!reply.trim()} onClick={async()=>{if(await onReply(reply))setReply('');}}>返答する</button>
  </aside>;
}
