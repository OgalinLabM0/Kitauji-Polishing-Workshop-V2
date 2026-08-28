export interface TranslationValidationIssue {
  readonly code: 'empty' | 'pollution' | 'number' | 'gender-added' | 'plural-added' | 'honorific-added' | 'quote' | 'source-leak';
  readonly message: string;
}

const refusalPollution = /(?:作为(?:一个)?AI|As an AI|I cannot|抱歉，我(?:无法|不能)|```|\*\*)/iu;
const translationPreface = /^(?:以下是(?:译文|翻译结果)|翻译如下)[：:\s]/u;
const arabicNumbers = (text: string) => text.match(/\d+(?:[.,]\d+)*/gu) ?? [];
const count = (text: string, character: string) => [...text].filter((value) => value === character).length;
const japaneseLeak = /[ぁ-ゖァ-ヺ]/u;

const structuralPairs = [
  { label: '弯双引号', open: '“', close: '”' },
  { label: '弯单引号', open: '‘', close: '’' },
  { label: '日文对话引号', open: '「', close: '」' },
  { label: '日文二重引号', open: '『', close: '』' },
  { label: '实心方括号', open: '【', close: '】' },
  { label: '角括号', open: '〈', close: '〉' },
  { label: '书名号', open: '《', close: '》' },
  { label: '六角括号', open: '〔', close: '〕' },
  { label: '全角圆括号', open: '（', close: '）' },
] as const;

const quoteTopologyMismatches = (source: string, target: string) => structuralPairs.flatMap(({ label, open, close }) => {
  const sourceOpen = count(source, open);
  const sourceClose = count(source, close);
  const targetOpen = count(target, open);
  const targetClose = count(target, close);
  if (sourceOpen === targetOpen && sourceClose === targetClose) return [];
  return [`${label}：原文 ${open}×${sourceOpen}、${close}×${sourceClose}；译文 ${open}×${targetOpen}、${close}×${targetClose}`];
});

const removableClosingQuoteTail = /^[\s。！？!?…—―]*$/u;
const removableOpeningQuotePrefix = /^\s*$/u;

/**
 * Models often “correct” an intentionally unpaired paragraph quote into a full pair.
 * Only undo that narrow, mechanically provable boundary completion; all other quote
 * differences still go through the hard gate and model/human review.
 */
export const undoAddedBoundaryQuoteCompletion = (source: string, translation: string): string => {
  let repaired = translation;
  for (const { open, close } of structuralPairs.slice(0, 4)) {
    const sourceOpen = count(source, open);
    const sourceClose = count(source, close);

    if (sourceOpen > sourceClose) {
      let surplus = count(repaired, close) - sourceClose;
      while (surplus > 0) {
        const index = repaired.lastIndexOf(close);
        if (index < 0 || !removableClosingQuoteTail.test(repaired.slice(index + close.length))) break;
        repaired = `${repaired.slice(0, index)}${repaired.slice(index + close.length)}`;
        surplus -= 1;
      }
    }

    if (sourceClose > sourceOpen) {
      let surplus = count(repaired, open) - sourceOpen;
      while (surplus > 0) {
        const index = repaired.indexOf(open);
        if (index < 0 || !removableOpeningQuotePrefix.test(repaired.slice(0, index))) break;
        repaired = `${repaired.slice(0, index)}${repaired.slice(index + open.length)}`;
        surplus -= 1;
      }
    }
  }
  return repaired;
};

export const validateTranslationCandidate = (source: string, translation: string): readonly TranslationValidationIssue[] => {
  const issues: TranslationValidationIssue[] = [];
  const target = translation.trim();
  if (!target) return [{ code: 'empty', message: '模型返回了空译文。' }];
  if (refusalPollution.test(target) || translationPreface.test(target)) issues.push({ code: 'pollution', message: '译文混入说明、拒答或 Markdown。' });

  const sourceNumbers = arabicNumbers(source);
  const targetNumbers = arabicNumbers(target);
  if (sourceNumbers.join('|') !== targetNumbers.join('|')) {
    issues.push({ code: 'number', message: `阿拉伯数字格式或数量不一致：原文 [${sourceNumbers.join(', ')}]，译文 [${targetNumbers.join(', ')}]。` });
  }

  if (/她/u.test(target) && !/彼女/u.test(source)) issues.push({ code: 'gender-added', message: '原文没有「彼女」，译文添加了女性第三人称代词。' });
  const malePronounCandidate = target.replace(/(?:其他|他人|他者|他乡|他国|他日|他处|他方|他力|他用|他杀|利他|排他|吉他|马耳他)/gu, '');
  if (/他/u.test(malePronounCandidate) && !/(?:彼(?!女)|彼氏)/u.test(source)) issues.push({ code: 'gender-added', message: '原文没有可对应男性第三人称的词，译文添加了男性第三人称代词。' });
  if (/们/u.test(target) && !/(?:たち|達|ら(?:[、。！？]|$)|人々|皆|一同|諸|複数|何人|[二三四五六七八九十]人|\d+人)/u.test(source)) {
    issues.push({ code: 'plural-added', message: '原文没有明确复数证据，译文添加了“们”。' });
  }

  const honorificTarget = /(?:酱|君|桑|先生|小姐|女士|大人)/u.test(target);
  const honorificSource = /(?:ちゃん|チャン|くん|クン|さん|サン|さま|様|氏|先生|嬢|殿)/u.test(source);
  if (honorificTarget && !honorificSource) issues.push({ code: 'honorific-added', message: '原文没有称呼后缀或头衔，译文添加了称谓。' });

  const quoteMismatches = quoteTopologyMismatches(source, target);
  if (quoteMismatches.length) issues.push({
    code: 'quote',
    message: `引号/括号的字符、方向或数量与原文不一致（${quoteMismatches.join('；')}）。原文只有开符号或只有闭符号时，通常表示跨段延续，禁止擅自补成完整一对。`,
  });
  if (japaneseLeak.test(target) && !/(?:顔文字|乱码)/u.test(source)) issues.push({ code: 'source-leak', message: '译文中残留日文假名，需要确认是专名、演出还是漏译。' });
  return issues;
};
