import { describe, expect, it } from 'vitest';
import type { GlossaryEntry, GlossaryWordplayHypothesis } from './models';
import { assessWordplayHypothesis, validateGlossaryEntityProfile } from './glossaryInference';

const entry = (override: Partial<GlossaryEntry> = {}): GlossaryEntry => ({
  entryId: 'character-1',
  sourceTerm: '祁帆',
  sourceAliases: [],
  canonicalChinese: '祁帆',
  category: 'character',
  referentKind: 'person',
  gender: { value: 'unknown', confidence: 'high', evidenceIds: [] },
  senseSummary: '人物姓名',
  status: 'review',
  origin: 'ai-extracted',
  occurrenceCount: 3,
  firstSeenParagraphId: 'p-1',
  confidence: 'high',
  evidenceIds: ['p-1'],
  exactMatch: true,
  ...override,
});

const wordplay = (override: Partial<GlossaryWordplayHypothesis> = {}): GlossaryWordplayHypothesis => ({
  hypothesisId: 'h-1',
  entryId: 'character-1',
  kind: 'near-homophone',
  sourceForm: '祁帆',
  heardOrAlternateForm: '好き',
  narrativeMeaning: '姓名被听成喜欢',
  evidenceIds: ['intro', 'pun', 'callback'],
  counterEvidenceIds: [],
  proposedChineseRenderings: ['台词内直说谐音'],
  annotationRecommended: false,
  readerKnowledgeStatus: 'safe',
  confidence: 'high',
  status: 'review',
  ...override,
});

describe('glossary entity and wordplay inference', () => {
  it('人物可以保持性别未知，不能根据名字猜测', () => {
    expect(validateGlossaryEntityProfile(entry())).toEqual([]);
  });

  it('确认人物性别必须有高置信原文证据', () => {
    const findings = validateGlossaryEntityProfile(entry({
      gender: { value: 'female', confidence: 'medium', evidenceIds: [] },
    }));
    expect(findings.map((finding) => finding.code)).toEqual([
      'GENDER_EVIDENCE_REQUIRED',
      'GENDER_CONFIDENCE_TOO_LOW',
    ]);
  });

  it('组织和地点把性别标为不适用', () => {
    expect(validateGlossaryEntityProfile(entry({
      category: 'organization',
      referentKind: 'organization',
      gender: { value: 'not-applicable', confidence: 'confirmed', evidenceIds: [] },
    }))).toEqual([]);
  });

  it('证据完整且只有一个安全谐音方案时自动接受', () => {
    expect(assessWordplayHypothesis(wordplay()).route).toBe('auto-accept');
  });

  it('谐音证据不足时继续模型检索，不提前占用人工', () => {
    expect(assessWordplayHypothesis(wordplay({ evidenceIds: ['intro'] })).route).toBe('specialist-review');
  });

  it('多个文学方案或读者知识风险才进入人工队列', () => {
    expect(assessWordplayHypothesis(wordplay({
      proposedChineseRenderings: ['直说谐音', '加译注'],
    })).route).toBe('human-required');
    expect(assessWordplayHypothesis(wordplay({
      readerKnowledgeStatus: 'needs-review',
    })).route).toBe('human-required');
  });
});
