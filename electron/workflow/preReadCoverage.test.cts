import { describe, expect, it } from 'vitest';
import {
  applyPreReadCoveragePatch,
  auditPreReadEntityCoverage,
  clearGenericPreReadReferences,
  terminologyEntryCount,
} from './preReadCoverage.cjs';

const base = {
  entities: [], glossary: [], facts: [], events: [], frames: [],
};

describe('pre-read entity coverage', () => {
  it('rejects invented slugs and missing named actors before persistence', () => {
    const audit = auditPreReadEntityCoverage({
      ...base,
      facts: [{ subjectKey: 'tanya_degurechaff', objectKey: '' }],
      events: [{ agentKey: 'tanya_degurechaff', patientKey: '共和国軍', recipientKey: '' }],
    });
    expect(audit.unresolvedKeys).toEqual(['tanya_degurechaff', '共和国軍']);
    expect(audit.issues).toHaveLength(2);
  });

  it('accepts canonical Japanese names and evidenced aliases', () => {
    const audit = auditPreReadEntityCoverage({
      ...base,
      entities: [{
        sourceName: 'ターニャ・デグレチャフ', canonicalSourceName: 'ターニャ・デグレチャフ',
        translatedName: '谭雅·提古雷查夫', evidence: [{ excerpt: 'ターニャ・デグレチャフ魔導中尉' }],
        aliases: [
          { sourceForm: 'ターニャ', translatedForm: '谭雅', evidenceExcerpt: 'ターニャ・デグレチャフ' },
          { sourceForm: '白銀', translatedForm: '白银', evidenceExcerpt: '白銀のターニャ' },
        ],
      }],
      glossary: [{ sourceTerm: '共和国軍' }],
      facts: [{ subjectKey: 'ターニャ', objectKey: '共和国軍', characterKnowledge: { 'ターニャ・デグレチャフ': {} } }],
      events: [{ agentKey: 'ターニャ・デグレチャフ', patientKey: '共和国軍', recipientKey: '' }],
      frames: [{ viewpointKey: 'ターニャ', participantKeys: ['ターニャ・デグレチャフ'] }],
    });
    expect(audit.unresolvedKeys).toEqual([]);
  });

  it('resolves an early-piece reference from an entity found later in the same chapter', () => {
    const audit = auditPreReadEntityCoverage({
      ...base,
      entities: [{
        sourceName: 'ターニャ・デグレチャフ', translatedName: '谭雅·提古雷查夫',
        evidence: [{ excerpt: 'ターニャ・デグレチャフ中尉' }],
        aliases: [{ sourceForm: 'ターニャ', translatedForm: '谭雅', evidenceExcerpt: 'ターニャ・デグレチャフ中尉' }],
      }],
      events: [{ agentKey: 'ターニャ', patientKey: '', recipientKey: '' }],
    });
    expect(audit.unresolvedKeys).toEqual([]);
  });

  it('accepts a canonical key already persisted by an earlier chapter', () => {
    const audit = auditPreReadEntityCoverage({
      ...base,
      knownReferenceKeys: ['ターニャ・デグレチャフ', 'ターニャ'],
      events: [{ agentKey: 'ターニャ', patientKey: '', recipientKey: '' }],
    });
    expect(audit.unresolvedKeys).toEqual([]);
  });

  it('clears unnamed generic actors without turning them into terminology', () => {
    const cleaned = clearGenericPreReadReferences({
      ...base,
      facts: [{ subjectKey: '兵士', objectKey: '帝国', characterKnowledge: { '敵': { knows: true } } }],
      events: [{ agentKey: '敵', patientKey: '兵士', recipientKey: '' }],
      frames: [{ viewpointKey: '', participantKeys: ['敵', '帝国'] }],
    });
    expect(cleaned.facts[0]).toMatchObject({ subjectKey: '', objectKey: '帝国', characterKnowledge: {} });
    expect(cleaned.events[0]).toMatchObject({ agentKey: '', patientKey: '' });
    expect(cleaned.frames[0].participantKeys).toEqual(['帝国']);
    expect(auditPreReadEntityCoverage(cleaned).unresolvedKeys).toEqual(['帝国']);
  });

  it('applies a compact chapter repair patch to all matching semantic keys', () => {
    const repaired = applyPreReadCoveragePatch({
      ...base,
      facts: [{ subjectKey: 'tanya_slug', objectKey: 'イルドリア戦線' }],
      events: [{ agentKey: 'tanya_slug', patientKey: 'イルドリア戦線', recipientKey: '' }],
    }, {
      addedEntities: [{
        sourceName: 'ターニャ・デグレチャフ', translatedName: '谭雅·提古雷查夫',
        evidence: [{ excerpt: 'ターニャ・デグレチャフ中尉' }],
      }],
      addedGlossary: [{ sourceTerm: 'イルドリア戦線' }],
      keyRewrites: [{ from: 'tanya_slug', to: 'ターニャ・デグレチャフ' }],
    });
    expect(repaired.facts[0]).toMatchObject({ subjectKey: 'ターニャ・デグレチャフ', objectKey: 'イルドリア戦線' });
    expect(repaired.events[0]).toMatchObject({ agentKey: 'ターニャ・デグレチャフ', patientKey: 'イルドリア戦線' });
    expect(auditPreReadEntityCoverage(repaired).unresolvedKeys).toEqual([]);
  });

  it('does not accept an entity name without translation and direct evidence', () => {
    const audit = auditPreReadEntityCoverage({
      ...base,
      entities: [{ sourceName: 'ターニャ', canonicalSourceName: 'ターニャ', translatedName: '谭雅', evidence: [] }],
      facts: [{ subjectKey: 'ターニャ', objectKey: '' }],
    });
    expect(audit.unresolvedKeys).toEqual(['ターニャ']);
  });

  it('recognizes pronouns and military ranks as generic rather than unresolved entities', () => {
    const audit = auditPreReadEntityCoverage({
      ...base,
      facts: [
        { subjectKey: '私', objectKey: '帝国' },
        { subjectKey: '中隊長', objectKey: '少尉' },
        { subjectKey: '俺', objectKey: '' },
      ],
    });
    // '私', '中隊長', '少尉', '俺' are generic, so only '帝国' is unresolved
    expect(audit.genericKeys).toContain('私');
    expect(audit.genericKeys).toContain('中隊長');
    expect(audit.genericKeys).toContain('少尉');
    expect(audit.genericKeys).toContain('俺');
    expect(audit.unresolvedKeys).toEqual(['帝国']);
  });

  it('counts entities as terminology entries without double counting glossary duplicates', () => {
    expect(terminologyEntryCount({
      entities: [{ sourceName: 'ターニャ・デグレチャフ' }],
      glossary: [{ sourceTerm: 'ターニャ・デグレチャフ' }, { sourceTerm: '魔導師' }],
    })).toBe(2);
    expect(terminologyEntryCount({
      entities: [], glossary: [{ sourceTerm: '敵' }, { sourceTerm: '兵士' }, { sourceTerm: '帝国' }],
    })).toBe(1);
  });
});

