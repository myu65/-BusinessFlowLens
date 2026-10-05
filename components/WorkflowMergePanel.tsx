"use client";
import React,{useEffect,useMemo,useRef,useState} from 'react';
import { buildWorkflowReviewFromGraph,getWorkflowProcesses,type LensGraph,type LensNode } from '@/lib/graph';
import { mergeStepDifferences,previewWorkflowMerge,workflowMergeChoices,workflowMergeDestination,workflowMergeProblem,type WorkflowMergeChoice,type WorkflowMergeRecord } from '@/lib/workflow-merge';
import type {ProjectSnapshot} from '@/lib/storage/repository';
import {InputFlowCanvas} from './InputFlowCanvas';
import {DocumentOriginalPane} from './DocumentOriginalPane';
import type {InputDraft} from '@/lib/review-workbench';
import {describeHumanEdit} from '@/lib/review-workbench';

type Props={projectId:string;graph:LensGraph;transcripts:Record<string,string>;sourceId:string;draft?:InputDraft;blockedIds?:string[];onSaved:(project:ProjectSnapshot,selectedId:string)=>void;onClose:()=>void};
function StepFacts({graph,step}:{graph:LensGraph;step:LensNode}){
  const assets=graph.edges.filter(e=>e.relation!=='next'&&(e.source===step.id||e.target===step.id)).map(e=>graph.nodes.find(n=>n.id===(e.source===step.id?e.target:e.source))?.label).filter(Boolean);
  return <div className="merge-step-facts"><strong>{step.label}</strong><p>{step.actor||'担当は未確認'} · {step.action}</p>{step.meaning?.result&&<p>決まること：{step.meaning.result}</p>}<p>道具・情報：{[...new Set(assets)].join(' / ')||'未確認'}</p>{!!step.humanEdits?.length&&<small>人の訂正 {step.humanEdits.length}件を含む</small>}</div>;
}
export function WorkflowMergePanel({projectId,graph,transcripts,sourceId,draft,blockedIds=[],onSaved,onClose}:Props){
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  const [targetId,setTargetId]=useState(''),[query,setQuery]=useState(''),[targetPage,setTargetPage]=useState(0),[stepPage,setStepPage]=useState(0),[flowPage,setFlowPage]=useState(0),[selectedKey,setSelectedKey]=useState('');
  const [choices,setChoices]=useState<WorkflowMergeChoice[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const source=graph.workflows.find(w=>w.id===sourceId)!,target=graph.workflows.find(w=>w.id===targetId);
  const targets=graph.workflows.filter(w=>w.id!==sourceId&&!blockedIds.includes(w.id)&&!workflowMergeProblem(source,w)&&`${w.name} ${w.description??''}`.includes(query.trim()));
  const sourceSteps=getWorkflowProcesses(graph,sourceId),targetSteps=getWorkflowProcesses(graph,targetId);
  const pending=choices.filter(c=>c.targetProcessId&&!c.keep).length;
  const result=useMemo(()=>{
    if(!targetId)return null;
    try{return previewWorkflowMerge({graph,transcripts,sourceId,targetId,choices:choices.map(c=>c.targetProcessId&&!c.keep?{...c,keep:'target'}:c)});}catch{return null;}
  },[graph,transcripts,sourceId,targetId,choices]);
  const review=useMemo(()=>result?buildWorkflowReviewFromGraph(result.graph,targetId):null,[result,targetId]);
  const selected=review?.steps.find(s=>s.stepKey===selectedKey)??review?.steps[0];
  const docs=[...(source.reviewContext?.documentEvidence??[]),...(target?.reviewContext?.documentEvidence??[])];
  function chooseTarget(id:string){setTargetId(id);setChoices(workflowMergeChoices(graph,sourceId,id));setStepPage(0);setFlowPage(0);setError('');}
  function change(id:string,patch:Partial<WorkflowMergeChoice>){setChoices(current=>current.map(c=>c.sourceProcessId===id?{...c,...patch}:c));setError('');}
  async function apply(){
    if(!target||!result||pending||busy)return;setBusy(true);setError('');
    try{
      const body={projectId,sourceId,targetId,choices,...(draft?{draft:{workflow:draft.workflow,review:draft.review,sourceNotes:draft.sourceNotes,answerHistory:draft.answerHistory}}:{})};
      const preview=await fetch('/api/workflow-merge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,mode:'preview'})});
      const checked=await preview.json();if(!preview.ok)throw new Error(checked.error);
      // Verify that the server preview is the diagram the person just reviewed.
      const {mergeValue}=await import('@/lib/workflow-merge');
      if(mergeValue(checked.changes)!==mergeValue(result.changes))throw new Error('保存済みの内容が変わりました。画面を読み直して、統合を確認してください。');
      const response=await fetch('/api/workflow-merge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,mode:'apply',expectedUpdatedAt:checked.expectedUpdatedAt})});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error);
      onSaved(payload.project,targetId);onClose();
    }catch(cause){setError(cause instanceof Error?cause.message:'統合できませんでした。');}finally{setBusy(false);}
  }
  return <dialog ref={dialog} className="workflow-merge-dialog" aria-label="同じ業務を一つにまとめる" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}><section className="workflow-merge-panel">
    <div className="merge-heading"><div><h3>同じ業務を一つにまとめる</h3><p>「{source.name}」と同じ仕事を選んで、手順の対応を確かめます。</p></div><button disabled={busy} onClick={onClose}>統合をやめる</button></div>
    <label>統合先を探す<input value={query} disabled={busy} onChange={e=>{setQuery(e.target.value);setTargetPage(0);}} placeholder="業務名で検索"/></label>
    <p>同じ状態・工場・期間の業務 {targets.length}件</p>
    <div className="merge-targets">{targets.slice(targetPage*6,(targetPage+1)*6).map(w=><button key={w.id} disabled={busy} aria-pressed={targetId===w.id} onClick={()=>chooseTarget(w.id)}>{w.name}</button>)}</div>
    {!targets.length&&<p>この範囲に統合先はありません。工場や現在・将来の違いは、別の業務として保ちます。</p>}
    {targets.length>6&&<div className="kg-pagination"><button disabled={busy||!targetPage} onClick={()=>setTargetPage(p=>p-1)}>前の6業務</button><span>{targetPage*6+1}–{Math.min(targets.length,(targetPage+1)*6)} / {targets.length}</span><button disabled={busy||(targetPage+1)*6>=targets.length} onClick={()=>setTargetPage(p=>p+1)}>次の6業務</button></div>}
    {target&&<>
      <h4>同じ手順を選ぶ</h4><p>違う内容は、採用する側を選びます。別の手順は元のつながりのまま残ります。</p>
      {sourceSteps.slice(stepPage*6,(stepPage+1)*6).map(step=>{
        const choice=choices.find(c=>c.sourceProcessId===step.id)!,other=targetSteps.find(s=>s.id===choice.targetProcessId),difference=other?mergeStepDifferences(step,other,graph):[];
        return <article className="merge-step" key={step.id}><label>こちらの手順{step.stepOrder}「{step.label}」の対応<select disabled={busy} value={choice.targetProcessId??''} onChange={e=>{
          const next=targetSteps.find(s=>s.id===e.target.value);change(step.id,{targetProcessId:next?.id,keep:next&&!mergeStepDifferences(step,next,graph).length?'target':undefined});
        }}><option value="">別の手順として残す</option>{targetSteps.map(s=><option key={s.id} value={s.id}>統合先の手順{s.stepOrder}：{s.label}</option>)}</select></label>
          <div className="merge-step-comparison"><StepFacts graph={graph} step={step}/>{other&&<StepFacts graph={graph} step={other}/>}</div>
          {!!difference.length&&<><p className="merge-difference">違う箇所：{difference.join(' / ')}</p><label>この手順で採用する内容<select disabled={busy} aria-label={`手順${step.stepOrder}の採用する内容`} value={choice.keep??''} onChange={e=>change(step.id,{keep:e.target.value as WorkflowMergeChoice['keep']})}><option value="">内容を選んでください</option><option value="target">統合先の内容を採用</option><option value="source">こちらの内容を採用</option></select></label><p>採用しなかった内容も、統合履歴に原文・訂正と一緒に残ります。</p></>}
        </article>;
      })}
      {sourceSteps.length>6&&<div className="kg-pagination"><button disabled={busy||!stepPage} onClick={()=>setStepPage(p=>p-1)}>前の6手順の対応</button><span>{stepPage*6+1}–{Math.min(sourceSteps.length,(stepPage+1)*6)} / {sourceSteps.length}</span><button disabled={busy||(stepPage+1)*6>=sourceSteps.length} onClick={()=>setStepPage(p=>p+1)}>次の6手順の対応</button></div>}
      {pending>0&&<p role="status">内容の選択が必要な手順が{pending}件あります。未選択の図は統合先の内容で仮表示しています。</p>}
      {review&&selected&&result&&<><h4>まとめた後の流れを確認</h4><p>同じ手順 {result.count.combined}件 · 別に残す手順 {result.count.added}件 · 更新する業務間の受渡し {result.count.handoffs}件</p><InputFlowCanvas review={review} selected={selected} page={flowPage} onPage={setFlowPage} choose={step=>{setSelectedKey(step.stepKey);setFlowPage(Math.floor((step.order-1)/6));}} reading/></>}
      <details><summary>二つの元の話を読む</summary><h4>{source.name}</h4><pre>{transcripts[sourceId]}</pre><h4>{target.name}</h4><pre>{transcripts[targetId]}</pre></details>
      {!!docs.length&&<DocumentOriginalPane projectId={projectId} evidence={docs}/>}<p>原本と訂正履歴を保って保存します。統合履歴から元に戻せます。</p>
      <button className="button-primary" disabled={busy||!result||pending>0} onClick={()=>void apply()}>{busy?'統合して保存しています…':'この内容で一つにまとめる'}</button>
    </>}{error&&<p role="alert">{error}</p>}
  </section></dialog>;
}

export function WorkflowMergeHistory({projectId,graph,workflowId,onSaved,disabled=false}:{projectId:string;graph:LensGraph;workflowId:string;onSaved:Props['onSaved'];disabled?:boolean}){
  const history=graph.knowledge?.workflowMerges??[];
  const records=history.filter(r=>r.targetWorkflowId===workflowId||r.sourceWorkflowId===workflowId||r.state==='merged'&&workflowMergeDestination(graph,r.targetWorkflowId)===workflowId);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[page,setPage]=useState(0);
  async function undo(record:WorkflowMergeRecord){
    setBusy(true);setError('');try{
      const snapshot=await fetch(`/api/project?projectId=${encodeURIComponent(projectId)}`,{cache:'no-store'}),data=await snapshot.json();
      if(!snapshot.ok||!data.project)throw new Error('保存済みの内容を確認できませんでした。');
      const response=await fetch('/api/workflow-merge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,mode:'undo',recordId:record.id,expectedUpdatedAt:data.project.updatedAt})});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error);onSaved(payload.project,payload.restoredId);
    }catch(cause){setError(cause instanceof Error?cause.message:'元に戻せませんでした。');}finally{setBusy(false);}
  }
  if(!records.length)return null;
  return <details className="workflow-merge-history"><summary>統合履歴 · {records.length}件</summary>{records.slice(page*6,(page+1)*6).map(r=>{
    const docs=r.changes.workflows.flatMap(c=>c.before?.reviewContext?.documentEvidence??[]);
    return <article key={r.id}><h4>「{r.sourceName}」を「{r.targetName}」に統合</h4><p>{new Date(r.createdAt).toLocaleString('ja-JP')} · {r.state==='undone'?'元に戻しました':'統合済み'}</p><details><summary>統合前の原文と人の訂正を読む</summary>{r.changes.transcripts.map(c=><div key={c.key}><h5>{c.key===r.sourceWorkflowId?r.sourceName:r.targetName}</h5><pre>{c.before}</pre></div>)}{r.changes.nodes.filter(c=>c.before?.humanEdits?.length).map(c=><div key={c.key}><strong>{c.before!.label}</strong>{c.before!.humanEdits!.map((e,i)=><p key={i}>{describeHumanEdit(e).map((text,j)=><React.Fragment key={j}>{text}<br/></React.Fragment>)}{e.evidence}</p>)}</div>)}</details>{!!docs.length&&<DocumentOriginalPane projectId={projectId} evidence={docs}/>}<button disabled={disabled||busy||r.state!=='merged'} onClick={()=>void undo(r)}>{busy?'元に戻しています…':'この統合を元に戻す'}</button></article>;
  })}{records.length>6&&<div className="kg-pagination"><button disabled={!page||busy} onClick={()=>setPage(p=>p-1)}>前の6統合</button><button disabled={(page+1)*6>=records.length||busy} onClick={()=>setPage(p=>p+1)}>次の6統合</button></div>}{error&&<p role="alert">{error}</p>}</details>;
}
