import { createHash } from 'node:crypto';
import JSZip, { type JSZipObject } from 'jszip';
import type { Element } from '@xmldom/xmldom';
import type {
  EpubBilingualLayout,
  EpubImportDocument,
  EpubSpineDocument,
  ProjectContentMode,
} from './models.cjs';
import { inspectEpubArchive } from './epubArchivePolicy.cjs';
import { buildEpubTextBlocks, deriveDocumentTitle } from './epubTextBlocks.cjs';
import {
  allElements,
  countElements,
  countExternalReferences,
  elementChildren,
  elementsNamed,
  firstNamed,
  localName,
  normalizedText,
  parseXmlDocument,
  readXmlEntryBytes,
  resolveArchiveHref,
} from './epubXml.cjs';

interface ManifestItem {
  readonly id: string;
  readonly href: string;
  readonly mediaType: string;
  readonly properties: string;
}

interface ParsedSpineDocument {
  readonly document: EpubSpineDocument;
  readonly langPairCount: number;
  readonly opacityPairCount: number;
}

const buildNavigationLabels = async (
  zip: JSZip,
  items: readonly ManifestItem[],
  opfPath: string,
  availablePaths: ReadonlySet<string>,
) => {
  const labels = new Map<string, string>();
  const navigationItems = items.filter((item) => item.properties.split(/\s+/u).includes('nav'));
  const ncxItems = items.filter((item) => item.mediaType === 'application/x-dtbncx+xml');
  for (const item of [...navigationItems, ...ncxItems]) {
    const navigationPath = resolveArchiveHref(opfPath, item.href, availablePaths);
    const { text } = await readXmlEntryBytes(zip, navigationPath);
    const document = parseXmlDocument(text, navigationPath, item.mediaType === 'application/xhtml+xml' ? 'application/xhtml+xml' : 'application/xml');
    if (item.mediaType === 'application/x-dtbncx+xml') {
      const points = allElements(document).filter((n) => localName(n) === 'navpoint');
      for (const point of points) {
        const href = elementsNamed(point, 'content')[0]?.getAttribute('src') || point.getAttribute('src');
        const textNode = firstNamed(point, 'text') ?? firstNamed(point, 'navlabel');
        const label = normalizedText(textNode?.textContent ?? '');
        if (!href || !label) continue;
        try {
          const target = resolveArchiveHref(navigationPath, href, availablePaths);
          if (!labels.has(target)) labels.set(target, label);
          const targetBase = target.split('#')[0];
          if (!labels.has(targetBase)) labels.set(targetBase, label);
        } catch { /* tolerate broken auxiliary nav links */ }
      }
    } else {
      for (const anchor of elementsNamed(document, 'a')) {
        const href = anchor.getAttribute('href');
        const label = normalizedText(anchor.textContent ?? '');
        if (!href || !label) continue;
        try {
          const target = resolveArchiveHref(navigationPath, href, availablePaths);
          if (!labels.has(target)) labels.set(target, label);
          const targetBase = target.split('#')[0];
          if (!labels.has(targetBase)) labels.set(targetBase, label);
        } catch { /* landmarks may be outside the spine */ }
      }
    }
  }
  return labels;
};

const layoutFromPairs = (langPairs: number, opacityPairs: number): EpubBilingualLayout => {
  if (langPairs > 0 && opacityPairs > 0) return 'mixed';
  if (langPairs > 0) return 'alternating-lang';
  if (opacityPairs > 0) return 'alternating-opacity';
  return 'none';
};

const contentModeFromEvidence = (
  pairCount: number,
  textBlockCount: number,
  packageLanguage: string | null,
  kanaCount: number,
): ProjectContentMode => {
  if (pairCount >= 3 || (textBlockCount <= 20 && pairCount >= 1)) return 'bilingual';
  if (packageLanguage === 'ja' || packageLanguage === 'jp' || kanaCount > 0) return 'japanese';
  return 'unknown';
};

