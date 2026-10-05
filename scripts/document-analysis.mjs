/** Page reading returns progress before cross-page reconciliation; both stages must finish. */
export async function completeDocumentAnalysis(analyze, expectedPages) {
  let read = 0;
  for (let attempt = 0; attempt < Math.ceil(expectedPages / 3) + 1; attempt++) {
    const result = await analyze();
    if (!result.progress) return result;
    const progress = result.progress;
    if (progress.stage !== 'pages' || progress.total !== expectedPages || !Number.isInteger(progress.read) || progress.read <= read || progress.read > expectedPages)
      throw new Error('資料の読取りが進んでいません。ページ確認を完了できませんでした。');
    read = progress.read;
  }
  throw new Error('ページ間の照合が完了していません。');
}
