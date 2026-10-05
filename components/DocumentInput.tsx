"use client";
import React, { useEffect, useRef, useState } from "react";
import { DOCUMENT_MAX_BYTES, matchingSourceUnits, type SourceDocument, type DocumentWorkItem, type DocumentEvidence } from "@/lib/source-document";

function sourceURL(projectId: string, documentId: string) {
  return `/api/source-document?projectId=${encodeURIComponent(projectId)}&id=${encodeURIComponent(documentId)}`;
}
export function DocumentInput({projectId, busy, onClose, onStart, completed, savedIds=new Set<string>(), activeDocumentId, onAIResponse}: {
  projectId:string; busy:boolean; onClose:()=>void; onStart:(document:SourceDocument,item:DocumentWorkItem)=>void; completed:Set<string>; savedIds?:Set<string>; activeDocumentId?:string; onAIResponse?:()=>void;
}) {
  const [document,setDocument]=useState<SourceDocument|null>(null);
  const [working,setWorking]=useState(false), [status,setStatus]=useState(""), [error,setError]=useState("");
  const [page,setPage]=useState(0), [raw,setRaw]=useState(false);
  const [library,setLibrary]=useState<Array<Pick<SourceDocument,"id"|"name"|"format"|"createdAt">>>([]);
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{fetch(`/api/source-document?projectId=${encodeURIComponent(projectId)}`).then(r=>r.json()).then(v=>setLibrary(v.documents??[])).catch(()=>setError("取り込んだ資料の一覧を読み込めませんでした。"));},[projectId]);
  useEffect(()=>{if(activeDocumentId&&document?.id!==activeDocumentId)void open(activeDocumentId);},[activeDocumentId]);
  async function analyze(doc:SourceDocument) {
    setWorking(true);setStatus("AIが、資料に書かれた仕事と補足の場所を確認しています…");setError("");
    try {
      const response=await fetch("/api/source-document/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId,documentId:doc.id})});
      const value=await response.json();if(!response.ok)throw new Error(value.error??"資料を整理できませんでした。");
      setDocument(value.document);setPage(0);setStatus("");
      if (!value.cached) onAIResponse?.();
    } catch(cause){setError(cause instanceof Error?cause.message:"資料を整理できませんでした。");setStatus("");}
    finally{setWorking(false);}
  }
  async function upload(file:File) {
    if(file.size>DOCUMENT_MAX_BYTES){setError("8MBまでの資料を選んでください。");return;}
    setWorking(true);setError("");setStatus("資料の文字と、セル・ページの位置を読み込んでいます…");
    try {
      const data=new FormData();data.set("projectId",projectId);data.set("file",file);
      const response=await fetch("/api/source-document",{method:"POST",body:data});const value=await response.json();
      if(!response.ok)throw new Error(value.error??"資料を読み込めませんでした。");
      setDocument(value.document);setRaw(false);
      setLibrary(current=>[{id:value.document.id,name:value.document.name,format:value.document.format,createdAt:value.document.createdAt},...current.filter(doc=>doc.id!==value.document.id)].slice(0,20));
      await analyze(value.document);
    } catch(cause){setError(cause instanceof Error?cause.message:"資料を読み込めませんでした。");setStatus("");}
    finally{setWorking(false);}
  }
  async function open(id:string) {
    setWorking(true);setError("");
    try {const response=await fetch(sourceURL(projectId,id));const value=await response.json();if(!response.ok)throw new Error(value.error);setDocument(value.document);setPage(0);setRaw(false);}
    catch(cause){setError(cause instanceof Error?cause.message:"資料を開けませんでした。");}finally{setWorking(false);}
  }
  const disabled=busy||working, items=document?.workItems??[];
  async function sample(format:"xlsx"|"pdf") {
    setError("");
    try {const response=await fetch(`/examples/${format==="xlsx"?"audit-business-controls.xlsx":"manufacturing-audit.pdf"}`);if(!response.ok)throw new Error("資料の例を開けませんでした。");const blob=await response.blob();await upload(new File([blob],format==="xlsx"?"内部監査_業務フロー統制一覧.xlsx":"内部監査_製造運用調査票.pdf"));}
    catch(cause){setError(cause instanceof Error?cause.message:"資料の例を開けませんでした。");}
  }
  return <section className="document-input-panel" aria-label="資料から仕事を読み込む">
    <header><div><h2>資料から始める</h2>{!document&&<p>業務の名前を先に決めず、資料に書かれた仕事から流れを確かめられます。</p>}</div><button className="button-secondary" disabled={disabled} onClick={onClose}>入力画面へ戻る</button></header>
    <div className="document-upload" data-ready={!!items.length}><button className={document?"button-secondary":"button-primary"} disabled={disabled} onClick={()=>input.current?.click()}>{document?"別のExcel・PDFを選ぶ":"Excel・PDFを選ぶ"}</button>
      <input ref={input} type="file" accept=".xlsx,.pdf" aria-label="読み込むExcel・PDF" hidden onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);e.target.value="";}}/>
      {!!library.length&&<label className="document-library-select">取り込んだ資料<select aria-label="取り込んだ資料を開く" value={document?.id??""} disabled={disabled} onChange={e=>{if(e.target.value)void open(e.target.value);}}><option value="">資料を選ぶ · 最近20件まで</option>{library.map(doc=><option value={doc.id} key={doc.id}>{doc.name}</option>)}</select></label>}
      {!document&&<p>.xlsx / 文字を選択できるPDF / 8MBまで。結合セルや別シートの補足も読みます。</p>}
    </div>
    {!document&&<div className="document-examples"><span>手元に資料がないときは、架空の会社の資料で試せます。</span><button className="input-text-button" disabled={disabled} onClick={()=>sample("xlsx")}>監査Excelの例を読み込む</button><button className="input-text-button" disabled={disabled} onClick={()=>sample("pdf")}>調査PDFの例を読み込む</button></div>}
    {status&&<p className="document-status" role="status">{status}</p>}
    {error&&<p className="error-message" role="alert">{error}</p>}
    {document&&<>
      <div className="document-reading-heading"><h3>{document.name}</h3><small>元資料を保存済み · {document.units.length}{document.format==="pdf"?"ページ":"行"}の文字を読み込み{document.analysis&&` · AIで業務分け${document.analysis.model?` / ${document.analysis.model}`:""}`}</small></div>
      <details className="document-limitations"><summary>読み取った範囲・読み取れない内容を確認</summary>{document.warnings.map((text,i)=><p key={i}>{text}</p>)}</details>
      {!items.length&&!working&&<button className="button-secondary" onClick={()=>analyze(document)}>資料の仕事を整理する</button>}
      {!!items.length&&<>
        <div className="document-work-heading"><h3>図で確かめる仕事を選ぶ</h3><p>業務の分け方はAIの候補です。原文と違うところは、図を見ながら直せます。</p></div>
        <div className="document-work-cards">{items.slice(page*6,(page+1)*6).map(item=>{
          const itemKey=`doc-${document.id}-${item.id}`, done=completed.has(itemKey), saved=savedIds.has(itemKey);
          const evidence=document.units.filter(unit=>item.unitIds.includes(unit.id));
          return <article key={item.id}><div className="document-scope">{item.scope==="future"?"将来案":item.scope==="alternative"?"代替案":"現在"}{item.site&&` · ${item.site}`}<span>{saved?"保存済み":done?"保存前":"未読"}</span></div><h4>{item.title}</h4><button className="button-primary" disabled={disabled} onClick={()=>onStart(document,item)}>{saved?"この仕事の流れを開く":done?"保存前の候補を開く":"この仕事を図で確かめる"} →</button><p>{item.note}</p><small>原資料：{evidence.slice(0,2).map(unit=>unit.location).join("、")}{evidence.length>2?` ほか${evidence.length-2}箇所`:""}</small></article>;
        })}</div>
        {items.length>6&&<nav className="document-pagination" aria-label="資料に書かれた仕事のページ"><button disabled={!page||disabled} onClick={()=>setPage(page-1)}>前の6件</button><span>{page*6+1}–{Math.min(items.length,(page+1)*6)} / {items.length}</span><button disabled={(page+1)*6>=items.length||disabled} onClick={()=>setPage(page+1)}>次の6件</button></nav>}
      </>}
      <button className="input-text-button" disabled={working} onClick={()=>setRaw(!raw)}>{raw?"原資料の文字を閉じる":"読み取ったセル・ページの文字を見る"}</button>
      {raw&&<SourceUnits document={document}/>}
    </>}
  </section>;
}

