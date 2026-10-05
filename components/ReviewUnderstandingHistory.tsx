import React from 'react';
import type {ExtractionReview} from '@/lib/graph';
import {latestQuestionReviews,reviewQuestionId} from '@/lib/current-understanding';

export function ReviewUnderstandingHistory({review}:{review:ExtractionReview}){
  const open=new Set(review.questions.map(reviewQuestionId));
  const resolved=latestQuestionReviews(review).filter(q=>q.state==='resolved'&&!open.has(q.id));
  return <>
    {review.summaryBasis==='structure'&&<p className="input-growing-hint">現在の図に登録された作業と道具を説明しています。以前の読み取りは下に残しています。</p>}
    {!!review.readingHistory?.length&&<details className="input-reading-history"><summary>以前の読み取り・説明 · {review.readingHistory.length}件</summary>{review.readingHistory.map((reading,index)=><article key={index}><small>{reading.reason}の前の説明</small><p>{reading.summary}</p>{reading.evidence&&<details><summary>説明を見直した理由</summary><blockquote>{reading.evidence}</blockquote></details>}</article>)}</details>}
    {!!resolved.length&&<details className="input-reading-history"><summary>人が確認済みにした質問 · {resolved.length}件</summary>{resolved.map(item=><article key={item.id}><p>{item.question.question}</p><small>利用者が確認 · {item.reviewedAt}</small><blockquote>{item.evidence}</blockquote></article>)}<p>もう一度確かめるときは、対話で「この確認事項を戻して」と質問を指定できます。</p></details>}
  </>;
}
