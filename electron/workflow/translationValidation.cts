export interface TranslationValidationIssue {
  readonly code: 'empty' | 'pollution' | 'number' | 'gender-added' | 'plural-added' | 'honorific-added' | 'quote' | 'source-leak';
  readonly message: string;
}

const refusalPollution = /(?:作为(?:一个)?AI|As an AI|I cannot|抱歉，我(?:无法|不能)|```|\*\*)/iu;
const translationPreface = /^(?:以下是(?:译文|翻译结果)|翻译如下)[：:\s]/u;
const arabicNumbers = (text: string) => text.match(/\d+(?:[.,]\d+)*/gu) ?? [];
const count = (text: string, character: string) => [...text].filter((value) => value === character).length;
const japaneseLeak = /[ぁ-ゖァ-ヺ]/u;

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

  if (count(source, '「') !== count(target, '「') || count(source, '」') !== count(target, '」') || count(source, '『') !== count(target, '『') || count(source, '』') !== count(target, '』')) {
    issues.push({ code: 'quote', message: '「」或『』的数量与原文不一致。' });
  }
  if (japaneseLeak.test(target) && !/(?:顔文字|乱码)/u.test(source)) issues.push({ code: 'source-leak', message: '译文中残留日文假名，需要确认是专名、演出还是漏译。' });
  return issues;
};
