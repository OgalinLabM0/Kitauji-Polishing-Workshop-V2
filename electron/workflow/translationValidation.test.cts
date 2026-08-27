import { describe, expect, it } from 'vitest';
import { validateTranslationCandidate } from './translationValidation.cjs';

describe('translation hard gate', () => {
  it('blocks added gender, plural, honorific and changed Arabic numbers', () => {
    const codes = validateTranslationCandidate('関は20分待った。', '关先生让他们等了二十分钟。').map((issue) => issue.code);
    expect(codes).toContain('number');
    expect(codes).toContain('plural-added');
    expect(codes).toContain('honorific-added');
  });

  it('allows gendered pronouns only when the source lexicalizes them', () => {
    expect(validateTranslationCandidate('彼女は来た。', '她来了。').map((issue) => issue.code)).not.toContain('gender-added');
    expect(validateTranslationCandidate('祈は来た。', '她来了。').map((issue) => issue.code)).toContain('gender-added');
  });

  it('keeps matching Japanese quote types', () => {
    expect(validateTranslationCandidate('「待て！」', '“等等！”').map((issue) => issue.code)).toContain('quote');
    expect(validateTranslationCandidate('「待て！」', '「等等！」')).toEqual([]);
  });

  it('does not mistake ordinary Chinese compounds or in-story wording for model pollution', () => {
    expect(validateTranslationCandidate('その他の方法だ。', '这是其他办法。').map((issue) => issue.code)).not.toContain('gender-added');
    expect(validateTranslationCandidate('以下は命令だ。', '以下是命令。').map((issue) => issue.code)).not.toContain('pollution');
  });
});
