import { describe, expect, it } from 'vitest';
import { adjudicateSemanticRoles, analyzeJapaneseSyntax } from './japaneseSyntaxEvidence.cjs';

describe('Japanese syntax evidence', () => {
  it('records nested quotation, voice and giving/receiving cues with character offsets', () => {
    const source = '「先生に宿題をやらせられた」と彼は言って、手伝ってくれた。';
    const evidence = analyzeJapaneseSyntax('s1', source);
    expect(evidence.cues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'quote-boundary', label: 'quote-level-1', startOffset: 0 }),
      expect.objectContaining({ kind: 'voice', label: 'causative-passive' }),
      expect.objectContaining({ kind: 'giving-receiving', label: 'giving-receiving' }),
    ]));
  });

  it('downgrades a model role map when a strong morphology cue conflicts', () => {
    const source = '先生に宿題をやらせられた。';
    const syntax = analyzeJapaneseSyntax('s1', source);
    const result = adjudicateSemanticRoles([{ id: 's1', propositions: [{
      predicate: 'やる', agent: '私', patient: '宿題', recipient: '', sourceCue: source.slice(0, -1),
      sourceStartOffset: 0, sourceEndOffset: source.length - 1, voice: 'active', confidence: 0.97, ambiguity: '',
    }] }], new Map([['s1', source]]), new Map([['s1', syntax]]));
    expect(result[0].propositions[0]).toMatchObject({ syntaxAgreement: 'conflicts', confidence: 0.59 });
    expect(result[0].propositions[0].ambiguity).toContain('causative-passive');
  });
});