export function SourceUnits({document,unitIds}: {document:SourceDocument;unitIds?:string[]}) {
  const [page,setPage]=useState(0);
  const units=unitIds?document.units.filter(unit=>unitIds.includes(unit.id)):document.units;
  const count=Math.max(1,Math.ceil(units.length/12)), current=Math.min(page,count-1);
  return <section className="document-source-units" aria-label="元資料のセルとページ">
    {units.slice(current*12,(current+1)*12).map(unit=><article key={unit.id}><h4>{unit.location}</h4>{unit.cells?<dl className="document-cell-grid">{unit.cells.filter((cell,i,cells)=>cells.findIndex(c=>c.sourceAddress===cell.sourceAddress)===i).map(cell=>{
      const same=unit.cells!.filter(c=>c.sourceAddress===cell.sourceAddress), location=same.length>1?`${same[0].address}:${same.at(-1)!.address}`:cell.address;
      return <div key={cell.address}><dt>{location}{cell.sourceAddress!==cell.address&&<small>結合元{cell.sourceAddress}</small>}</dt><dd>{cell.text||<span className="input-unconfirmed">空欄・未確認</span>}</dd></div>;
    })}</dl>:<pre>{unit.text}</pre>}</article>)}
    {count>1&&<nav className="document-pagination" aria-label="元資料のページ切替"><button disabled={!current} onClick={()=>setPage(current-1)}>前の12箇所</button><span>{current*12+1}–{Math.min(units.length,(current+1)*12)} / {units.length}</span><button disabled={current+1>=count} onClick={()=>setPage(current+1)}>次の12箇所</button></nav>}
  </section>;
}