export const extractCoverDataUrlFromZip = async (
  zip: JSZip,
  items: readonly ManifestItem[],
  metadataElement: Element,
  opfPath: string,
  availablePaths: ReadonlySet<string>,
): Promise<string | null> => {
  const itemById = new Map(items.map((item) => [item.id, item]));
  let coverItem = items.find((item) => item.properties.split(/\s+/u).includes('cover-image'));
  if (!coverItem) {
    const metaCover = elementsNamed(metadataElement, 'meta').find(
      (node) => node.getAttribute('name') === 'cover',
    );
    const coverId = metaCover?.getAttribute('content');
    if (coverId) coverItem = itemById.get(coverId);
  }
  if (!coverItem) {
    coverItem = items.find(
      (item) =>
        item.mediaType.startsWith('image/') &&
        (item.id.toLowerCase().includes('cover') || item.href.toLowerCase().includes('cover')),
    );
  }
  if (!coverItem) {
    coverItem = items.find((item) => item.mediaType.startsWith('image/'));
  }

  if (coverItem) {
    try {
      const coverPath = resolveArchiveHref(opfPath, coverItem.href, availablePaths);
      const coverEntry = zip.files[coverPath];
      if (coverEntry) {
        const coverBytes = await coverEntry.async('uint8array');
        const base64 = Buffer.from(coverBytes).toString('base64');
        return `data:${coverItem.mediaType};base64,${base64}`;
      }
    } catch {
      return null;
    }
  }
  return null;
};

export const extractCoverFromEpubBytes = async (bytes: Uint8Array): Promise<string | null> => {
  try {
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false });
    const availablePaths = new Set(Object.keys(zip.files));
    const containerEntry = zip.files['META-INF/container.xml'];
    if (!containerEntry) return null;
    const containerText = await containerEntry.async('text');
    const container = parseXmlDocument(containerText, 'META-INF/container.xml');
    const rootfiles = elementsNamed(container, 'rootfile');
    const rootfile = rootfiles.find((node) => node.getAttribute('media-type') === 'application/oebps-package+xml') ?? rootfiles[0];
    const opfPath = rootfile?.getAttribute('full-path');
    if (!opfPath || !availablePaths.has(opfPath)) return null;

    const opfEntry = zip.files[opfPath];
    if (!opfEntry) return null;
    const opfText = await opfEntry.async('text');
    const opf = parseXmlDocument(opfText, opfPath);
    const manifestElement = firstNamed(opf, 'manifest');
    const metadataElement = firstNamed(opf, 'metadata');
    if (!manifestElement || !metadataElement) return null;

    const items: ManifestItem[] = elementChildren(manifestElement)
      .filter((node) => (node.localName || node.nodeName).toLocaleLowerCase('en-US') === 'item')
      .map((node) => ({
        id: node.getAttribute('id') || '',
        href: node.getAttribute('href') || '',
        mediaType: node.getAttribute('media-type') || '',
        properties: node.getAttribute('properties') || '',
      }));

    return await extractCoverDataUrlFromZip(zip, items, metadataElement, opfPath, availablePaths);
  } catch {
    return null;
  }
};

