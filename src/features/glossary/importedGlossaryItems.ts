import type { GlossaryImportRecord } from '../../core/glossary/glossaryImport';
import type { GlossaryGenderInference } from '../../core/glossary/models';
import type { GlossaryDemoItem } from './sampleGlossaryData';
import { categoryReferentKind, glossaryCategoryLabel } from './glossaryLabels';

export type GlossaryImportHandling = 'verify' | 'locked';

const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const importedGender = (record: GlossaryImportRecord): GlossaryGenderInference => {
  if (record.category === 'character' || record.category === 'animal' || record.category === 'other') {
    return {
      value: 'unknown',
      confidence: 'medium',
      evidenceIds: [],
      note: record.category === 'other'
        ? '尚未判断实体类型；匹配原文后再判断是否需要性别记录。'
        : '导入文件没有提供可核实的原文性别证据；保持未知。',
    };
  }
  return {
    value: 'not-applicable',
    confidence: 'confirmed',
    evidenceIds: [],
    note: `${glossaryCategoryLabel(record.category)}不使用人物性别字段。`,
  };
};

export const buildImportedGlossaryItems = (
  records: readonly GlossaryImportRecord[],
  handling: GlossaryImportHandling,
  sequenceStart = 0,
): readonly GlossaryDemoItem[] => records.map((record, index) => {
  const entryId = `import-${stableHash(`${record.sourceTerm}\u0000${record.canonicalChinese}`)}-${sequenceStart + index + 1}`;
  const isLocked = handling === 'locked';
  return {
    entry: {
      entryId,
      sourceTerm: record.sourceTerm,
      sourceAliases: [],
      canonicalChinese: record.canonicalChinese,
      category: record.category,
      referentKind: categoryReferentKind(record.category),
      gender: importedGender(record),
      senseSummary: record.note || '用户导入的日中对应；尚未关联原文语境。',
      ...(record.pronunciation ? { pronunciation: record.pronunciation } : {}),
      status: isLocked ? 'locked' : 'review',
      origin: 'imported',
      occurrenceCount: 0,
      firstSeenParagraphId: '待匹配原文',
      confidence: isLocked ? 'confirmed' : 'medium',
      evidenceIds: [],
      exactMatch: true,
    },
    categoryLabel: glossaryCategoryLabel(record.category),
    statusLabel: isLocked ? '用户锁定' : '待核对',
    candidates: [record.canonicalChinese],
    warning: isLocked
      ? '锁定的是日中对应；仍须先在当前日文实际命中，不能据此补写原文没有的词。'
      : '扫描作品后再关联出现位置、日文语境与中文译文；当前不会进入正式翻译。',
    variants: [],
    wordplays: [],
    evidence: [],
    reviewRoute: isLocked
      ? {
          kind: 'confirmed' as const,
          label: '用户指定',
          reason: '仅在当前日文实际命中时使用；后续忠实审校仍会检查增译、漏译和语境误用。',
        }
      : {
          kind: 'model-review' as const,
          label: '待匹配原文',
          reason: '扫描作品后关联出现位置，并结合全书语境自动核对实体、译名和变体。',
        },
  };
});
