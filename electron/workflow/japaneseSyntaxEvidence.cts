import { createHash } from 'node:crypto';
import type { SegmentSemanticRoles, SemanticRoleProposition } from './narrativeModels.cjs';

export interface JapaneseSyntaxCue {
  readonly cueId: string;
  readonly kind: 'voice' | 'case-marker' | 'giving-receiving' | 'quote-boundary';
  readonly label: string;
  readonly sourceText: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly confidence: number;
  readonly markers: readonly string[];
  readonly caution: string;
}

export interface SegmentSyntaxEvidence {
  readonly segmentId: string;
  readonly sourceHash: string;
  readonly cues: readonly JapaneseSyntaxCue[];
}

const cueId = (segmentId: string, kind: string, start: number, text: string) => `syntax-${createHash('sha1')
  .update(`${segmentId}\u0000${kind}\u0000${start}\u0000${text}`).digest('hex').slice(0, 20)}`;

const addMatches = (
  target: JapaneseSyntaxCue[], segmentId: string, source: string, expression: RegExp,
  kind: JapaneseSyntaxCue['kind'], label: string, confidence: number, markers: readonly string[], caution: string,
) => {
  for (const match of source.matchAll(expression)) {
    const start = match.index ?? 0;
    const text = match[0];
    target.push({ cueId: cueId(segmentId, kind, start, text), kind, label, sourceText: text,
      startOffset: start, endOffset: start + text.length, confidence, markers, caution });
  }
};

const quoteCues = (segmentId: string, source: string) => {
  const result: JapaneseSyntaxCue[] = [];
  const stack: Array<{ char: string; start: number; level: number }> = [];
  const pairs: Record<string, string> = { '「': '」', '『': '』', '（': '）', '(': ')' };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (pairs[char]) stack.push({ char, start: index, level: stack.length + 1 });
    else {
      const top = stack.at(-1);
      if (!top || pairs[top.char] !== char) continue;
      stack.pop();
      const text = source.slice(top.start, index + 1);
      result.push({ cueId: cueId(segmentId, 'quote-boundary', top.start, text), kind: 'quote-boundary',
        label: `quote-level-${top.level}`, sourceText: text, startOffset: top.start, endOffset: index + 1,
        confidence: 1, markers: [top.char, char], caution: '只证明引语/括号边界，不独立证明说话者。' });
    }
  }
  return result;
};

export const analyzeJapaneseSyntax = (segmentId: string, source: string): SegmentSyntaxEvidence => {
  const cues: JapaneseSyntaxCue[] = [...quoteCues(segmentId, source)];
  addMatches(cues, segmentId, source, /[ぁ-んァ-ヶ一-龯々ー]+(?:させられ|せられ)(?:る|た|て|ない|ます|ました)/gu,
    'voice', 'causative-passive', 0.9, ['使役受身'], '可确定形态方向，但省略的施事者仍需上下文裁定。');
  addMatches(cues, segmentId, source, /[ぁ-んァ-ヶ一-龯々ー]+(?:させ|せ)(?:る|た|て|ない|ます|ました)/gu,
    'voice', 'causative', 0.82, ['使役'], '词形可能跨越复合谓语，角色槽位仍需模型与语境核对。');
  addMatches(cues, segmentId, source, /[ぁ-んァ-ヶ一-龯々ー]+(?:され|られ)(?:る|た|て|ない|ます|ました)/gu,
    'voice', 'passive', 0.68, ['受身候选'], 'られる 也可能表示可能、自发或尊敬，仅作为候选证据。');
  addMatches(cues, segmentId, source, /(?:て|で)(?:くれ|くださ|もら|いただ|あげ|や)(?:る|た|て|ない|ます|ました)/gu,
    'giving-receiving', 'giving-receiving', 0.88, ['授受补助动词'], '可约束恩惠视点；具体 agent/recipient 仍需结合助词与省略主语。');
  addMatches(cues, segmentId, source, /[^、。！？「」『』\s]{1,24}(?:が|は|を|に|から|へ|と)(?=[^、。！？「」『』\s])/gu,
    'case-marker', 'case-marker', 0.72, ['格助词'], '主题「は」不必然是施事者；引用「と」不必然是共同格。');
  return { segmentId, sourceHash: createHash('sha256').update(source).digest('hex'),
    cues: cues.sort((left, right) => left.startOffset - right.startOffset || right.endOffset - left.endOffset) };
};

const compatibleVoice = (modelVoice: SemanticRoleProposition['voice'], cueLabel: string) => {
  if (modelVoice === 'ambiguous' || modelVoice === 'state' || cueLabel === 'case-marker') return true;
  if (cueLabel === 'giving-receiving') return modelVoice === 'giving-receiving';
  return modelVoice === cueLabel;
};

const locateCue = (source: string, proposition: SemanticRoleProposition) => {
  const preferred = proposition.sourceStartOffset;
  if (preferred !== null && preferred !== undefined && source.slice(preferred, preferred + proposition.sourceCue.length) === proposition.sourceCue) {
    return { start: preferred, end: preferred + proposition.sourceCue.length };
  }
  const start = source.indexOf(proposition.sourceCue);
  return start < 0 ? null : { start, end: start + proposition.sourceCue.length };
};

export const adjudicateSemanticRoles = (
  roles: readonly SegmentSemanticRoles[],
  sourceById: ReadonlyMap<string, string>,
  syntaxById: ReadonlyMap<string, SegmentSyntaxEvidence>,
): readonly SegmentSemanticRoles[] => roles.map((segment) => {
  const source = sourceById.get(segment.id) ?? '';
  const syntax = syntaxById.get(segment.id);
  const propositions = segment.propositions.map((proposition): SemanticRoleProposition => {
    const span = locateCue(source, proposition);
    const structural = syntax?.cues.filter((cue) => cue.kind === 'voice' || cue.kind === 'giving-receiving')
      .filter((cue) => span && cue.startOffset < span.end && cue.endOffset > span.start) ?? [];
    const conflict = structural.find((cue) => cue.confidence >= 0.8 && !compatibleVoice(proposition.voice, cue.label));
    if (conflict) return { ...proposition, sourceStartOffset: span?.start ?? null, sourceEndOffset: span?.end ?? null,
      confidence: Math.min(proposition.confidence, 0.59), syntaxAgreement: 'conflicts',
      ambiguity: [proposition.ambiguity, `规则句法检测到 ${conflict.label}，与模型 voice=${proposition.voice} 冲突。`].filter(Boolean).join('；') };
    return { ...proposition, sourceStartOffset: span?.start ?? null, sourceEndOffset: span?.end ?? null,
      syntaxAgreement: structural.length ? 'agrees' : 'neutral' };
  });
  return { ...segment, propositions };
});
