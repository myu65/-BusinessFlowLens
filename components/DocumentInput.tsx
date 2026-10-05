"use client";
import React, { useEffect, useRef, useState } from "react";
import { DOCUMENT_MAX_BYTES, matchingSourceUnits, type SourceDocument, type DocumentWorkItem, type DocumentEvidence } from "@/lib/source-document";

function sourceURL(projectId: string, documentId: string) {
  return `/api/source-document?projectId=${encodeURIComponent(projectId)}&id=${encodeURIComponent(documentId)}`;
}
export function DocumentInput({projectId, busy, onClose, onStart, completed, savedIds=new Set<string>(), activeDocumentId, onAIResponse, onWithdraw}: {
  projectId:string; busy:boolean; onClose:()=>void; onStart:(document:SourceDocument,item:DocumentWorkItem)=>void; completed:Set<string>; savedIds?:Set<string>; activeDocumentId?:string; onAIResponse?:()=>void; onWithdraw?:(documentId:string)=>void;
}) {
  const [document,setDocument]=useState<SourceDocument|null>(null);
  const [working,setWorking]=useState(false), [status,setStatus]=useState(""), [error,setError]=useState("");
  const [page,setPage]=useState(0), [raw,setRaw]=useState(false), [sourceIds,setSourceIds]=useState<string[]|undefined>();
  const sourceDialog=useRef<HTMLDialogElement>(null);
  const [withdrawing,setWithdrawing]=useState(false);
  const request=useRef<AbortController|null>(null), currentDocument=useRef<SourceDocument|null>(null);
  const [library,setLibrary]=useState<Array<Pick<SourceDocument,"id"|"name"|"format"|"createdAt">>>([]);
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>()=>{request.current?.abort();request.current=null;},[]);
  useEffect(()=>{if(raw&&!sourceDialog.current?.open)sourceDialog.current?.showModal();else if(!raw&&sourceDialog.current?.open)sourceDialog.current.close();},[raw,document?.id]);
  function remember(doc:SourceDocument|null) { currentDocument.current=doc;setDocument(doc); }
  function begin() { request.current?.abort();const controller=new AbortController();request.current=controller;return controller; }
  function active(controller:AbortController) { return request.current===controller&&!controller.signal.aborted; }
  async function post(path:string,doc:SourceDocument,controller:AbortController) {
    const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId,documentId:doc.id}),signal:controller.signal});
    const value=await response.json();if(!response.ok)throw new Error(value.error??"資料を整理できませんでした。");return value;
  }
  useEffect(()=>{fetch(`/api/source-document?projectId=${encodeURIComponent(projectId)}`).then(r=>r.json()).then(v=>setLibrary(v.documents??[])).catch(()=>setError("取り込んだ資料の一覧を読み込めませんでした。"));},[projectId]);
  useEffect(()=>{if(activeDocumentId&&document?.id!==activeDocumentId)void open(activeDocumentId);},[activeDocumentId]);
  async function analyze(doc:SourceDocument,controller=begin()) {
    setWorking(true);setStatus("資料のページを読み込んでいます…");setError("");
    try {
      if(doc.rendering?.status==="pending"||doc.rendering?.status==="unavailable") {
        const prepared=await post("/api/source-document/prepare",doc,controller);if(!active(controller))return;doc=prepared.document;remember(doc);
        if(doc.rendering?.status==="unavailable")throw new Error(doc.rendering.message??"ページを画像にできませんでした。元資料は保存されています。");
      }
      while(active(controller)) {
        const pictures=doc.units.filter(unit=>unit.image),read=pictures.filter(unit=>unit.visualReading).length;
        setStatus(read<pictures.length?`AIが図と文字を確認しています · ${read} / ${pictures.length}ページ` : "AIがページ間の重複・食い違いを照合し、仕事を整理しています…");
        const value=await post("/api/source-document/analyze",doc,controller);if(!active(controller))return;doc=value.document;remember(doc);
        if(!value.cached)onAIResponse?.();
        if(!value.progress){setPage(0);setStatus("");break;}
      }
    } catch(cause){if(active(controller)){setError(cause instanceof Error?cause.message:"資料を整理できませんでした。");setStatus("");}}
    finally{if(active(controller)){setWorking(false);request.current=null;}}
  }
  async function upload(file:File) {
    if(file.size>DOCUMENT_MAX_BYTES){setError("8MBまでの資料を選んでください。");return;}
    setWorking(true);setError("");setStatus("資料の文字と、セル・ページの位置を読み込んでいます…");
    const controller=begin();remember(null);setSourceIds(undefined);
    try {
      const data=new FormData();data.set("projectId",projectId);data.set("file",file);data.set("stage","1");
      const response=await fetch("/api/source-document",{method:"POST",body:data,signal:controller.signal});const value=await response.json();
      if(!active(controller))return;
      if(!response.ok)throw new Error(value.error??"資料を読み込めませんでした。");
      remember(value.document);setRaw(false);
      setLibrary(current=>[{id:value.document.id,name:value.document.name,format:value.document.format,createdAt:value.document.createdAt},...current.filter(doc=>doc.id!==value.document.id)].slice(0,20));
      if(value.document.lifecycle?.state!=="withdrawn")await analyze(value.document,controller);else setStatus("");
    } catch(cause){if(active(controller)){setError(cause instanceof Error?cause.message:"資料を読み込めませんでした。");setStatus("");}}
    finally{if(request.current===controller){setWorking(false);request.current=null;}}
  }
  async function open(id:string) {
    const controller=begin();setWorking(true);setError("");setStatus("元資料を開いています…");remember(null);
    try {const response=await fetch(sourceURL(projectId,id),{signal:controller.signal});const value=await response.json();if(!active(controller))return;if(!response.ok)throw new Error(value.error);remember(value.document);setPage(0);setRaw(false);setSourceIds(undefined);setStatus("");}
    catch(cause){if(active(controller)){setError(cause instanceof Error?cause.message:"資料を開けませんでした。");setStatus("");}}finally{if(active(controller)){setWorking(false);request.current=null;}}
  }
  async function withdraw() {
    request.current?.abort();request.current=null;setWorking(false);setWithdrawing(true);setError("");setStatus("");
    const doc=currentDocument.current;
    try {
      if(doc){const response=await fetch("/api/source-document/state",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId,documentId:doc.id,state:"withdrawn"})});const value=await response.json();if(!response.ok)throw new Error(value.error);remember(value.document);onWithdraw?.(doc.id);}
      else setStatus("アップロードをやめました。仕事は追加していません。");
    }catch(cause){setError(cause instanceof Error?cause.message:"資料の使用を取り消せませんでした。再試行できます。");}finally{setWithdrawing(false);}
  }
  async function resume() {
    if(!document)return;setWithdrawing(true);setError("");
    try{const response=await fetch("/api/source-document/state",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId,documentId:document.id,state:"active"})});const value=await response.json();if(!response.ok)throw new Error(value.error);remember(value.document);setWithdrawing(false);await analyze(value.document);}
    catch(cause){setError(cause instanceof Error?cause.message:"再開できませんでした。");}finally{setWithdrawing(false);}
  }
  const withdrawn=document?.lifecycle?.state==="withdrawn", disabled=busy||working||withdrawing, items=withdrawn?[]:document?.workItems??[];
  const savedCount=document?[...savedIds].filter(id=>id.startsWith(`doc-${document.id}-`)).length:0;
  async function sample(format:"xlsx"|"pdf"|"pptx"|"docx"|"scan"|"image") {
    setError("");
    try {const names={xlsx:"audit-business-controls.xlsx",pdf:"manufacturing-audit.pdf",pptx:"audit-business-diagrams.pptx",docx:"audit-work-instruction.docx",scan:"scanned-business-diagrams.pdf",image:"vendor-inspection.png"};const response=await fetch(`/examples/${names[format]}`);if(!response.ok)throw new Error("資料の例を開けませんでした。");const blob=await response.blob();await upload(new File([blob],names[format]));}
    catch(cause){setError(cause instanceof Error?cause.message:"資料の例を開けませんでした。");}
  }
  return <section className="document-input-panel" aria-label="資料から仕事を読み込む">
    <header><div><h2>資料から始める</h2>{!document&&<p>業務の名前を先に決めず、資料に書かれた仕事から流れを確かめられます。</p>}</div><button className="button-secondary" disabled={disabled} onClick={onClose}>入力画面へ戻る</button></header>
    <div className="document-upload" data-ready={!!items.length}><button className={document?"button-secondary":"button-primary"} disabled={disabled} onClick={()=>input.current?.click()}>{document?"別の資料・画像を選ぶ":"資料・画像を選ぶ"}</button>
      <input ref={input} type="file" accept=".xlsx,.pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp" aria-label="読み込む資料・画像" hidden onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);e.target.value="";}}/>
      {!!library.length&&<label className="document-library-select">取り込んだ資料<select aria-label="取り込んだ資料を開く" value={document?.id??""} disabled={disabled} onChange={e=>{if(e.target.value)void open(e.target.value);}}><option value="">資料を選ぶ · 最近20件まで</option>{library.map(doc=><option value={doc.id} key={doc.id}>{doc.name}</option>)}</select></label>}
      {!document&&<p>Excel・PDF・Word・PowerPoint・PNG・JPEG・WebP / 8MBまで。図を含む資料は80ページまでです。</p>}
    </div>
    {!document&&<details className="document-examples"><summary>架空の会社の資料で試す</summary><button className="input-text-button" disabled={disabled} onClick={()=>sample("xlsx")}>監査Excelの例を読み込む</button><button className="input-text-button" disabled={disabled} onClick={()=>sample("pdf")}>調査PDFの例を読み込む</button><button className="input-text-button" disabled={disabled} onClick={()=>sample("pptx")}>業務図のPowerPointを読み込む</button><button className="input-text-button" disabled={disabled} onClick={()=>sample("docx")}>手順書のWordを読み込む</button><button className="input-text-button" disabled={disabled} onClick={()=>sample("scan")}>画像PDFの例を読み込む</button><button className="input-text-button" disabled={disabled} onClick={()=>sample("image")}>業務図の画像を読み込む</button></details>}
    {status&&<p className="document-status" role="status">{status}</p>}
    {(document||working)&&!withdrawn&&<div className="document-cancel"><button className="button-secondary" disabled={busy||withdrawing} onClick={()=>void withdraw()}>この資料を使うのをやめる</button><small>保存前の候補を取り消せます。{savedCount?`保存した${savedCount}件の仕事は残ります。`:"仕事は、図を確かめて保存するまで追加されません。"}</small></div>}
    {error&&<p className="error-message" role="alert">{error}</p>}
    {document&&<>
      {withdrawn&&<div className="document-withdrawn" role="status"><h3>この資料の使用を取り消しました</h3><p>保存前の候補は取り消しています。{savedCount?`保存した${savedCount}件の仕事と、その根拠は残っています。`:"会社の構造に仕事は追加していません。"}元資料と読めたページは残しているので、必要なときに続きから再開できます。</p><button className="button-secondary" disabled={disabled} onClick={()=>void resume()}>この資料の読取りを再開する</button><button className="button-primary" onClick={onClose}>話の入力へ戻る</button></div>}
      <div className="document-reading-heading"><h3>{document.name}</h3><small>元資料を保存済み{document.units.length?` · ${document.units.length}箇所を読み込み`:""}{document.analysis&&" · 仕事の分け方はAIの候補"}</small></div>
      <details className="document-limitations"><summary>読み取った範囲・読み取れない内容を確認</summary>{document.warnings.map((text,i)=><p key={i}>{text}</p>)}</details>
      {!items.length&&!working&&!withdrawn&&<button className="button-secondary" disabled={disabled} onClick={()=>void analyze(document)}>{document.analysis?"資料の仕事をもう一度確認する":"続きから資料を読み取る"}</button>}
      {!!document.findings?.length&&!withdrawn&&<details className="document-findings" aria-label="ページ間の照合"><summary>ページの照合 · {document.findings.length}件{document.findings.some(f=>f.kind==="conflict")&&` · 食い違い${document.findings.filter(f=>f.kind==="conflict").length}件`}</summary>{document.findings.map((finding,i)=><article key={i} data-kind={finding.kind}><strong>{{duplicate:"同じ説明",conflict:"食い違い・要確認",scope_difference:"対象・版の違い",unknown:"資料だけでは未確認"}[finding.kind]}</strong><p>{finding.description}</p><button className="input-text-button" onClick={()=>{setSourceIds(finding.unitIds);setRaw(true);}}>{finding.unitIds.map(id=>document.units.find(unit=>unit.id===id)?.location).join(" / ")}を確かめる</button></article>)}</details>}
      {!!items.length&&<>
        <div className="document-work-heading"><h3>図で確かめる仕事を選ぶ</h3><p>業務の分け方はAIの候補です。元資料と違うところは、図を見ながら直せます。</p></div>
        <div className="document-work-cards">{items.slice(page*6,(page+1)*6).map(item=>{
          const itemKey=`doc-${document.id}-${item.id}`, done=completed.has(itemKey), saved=savedIds.has(itemKey);
          const evidence=document.units.filter(unit=>item.unitIds.includes(unit.id));
          return <article key={item.id}><div className="document-scope">{item.scope==="future"?"将来案":item.scope==="alternative"?"代替案":"現在"}{item.site&&` · ${item.site}`}<span>{saved?"保存済み":done?"保存前":"未読"}</span></div><h4>{item.title}</h4><button className="button-primary" disabled={disabled} onClick={()=>onStart(document,item)}>{saved?"この仕事の流れを開く":done?"保存前の候補を開く":"この仕事を図で確かめる"} →</button><p>{item.note}</p><small>原資料：{evidence.slice(0,2).map(unit=>unit.location).join("、")}{evidence.length>2?` ほか${evidence.length-2}箇所`:""}</small></article>;
        })}</div>
        {items.length>6&&<nav className="document-pagination" aria-label="資料に書かれた仕事のページ"><button disabled={!page||disabled} onClick={()=>setPage(page-1)}>前の6件</button><span>{page*6+1}–{Math.min(items.length,(page+1)*6)} / {items.length}</span><button disabled={(page+1)*6>=items.length||disabled} onClick={()=>setPage(page+1)}>次の6件</button></nav>}
      </>}
      <button className="input-text-button" onClick={()=>{setRaw(true);setSourceIds(undefined);}}>元資料と読取りを見比べる</button>
      <dialog ref={sourceDialog} className="document-evidence-dialog" aria-label="元資料とAIの読取り" onCancel={()=>setRaw(false)}><header><h2>元資料とAIの読取り</h2><button className="button-secondary" onClick={()=>setRaw(false)}>資料の仕事へ戻る</button></header>
        <p>{document.name} · 図や文字の読取りは推定です。元ページと見比べて確かめられます。</p>
        <a className="input-text-button" href={`${sourceURL(projectId,document.id)}&original=1`}>元のファイルを保存</a>
        {raw&&<SourceUnits key={sourceIds?.join(",")??"all"} projectId={projectId} document={document} unitIds={sourceIds}/>}
      </dialog>
    </>}
  </section>;
}

