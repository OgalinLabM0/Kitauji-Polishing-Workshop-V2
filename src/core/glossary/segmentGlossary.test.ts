import { describe, expect, it } from 'vitest';
import type { GlossaryEntry, GlossaryResolutionContext, GlossaryVariant } from './models';
import { buildSegmentGlossaryPack } from './segmentGlossary';
import {
  GLOSSARY_EXTRACTION_PROMPT_CONTRACT,
  GLOSSARY_TRANSLATION_PROPOSAL_PROMPT_CONTRACT,
} from './glossaryPromptContracts';

const entry = (entryId: string, sourceTerm: string, canonicalChinese: string): GlossaryEntry => ({
  entryId,
  sourceTerm,
  sourceAliases: [],
  canonicalChinese,
  category: 'character',
  referentKind: 'person',
  gender: { value: 'unknown', confidence: 'high', evidenceIds: [] },
  senseSummary: '测试人物',
  status: 'locked',
  origin: 'manual',
  occurrenceCount: 2,
  firstSeenParagraphId: '001-001',
  confidence: 'confirmed',
  evidenceIds: ['ev-1'],
  exactMatch: true,
});

const context: GlossaryResolutionContext = {
  japanese: '関ちゃんは北宇治へ向かった。',
  paragraphId: '003-010',
  speakerId: 'a',
  targetId: 'seki',
  relationshipStageId: 'familiar',
  atmosphereTags: ['private'],
};

const variant: GlossaryVariant = {
  variantId: 'seki-chan',
  entryId: 'seki',
  sourceForm: '関ちゃん',
  chineseForm: '小关',
  kind: 'nickname',
  scope: { speakerIds: ['a'], targetIds: ['seki'], relationshipStageIds: ['familiar'] },
  status: 'approved',
  evidenceIds: ['ev-2'],
  confidence: 'high',
};

describe('segment glossary pack', () => {
  it('只打包当前分段实际命中的基础条目或情境变体', () => {
    const pack = buildSegmentGlossaryPack(
      [entry('seki', '関', '关'), entry('kitauji', '北宇治', '北宇治'), entry('absent', '祈', '祈')],
      [variant],
      context,
    );

    expect(pack.mappings.map((mapping) => mapping.sourceForm)).toEqual(['関ちゃん', '北宇治']);
    expect(pack.mappings.every((mapping) => mapping.instruction.includes('不得据此添加'))).toBe(true);
    expect(pack.skipped.some((resolution) => resolution.entryId === 'absent')).toBe(true);
  });

  it('同形词命中不同译名时阻止自动注入', () => {
    const pack = buildSegmentGlossaryPack(
      [entry('person-sora', '空', '空'), entry('sky-sora', '空', '天空')],
      [],
      { ...context, japanese: '空を見上げた。' },
    );

    expect(pack.mappings).toHaveLength(0);
    expect(pack.reviewRequired).toHaveLength(2);
  });

  it('提取和译名提案契约都禁止用记忆添加原文不存在的信息', () => {
    expect(GLOSSARY_EXTRACTION_PROMPT_CONTRACT).toContain('不得添加原文不存在的性别、人数');
    expect(GLOSSARY_TRANSLATION_PROPOSAL_PROMPT_CONTRACT).toContain('人物记忆只用于消歧，不是补写授权');
    expect(GLOSSARY_TRANSLATION_PROPOSAL_PROMPT_CONTRACT).toContain('所有输出都是待人工复核候选');
  });
});
