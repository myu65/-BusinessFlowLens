export function completeDocumentAnalysis<T extends { progress?: { stage: string; read: number; total: number } }>(analyze: () => Promise<T>, expectedPages: number): Promise<T>;
