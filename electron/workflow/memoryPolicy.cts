import type { MemoryClass, MemoryScope } from './narrativeModels.cjs';

export interface MemoryPolicy {
  readonly memoryClass: MemoryClass;
  readonly importance: number;
  readonly retentionPolicy: 'permanent' | 'stable' | 'episodic' | 'working';
  readonly retrievalScope: MemoryScope;
}

const importantPlot = /死亡|阵亡|失踪|背叛|结婚|离婚|觉醒|继承|真相|身份|秘密|任命|辞职|加入|离开|敌对|和解|世界|规则|禁忌|契约|诅咒|复活|穿越|时间线|世界线/u;

export const memoryPolicyFor = (kind: string, predicate: string, statement: string, confidence: number): MemoryPolicy => {
  const key = `${kind}:${predicate}`.toLowerCase();
  const confidenceWeight = Math.max(0, Math.min(1, confidence));
  if (/identity|secret|setting|foreshadowing|canon/u.test(key)) return {
    memoryClass: 'canon', importance: Math.max(0.78, confidenceWeight), retentionPolicy: 'permanent', retrievalScope: 'series',
  };
  if (/relationship|address/u.test(key)) return {
    memoryClass: 'relationship', importance: Math.max(0.68, confidenceWeight * 0.9), retentionPolicy: 'stable', retrievalScope: 'series',
  };
  if (/voice|character|appearance|age|affiliation|occupation|injury|number|gender/u.test(key)) return {
    memoryClass: /voice|character/u.test(key) ? 'character' : 'state',
    importance: Math.max(0.58, confidenceWeight * 0.88), retentionPolicy: 'stable', retrievalScope: 'volume',
  };
  if (/chapter-summary|scene-summary/u.test(key)) return {
    memoryClass: 'episode-detail', importance: /chapter-summary/u.test(key) ? 0.62 : 0.48,
    retentionPolicy: /chapter-summary/u.test(key) ? 'episodic' : 'working', retrievalScope: 'chapter',
  };
  if (/event/u.test(key) || importantPlot.test(statement)) return {
    memoryClass: 'event', importance: importantPlot.test(statement) ? Math.max(0.76, confidenceWeight) : Math.max(0.52, confidenceWeight * 0.84),
    retentionPolicy: importantPlot.test(statement) ? 'stable' : 'episodic',
    retrievalScope: importantPlot.test(statement) ? 'series' : 'volume',
  };
  return { memoryClass: 'episode-detail', importance: Math.max(0.3, confidenceWeight * 0.65),
    retentionPolicy: 'episodic', retrievalScope: 'scene' };
};

export const acceptedModelPolicy = (
  derived: MemoryPolicy,
  _suggestedClass: unknown,
  suggestedImportance: unknown,
  suggestedScope: unknown,
): MemoryPolicy => {
  const allowedScopes = new Set<MemoryScope>(['series', 'volume', 'chapter', 'scene']);
  const scopeRank: Readonly<Record<MemoryScope, number>> = { scene: 0, chapter: 1, volume: 2, series: 3 };
  const modelImportance = Number(suggestedImportance);
  const requestedScope = allowedScopes.has(suggestedScope as MemoryScope) ? suggestedScope as MemoryScope : derived.retrievalScope;
  return {
    // 模型只提供建议，不能把普通情节擅自升级为设定/人物事实；类别始终由可审计规则决定。
    memoryClass: derived.memoryClass,
    importance: Number.isFinite(modelImportance)
      ? Math.max(derived.importance - 0.1, Math.min(derived.importance + 0.1, Math.max(0, Math.min(1, modelImportance))))
      : derived.importance,
    retentionPolicy: derived.retentionPolicy,
    // 允许模型缩小检索范围以减少噪声，禁止扩大到跨卷范围。
    retrievalScope: scopeRank[requestedScope] <= scopeRank[derived.retrievalScope] ? requestedScope : derived.retrievalScope,
  };
};
