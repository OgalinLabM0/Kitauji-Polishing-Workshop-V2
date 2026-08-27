import { createHash } from 'node:crypto';
import path from 'node:path';
import { XMLSerializer, type Document, type Element } from '@xmldom/xmldom';
import type { EpubScriptKind, EpubTextBlock } from './models.cjs';
import { allElements, elementDomPath, firstNamed, localName, normalizedText, visibleText } from './epubXml.cjs';

const blockTags = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'dt', 'dd', 'figcaption', 'blockquote', 'div', 'section']);
const protectedTextTags = new Set(['script', 'style', 'noscript', 'svg', 'math']);
const serializer = new XMLSerializer();

interface MutableBlock extends EpubTextBlock {
  explicitLanguage: string | null;
  kanaCount: number;
  hanCount: number;
  opacityHint: boolean;
  scriptKind: EpubScriptKind;
  pairedOrdinal: number | null;
}

const nearestLanguage = (element: Element) => {
  let current: Element | null = element;
  while (current) {
    const value = current.getAttribute('lang') || current.getAttribute('xml:lang');
    if (value) return value.trim().toLocaleLowerCase('en-US');
    current = current.parentNode?.nodeType === 1 ? current.parentNode as Element : null;
  }
  return null;
};

const insideProtectedTree = (element: Element) => {
  let current: Element | null = element;
  while (current) {
    if (protectedTextTags.has(localName(current))) return true;
    current = current.parentNode?.nodeType === 1 ? current.parentNode as Element : null;
  }
  return false;
};

const hasNestedBlock = (element: Element) => allElements(element).some((descendant) => blockTags.has(localName(descendant)));

export const buildEpubTextBlocks = (document: Document, documentPath: string) => {
  const mutable: MutableBlock[] = [];
  for (const element of allElements(document)) {
    const tagName = localName(element);
    if (!blockTags.has(tagName) || insideProtectedTree(element) || hasNestedBlock(element)) continue;
    const sourceText = normalizedText(visibleText(element));
    if (!sourceText) continue;
    const sourceXml = serializer.serializeToString(element);
    const explicitLanguage = (element.getAttribute('lang') || element.getAttribute('xml:lang') || '').trim().toLocaleLowerCase('en-US') || null;
    const language = nearestLanguage(element);
    const kanaCount = [...sourceText].filter((character) => /[\u3040-\u30ff]/u.test(character)).length;
    const hanCount = [...sourceText].filter((character) => /[\u3400-\u9fff]/u.test(character)).length;
    const inlineStyle = element.getAttribute('style')?.trim() || '';
    const className = element.getAttribute('class')?.trim() || '';
    const styleHint = [className && `class=${className}`, inlineStyle && `style=${inlineStyle}`].filter(Boolean).join('; ') || null;
    const explicitJapanese = Boolean(explicitLanguage?.startsWith('ja') || explicitLanguage === 'jp');
    const explicitChinese = Boolean(explicitLanguage?.startsWith('zh'));
    const scriptKind: EpubScriptKind = explicitChinese
      ? (kanaCount > 0 ? 'mixed' : 'chinese')
      : explicitJapanese || kanaCount > 0 ? 'japanese' : 'neutral';
    const opacity = inlineStyle.match(/opacity\s*:\s*(0?(?:\.\d+)?)/iu)?.[1];
    mutable.push({
      ordinal: mutable.length + 1,
      domPath: elementDomPath(element),
      sourceLine: typeof (element as Element & { lineNumber?: number }).lineNumber === 'number'
        ? (element as Element & { lineNumber: number }).lineNumber : null,
      tagName,
      language,
      explicitLanguage,
      scriptKind,
      sourceText,
      sourceXml,
      sourceHash: createHash('sha256').update(`${documentPath}\0${sourceXml}`).digest('hex'),
      styleHint,
      pairedOrdinal: null,
      kanaCount,
      hanCount,
      opacityHint: opacity !== undefined && opacity !== '' && Number(opacity) <= 0.65,
    });
  }

  let langPairCount = 0;
  let opacityPairCount = 0;
  for (let index = 0; index < mutable.length - 1; index += 1) {
    const left = mutable[index];
    const right = mutable[index + 1];
    const likelyChineseLeft = left.hanCount > 0 && left.kanaCount === 0 && !left.opacityHint;
    const japaneseRight = right.kanaCount > 0;
    const langPair = likelyChineseLeft && japaneseRight && Boolean(right.explicitLanguage?.startsWith('ja') || right.explicitLanguage === 'jp');
    const opacityPair = likelyChineseLeft && japaneseRight && right.opacityHint;
    if (!langPair && !opacityPair) continue;
    left.scriptKind = 'chinese';
    right.scriptKind = 'japanese';
    left.pairedOrdinal = right.ordinal;
    right.pairedOrdinal = left.ordinal;
    if (langPair) langPairCount += 1;
    if (opacityPair) opacityPairCount += 1;
    index += 1;
  }

  const blocks: EpubTextBlock[] = mutable.map(({ explicitLanguage: _language, kanaCount: _kana, hanCount: _han, opacityHint: _opacity, ...block }) => block);
  return { blocks, langPairCount, opacityPairCount };
};

export const deriveDocumentTitle = (
  document: Document,
  navigationTitle: string | undefined,
  href: string,
  packageTitle?: string | null,
) => {
  if (navigationTitle && navigationTitle.trim()) return navigationTitle.trim();

  // Check heading tags: h1 ~ h4
  for (const heading of ['h1', 'h2', 'h3', 'h4']) {
    const element = firstNamed(document, heading);
    const value = element ? normalizedText(visibleText(element)) : '';
    if (value && value.length <= 150) return value;
  }

  // Check CSS class markers (common in Japanese light novels & epub conventions)
  for (const el of allElements(document)) {
    const cls = (el.getAttribute('class') || '').toLowerCase();
    if (
      cls.includes('chapter-title') ||
      cls.includes('c-title') ||
      cls.includes('main-title') ||
      cls.includes('midashi') ||
      cls.includes('heading') ||
      cls.includes('subtitle')
    ) {
      const val = normalizedText(visibleText(el));
      if (val && val.length >= 2 && val.length <= 120) return val;
    }
  }

  // Check <title> tag in <head>, but ignore if it is just the whole book title
  const docTitle = normalizedText(firstNamed(document, 'title')?.textContent ?? '');
  const isBookTitle = packageTitle && (docTitle === packageTitle || docTitle.startsWith(packageTitle));
  if (docTitle && !isBookTitle && !docTitle.toLowerCase().endsWith('.xhtml') && !docTitle.toLowerCase().endsWith('.html') && docTitle.length <= 150) {
    return docTitle;
  }

  // Semantic document type auto-detection by href convention
  const lowerHref = href.toLowerCase();
  if (lowerHref.includes('cover')) return '封面';
  if (lowerHref.includes('toc') || lowerHref.includes('nav')) return '目次';
  if (lowerHref.includes('colophon') || lowerHref.includes('okuzuke')) return '奥付';
  if (lowerHref.includes('afterword') || lowerHref.includes('atogaki')) return 'あとがき';

  return path.posix.basename(href);
};
