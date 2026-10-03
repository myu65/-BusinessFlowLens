"use client";
import React from "react";
import type { ExtractionReviewStep } from "@/lib/graph";
import type { ReviewStripConnection } from "@/lib/review-paths";

export function InputStripConnection({ connection, choose }: {
  connection: ReviewStripConnection;
  choose: (step: ExtractionReviewStep) => void;
}) {
  return <span className="input-strip-connection" data-kind={connection.kind}>
    {connection.kind === "next" ? <>
      <span>{connection.transition.condition ? "条件つき" : "次へ"}
        {connection.transition.certainty !== "confirmed" && <><br />要確認</>}
      </span>
      <strong aria-hidden="true">→</strong>
    </> : connection.kind === "branches" ? <>
      <span>別の条件の枝{connection.certainty !== "confirmed" && <><br />要確認</>}</span>
      <button onClick={() => choose(connection.fork)} aria-label={`分かれ道へ戻る：${connection.fork.name}`}>
        分かれ道<br />↑ {connection.fork.order}
      </button>
    </> : <>
      <span>接続は<br />未確認</span>
      <strong aria-hidden="true">···</strong>
    </>}
  </span>;
}