export function SourceUnits({document,unitIds,projectId}: {document:SourceDocument;unitIds?:string[];projectId?:string}) {
  const [page,setPage]=useState(0);
  const [zoomed,setZoomed]=useState(false);
  const units=unitIds?document.units.filter(unit=>unitIds.includes(unit.id)):document.units;
  const perPage=units.some(unit=>unit.image)?1:12;
  const count=Math.max(1,Math.ceil(units.length/perPage)), current=Math.min(page,count-1);
  const pagination=count>1?<nav className="document-pagination" aria-label="元資料のページ切替"><button disabled={!current} onClick={()=>{setPage(current-1);setZoomed(false);}}>{perPage===1?"前のページ":"前の12箇所"}</button><span>{current*perPage+1}{perPage>1?`–${Math.min(units.length,(current+1)*perPage)}`:""} / {units.length}</span><button disabled={current+1>=count} onClick={()=>{setPage(current+1);setZoomed(false);}}>{perPage===1?"次のページ":"次の12箇所"}</button></nav>:null;
  return <section className="document-source-units" aria-label="元資料のセルとページ">
    {pagination}
    {units.slice(current*perPage,(current+1)*perPage).map(unit=><article key={unit.id}><h4>{unit.location}</h4>{unit.image&&projectId?<div className="document-page-comparison"><figure data-zoomed={zoomed}><button className="document-page-image" aria-label={`${unit.location}の画像を${zoomed?"ページ全体に戻す":"大きく見る"}`} onClick={()=>setZoomed(!zoomed)}><img src={`${sourceURL(projectId,document.id)}&image=${encodeURIComponent(unit.id)}`} width={unit.image.width} height={unit.image.height} alt={`${document.name}の${unit.location}`} /></button><figcaption>元資料を画像にした表示 · {zoomed?"クリックでページ全体に戻す":"クリックで大きく見る"}</figcaption></figure><div><h5>AIが画像から読んだ内容 · 要確認</h5>{unit.visualReading?<><p>{unit.visualReading.description}</p>{!!unit.visualReading.uncertainties.length&&<details open><summary>画像だけでは確かめられないこと</summary>{unit.visualReading.uncertainties.map((text,i)=><p key={i}>{text}</p>)}</details>}</>:<p>このページはまだAIが読んでいません。元の図や文字は、ここで確認できます。</p>}{!!unit.text&&<details><summary>文字として取り出した内容</summary><pre>{unit.text}</pre></details>}</div></div>:unit.cells?<dl className="document-cell-grid">{unit.cells.filter((cell,i,cells)=>cells.findIndex(c=>c.sourceAddress===cell.sourceAddress)===i).map(cell=>{
      const same=unit.cells!.filter(c=>c.sourceAddress===cell.sourceAddress), location=same.length>1?`${same[0].address}:${same.at(-1)!.address}`:cell.address;
      return <div key={cell.address}><dt>{location}{cell.sourceAddress!==cell.address&&<small>結合元{cell.sourceAddress}</small>}</dt><dd>{cell.text||<span className="input-unconfirmed">空欄・未確認</span>}</dd></div>;
    })}</dl>:<pre>{unit.text}</pre>}</article>)}
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
          {doc.lifecycle?.state==="withdrawn"&&<p className="document-source-withdrawn">この資料の使用は取り消されています。保存時の根拠として残しています。</p>}
          <SourceUnits key={all?"all":focusText} projectId={projectId} document={doc} unitIds={!all&&matches.length?matches.map(unit=>unit.id):ref.unitIds}/></>:<p role="status">元資料を開いています…</p>}</article>;
      })}
    </dialog>
  </div>;
}