export const parseEpubDocument = async (bytes: Uint8Array): Promise<EpubImportDocument> => {
  const archive = inspectEpubArchive(bytes);
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false });
  const availablePaths = new Set(archive.entries.map((entry) => entry.name));
  for (const entry of archive.entries) {
    const loaded = zip.files[entry.name] as (JSZipObject & { unsafeOriginalName?: string }) | undefined;
    if (!loaded) throw new Error(`EPUB 的 ZIP 索引与实际内容不一致：${entry.name}`);
    if (loaded.unsafeOriginalName && loaded.unsafeOriginalName !== entry.name) {
      throw new Error(`EPUB 包含被 ZIP 库改写的不安全路径：${loaded.unsafeOriginalName}`);
    }
  }

  const containerText = (await readXmlEntryBytes(zip, 'META-INF/container.xml')).text;
  const container = parseXmlDocument(containerText, 'META-INF/container.xml');
  const rootfiles = elementsNamed(container, 'rootfile');
  const rootfile = rootfiles.find((node) => node.getAttribute('media-type') === 'application/oebps-package+xml') ?? rootfiles[0];
  const opfPath = rootfile?.getAttribute('full-path');
  if (!opfPath || !availablePaths.has(opfPath)) throw new Error('container.xml 没有指向有效的 OPF 文件。');

  const opf = parseXmlDocument((await readXmlEntryBytes(zip, opfPath)).text, opfPath);
  const packageElement = firstNamed(opf, 'package');
  const manifestElement = firstNamed(opf, 'manifest');
  const spineElement = firstNamed(opf, 'spine');
  const metadataElement = firstNamed(opf, 'metadata');
  if (!packageElement || !manifestElement || !spineElement || !metadataElement) {
    throw new Error('OPF 缺少 package、metadata、manifest 或 spine。');
  }

  const items: ManifestItem[] = elementChildren(manifestElement)
    .filter((node) => (node.localName || node.nodeName).toLocaleLowerCase('en-US') === 'item')
    .map((node) => ({
      id: node.getAttribute('id') || '',
      href: node.getAttribute('href') || '',
      mediaType: node.getAttribute('media-type') || '',
      properties: node.getAttribute('properties') || '',
    }));
  if (items.some((item) => !item.id || !item.href || !item.mediaType)) {
    throw new Error('OPF manifest 含缺少 id、href 或 media-type 的项目。');
  }
  const itemById = new Map(items.map((item) => [item.id, item]));
  const labels = await buildNavigationLabels(zip, items, opfPath, availablePaths);
  const coverDataUrl = await extractCoverDataUrlFromZip(zip, items, metadataElement, opfPath, availablePaths);
  const spineRefs = elementChildren(spineElement)
    .filter((node) => (node.localName || node.nodeName).toLocaleLowerCase('en-US') === 'itemref');
  if (spineRefs.length === 0) throw new Error('OPF spine 为空。');

  const title = normalizedText(elementsNamed(metadataElement, 'title')[0]?.textContent ?? '') || null;
  const creators = elementsNamed(metadataElement, 'creator').map((node) => normalizedText(node.textContent ?? '')).filter(Boolean);
  const packageLanguage = normalizedText(elementsNamed(metadataElement, 'language')[0]?.textContent ?? '').toLocaleLowerCase('en-US') || null;

  const parsedDocuments: ParsedSpineDocument[] = [];
  for (const itemref of spineRefs) {
    const itemId = itemref.getAttribute('idref') || '';
    const item = itemById.get(itemId);
    if (!item) throw new Error(`OPF spine 引用了不存在的 manifest id：${itemId}`);
    if (!['application/xhtml+xml', 'text/html'].includes(item.mediaType)) continue;
    const href = resolveArchiveHref(opfPath, item.href, availablePaths);
    const { bytes: sourceBytes, text: source } = await readXmlEntryBytes(zip, href);
    const document = parseXmlDocument(source, href, 'application/xhtml+xml');
    const { blocks, langPairCount, opacityPairCount } = buildEpubTextBlocks(document, href);
    const kanaCount = blocks.reduce((sum, block) => sum + [...block.sourceText].filter((character) => /[\u3040-\u30ff]/u.test(character)).length, 0);
    const hanCount = blocks.reduce((sum, block) => sum + [...block.sourceText].filter((character) => /[\u3400-\u9fff]/u.test(character)).length, 0);
    parsedDocuments.push({
      langPairCount,
      opacityPairCount,
      document: {
        ordinal: parsedDocuments.length + 1,
        itemId,
        href,
        mediaType: item.mediaType,
        linear: itemref.getAttribute('linear') !== 'no',
        title: deriveDocumentTitle(document, labels.get(href), href, title),
        sourceHash: createHash('sha256').update(sourceBytes).digest('hex'),
        sourceSizeBytes: sourceBytes.byteLength,
        textBlockCount: blocks.length,
        characterCount: blocks.reduce((sum, block) => sum + [...block.sourceText].length, 0),
        kanaCount,
        hanCount,
        scriptCount: countElements(document, 'script'),
        rubyCount: countElements(document, 'ruby'),
        imageCount: countElements(document, 'img') + countElements(document, 'image'),
        externalReferenceCount: countExternalReferences(document),
        blocks,
      },
    });
  }
  if (parsedDocuments.length === 0) throw new Error('EPUB spine 中没有可解析的 XHTML 文档。');

  // Post-process chapter titles using Calibre-style spine-to-TOC range propagation
  let activeChapterTitle: string | null = null;
  let activeChapterExplicitDoc: (typeof parsedDocuments)[number]['document'] | null = null;
  let activeChapterSection = 1;

  for (let i = 0; i < parsedDocuments.length; i += 1) {
    const doc = parsedDocuments[i].document;
    const explicitTocLabel = labels.get(doc.href);

    if (explicitTocLabel) {
      activeChapterTitle = explicitTocLabel;
      activeChapterExplicitDoc = doc;
      activeChapterSection = 1;
      (doc as { title: string }).title = explicitTocLabel;
    } else if (activeChapterTitle && !['CONTENTS', '目次', '奥付'].includes(activeChapterTitle)) {
      if (doc.textBlockCount > 0) {
        if (activeChapterExplicitDoc && activeChapterExplicitDoc.textBlockCount === 0) {
          (activeChapterExplicitDoc as { title: string }).title = `${activeChapterTitle} (扉页)`;
          (doc as { title: string }).title = activeChapterTitle;
          activeChapterExplicitDoc = null;
        } else {
          activeChapterSection += 1;
          (doc as { title: string }).title = `${activeChapterTitle} (第 ${activeChapterSection} 节)`;
        }
      } else if (doc.imageCount > 0) {
        (doc as { title: string }).title = i >= parsedDocuments.length - 12 ? '插图 / 附录' : `${activeChapterTitle} (插图)`;
      }
    } else if (!activeChapterTitle) {
      const lower = doc.href.toLowerCase();
      if (lower.includes('cover') || lower.includes('titlepage') || doc.ordinal <= 2) {
        (doc as { title: string }).title = '封面';
      } else if (doc.textBlockCount > 0) {
        (doc as { title: string }).title = doc.title || 'ご利用上の注意';
      } else if (doc.imageCount > 0) {
        (doc as { title: string }).title = '彩页 / 插图';
      }
    }
  }
  const navItem = items.find((item) => item.properties.split(/\s+/u).includes('nav'));
  const ncxItem = items.find((item) => item.mediaType === 'application/x-dtbncx+xml');
  const navigationKind = navItem && ncxItem ? 'both' : navItem ? 'nav' : ncxItem ? 'ncx' : 'none';
  const navigationItem = navItem ?? ncxItem;
  const langPairCount = parsedDocuments.reduce((sum, item) => sum + item.langPairCount, 0);
  const opacityPairCount = parsedDocuments.reduce((sum, item) => sum + item.opacityPairCount, 0);
  const bilingualPairCount = langPairCount + opacityPairCount;
  const spineDocuments = parsedDocuments.map((item) => item.document);
  const textBlockCount = spineDocuments.reduce((sum, document) => sum + document.textBlockCount, 0);
  const characterCount = spineDocuments.reduce((sum, document) => sum + document.characterCount, 0);
  const totalKana = spineDocuments.reduce((sum, document) => sum + document.kanaCount, 0);
  const scriptCount = spineDocuments.reduce((sum, document) => sum + document.scriptCount, 0);
  const externalReferenceCount = spineDocuments.reduce((sum, document) => sum + document.externalReferenceCount, 0);
  const warnings: string[] = [];
  if (scriptCount > 0) warnings.push(`检测到 ${scriptCount} 个 script 引用；仅保存结构，不在界面执行。`);
  if (externalReferenceCount > 0) warnings.push(`检测到 ${externalReferenceCount} 个外部资源引用；导入时不联网加载。`);
  if (packageLanguage === 'jp') warnings.push('OPF 使用了非标准语言代码 jp；按日文识别，原元数据保持不变。');
  if (navigationKind === 'none') warnings.push('未找到 EPUB nav 或 NCX；阅读顺序仍按 spine 保存。');

  return {
    title,
    coverDataUrl,
    details: {
      packageVersion: packageElement.getAttribute('version') || 'unknown',
      opfPath,
      packageLanguage,
      creators,
      navigationKind,
      navigationPath: navigationItem ? resolveArchiveHref(opfPath, navigationItem.href, availablePaths) : null,
      pageProgression: spineElement.getAttribute('page-progression-direction') || null,
      manifestCount: items.length,
      spineCount: spineDocuments.length,
      imageCount: items.filter((item) => item.mediaType.startsWith('image/')).length,
      rubyCount: spineDocuments.reduce((sum, document) => sum + document.rubyCount, 0),
      scriptCount,
      externalReferenceCount,
      bilingualLayout: layoutFromPairs(langPairCount, opacityPairCount),
      bilingualPairCount,
      totalUncompressedBytes: archive.totalUncompressedBytes,
      warnings,
    },
    spineDocuments,
    textBlockCount,
    characterCount,
    contentMode: contentModeFromEvidence(bilingualPairCount, textBlockCount, packageLanguage, totalKana),
  };
};
