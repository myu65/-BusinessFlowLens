import type { ExtractionReview, ExtractionReviewStep } from '../../lib/graph';

export const diagramStep = (key: string, order: number, name: string): ExtractionReviewStep => ({
  stepKey: key, order, name, action: name, actor: '品質担当', department: '品質管理部', responsiblePerson: null,
  executionMode: 'manual', executingSystem: null, certainty: 'explicit', evidence: name, systems: [], data: [],
});

/** Independent fictional evidence. Never taken from a user's project. */
export const diagramReview: ExtractionReview = {
  summary: '検査値を判定し、合格なら出荷へ。不合格は再調整、2回でも不合格なら保留する。',
  trigger: '検査結果が届く', outcome: '出荷可能の判定、または保留', questions: [], warnings: [],
  extraction: { method: 'local', provider: 'fixture', completedAt: '2026-10-12T00:00:00Z' },
  documentEvidence: [{ documentId: 'fictional-quality', documentName: '検証用の品質手順.pdf', sha256: 'fictional', itemId: 'quality', unitIds: ['page-1'] }],
  steps: [
    { ...diagramStep('prepare', 1, '検査値を確認する'), systems: [{ name: 'Excel', interaction: 'view', evidence: 'Excelの検査値を確認する' }] },
    { ...diagramStep('check', 2, 'LIMSが規格と照合する'), actor: null, executionMode: 'automatic', executingSystem: 'LIMS',
      systems: [{ name: 'LIMS', interaction: 'other', evidence: 'LIMSが規格と照合する' }],
      data: [{ name: '検査値', operation: 'read', evidence: '検査値を規格と照合する' }, { name: '合否判定', operation: 'create', evidence: '合否を確定する' }],
      meaning: { purpose: '出荷の可否を判断する', basis: '検査値と品質規格', result: '合否を確定する', next: '合格なら出荷承認へ', condition: '', halt: false, certainty: 'confirmed', evidence: 'LIMSが検査値を規格と照合して合否を確定する' },
      sourceRefs: [{ documentId: 'fictional-quality', unitId: 'page-1' }] },
    { ...diagramStep('approve', 3, '品質責任者が出荷を承認する'), actor: '品質責任者',
      humanEdits: [{ field: 'actor', before: '品質担当', after: '品質責任者', evidence: '実際の承認者は品質責任者です' }],
      systems: [{ name: 'Teams', interaction: 'approve', evidence: 'Teamsで品質責任者が承認する' }] },
    { ...diagramStep('ship', 4, 'MESへ出荷可否を送る'), actor: null, executionMode: 'automatic', executingSystem: 'LIMS',
      data: [{ name: '出荷可能の判定', operation: 'send', evidence: '出荷可能の判定をMESへ送る' }],
      systems: [{ name: 'LIMS', interaction: 'send', evidence: 'MESへ送る' }, { name: 'MES', interaction: 'receive', evidence: 'LIMSから受け取る' }] },
    diagramStep('rework', 5, '再調整する'),
    { ...diagramStep('hold', 6, '出荷を保留する'), actor: null, executionMode: 'unknown', certainty: 'inferred',
      meaning: { purpose: '', basis: '再調整2回でも不合格', result: '出荷を保留する', next: '', condition: '', halt: true, certainty: 'confirmed', evidence: '再調整2回でも不合格なら保留。解除する担当と再開先は未確認' } },
  ],
  transitions: [
    ['prepare', 'check', null], ['check', 'approve', '規格内'], ['approve', 'ship', '承認済み'],
    ['check', 'rework', '規格外・再調整2回未満'], ['rework', 'check', '再調整後に再判定'], ['check', 'hold', '再調整2回でも規格外'],
  ].map(([fromStepKey, toStepKey, condition]) => ({ fromStepKey: fromStepKey!, toStepKey: toStepKey!, condition, evidence: condition ?? '検査値を確認して規格と照合する', certainty: 'confirmed' })),
  dataFlows: [{ sourceSystem: 'LIMS', targetSystem: 'MES', data: ['出荷可能の判定'], transferType: 'api', direction: 'push', automation: 'automatic', frequency: '承認後', evidence: '承認後にLIMSからMESへ出荷可能の判定をAPIで送る', certainty: 'explicit', relatedStepKeys: ['ship'] }],
};
