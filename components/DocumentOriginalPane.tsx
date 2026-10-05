"use client";
import React, { useEffect, useState } from "react";
import type { DocumentEvidence, SourceDocument, SourceReference } from "@/lib/source-document";
import { DocumentSourceEvidence } from "./DocumentInput";
const url = (projectId: string, documentId: string) => `/api/source-document?projectId=${encodeURIComponent(projectId)}&id=${encodeURIComponent(documentId)}`;
/** Original images remain visible beside the interpreted business graph. */
export function DocumentOriginalPane({projectId,evidence,sourceRefs,compact=false}: {projectId:string;evidence:DocumentEvidence[];sourceRefs?:SourceReference[];compact?:boolean}) {
  const [documents,setDocuments] = useState<SourceDocument[]>([]), [selected,setSelected] = useState(""), [error,setError] = useState("");
  const identity = evidence.map(ref=>`${ref.documentId}:${ref.unitIds.join(",")}`).join(";");
  useEffect(()=>{
    const controller = new AbortController();setDocuments([]);setError("");
    Promise.all(evidence.map(async ref=>{
      const response=await fetch(url(projectId,ref.documentId),{signal:controller.signal});const value=await response.json();
      if(!response.ok)throw new Error(value.error);return value.document as SourceDocument;
    })).then(values=>{if(!controller.signal.aborted)setDocuments(values);}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"元資料を開けませんでした。");});
    return ()=>controller.abort();
  },[projectId,identity]);
  const pages=documents.flatMap(document=>document.units.filter(unit=>evidence.some(ref=>ref.documentId===document.id&&ref.unitIds.includes(unit.id))).map(unit=>({document,unit,id:`${document.id}/${unit.id}`})));
  const focus=sourceRefs?.[0];
  useEffect(()=>{if(focus)setSelected(`${focus.documentId}/${focus.unitId}`);},[focus?.documentId,focus?.unitId]);
  const page=pages.find(page=>page.id===selected)??pages[0];
  const pagePicker=page&&pages.length>1&&<label>表示するページ<select aria-label="表示する元ページ" value={page.id} onChange={event=>setSelected(event.target.value)}>{pages.map(item=><option key={item.id} value={item.id}>{documents.length>1?`${item.document.name} · `:""}{item.unit.location}</option>)}</select></label>;
  const picture=page&&(page.unit.image?<img src={`${url(projectId,page.document.id)}&image=${encodeURIComponent(page.unit.id)}`} alt={`${page.document.name}の${page.unit.location}`} />:<pre>{page.unit.text}</pre>);
  return <section className="document-original-pane" data-compact={compact} aria-label="フローの元になった資料">
    <h3>元の図・資料</h3>{error&&<p role="alert">{error}</p>}
    {!page&&!error&&<p role="status">元資料を開いています…</p>}
    {page&&(compact?<>
      <div className="document-original-compact"><div>{picture}</div><div><p className="document-original-name">{page.document.name}</p><p>{page.unit.location}</p><DocumentSourceEvidence projectId={projectId} evidence={evidence} sourceRefs={[{documentId:page.document.id,unitId:page.unit.id}]} buttonLabel="原図を大きく見る" /></div></div>
      <details><summary>ページの切替・原本のダウンロード</summary>{pagePicker}<a href={`${url(projectId,page.document.id)}&original=1`}>原本をダウンロード</a></details>
    </>:<>
      <p className="document-original-name">{page.document.name}</p>
      {pagePicker}
      {picture}
      <p>{page.unit.location}</p>
      <DocumentSourceEvidence projectId={projectId} evidence={evidence} sourceRefs={[{documentId:page.document.id,unitId:page.unit.id}]} buttonLabel="原図・読み取りを見比べる" />
      <a href={`${url(projectId,page.document.id)}&original=1`}>原本をダウンロード</a>
    </>)}
  </section>;
}