export function DocumentSourceEvidence({projectId,evidence,focusText="",stepName=""}: {projectId:string;evidence:DocumentEvidence[];focusText?:string;stepName?:string}) {
  const [documents,setDocuments]=useState<Record<string,SourceDocument>>({}), [error,setError]=useState("");
  const [open,setOpen]=useState(false), dialog=useRef<HTMLDialogElement>(null);
  const [all,setAll]=useState(false);
  useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();else if(!open&&dialog.current?.open)dialog.current.close();},[open]);
  async function load() {
    try {for(const ref of evidence){if(documents[ref.documentId])continue;const response=await fetch(sourceURL(projectId,ref.documentId));const value=await response.json();if(!response.ok)throw new Error(value.error);setDocuments(current=>({...current,[ref.documentId]:value.document}));}}
    catch(cause){setError(cause instanceof Error?cause.message:"元資料を読み込めませんでした。");}
  }
  return <div className="document-evidence"><button className="button-secondary" onClick={()=>{setAll(false);setOpen(true);void load();}}>元資料のセル・ページを確認する</button>
    <dialog ref={dialog} className="document-evidence-dialog" aria-label="元資料と読み取った箇所" onCancel={()=>setOpen(false)}><header><h2>元資料と読み取った箇所</h2><button className="button-secondary" onClick={()=>setOpen(false)}>フローへ戻る</button></header>
      <p>{stepName?`今見ている手順：${stepName}。`:""}担当の空欄や注記も、そのまま残しています。</p>
      {error&&<p role="alert">{error}</p>}{evidence.map(ref=>{
        const doc=documents[ref.documentId], matches=doc?matchingSourceUnits(doc,ref.unitIds,focusText):[];
        return <article key={`${ref.documentId}-${ref.itemId}`}><h3>{ref.documentName}</h3><a className="input-text-button" href={`${sourceURL(projectId,ref.documentId)}&original=1`}>元のファイルを保存</a>{doc?<>
          {!!matches.length&&<div className="document-source-selection"><strong>{all?"この仕事で読んだ全箇所":"この手順の根拠がある箇所"}</strong><button className="button-secondary" onClick={()=>setAll(!all)}>{all?"この手順の根拠に戻る":"この仕事で読んだ全箇所も見る"}</button></div>}
          <SourceUnits key={all?"all":focusText} document={doc} unitIds={!all&&matches.length?matches.map(unit=>unit.id):ref.unitIds}/></>:<p role="status">元資料を開いています…</p>}</article>;
      })}
    </dialog>
  </div>;
}
