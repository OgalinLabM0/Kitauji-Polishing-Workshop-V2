import { createHash, randomUUID } from 'node:crypto';
import { XMLSerializer, type Document, type Element, type Node } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { inspectEpubArchive } from '../projects/epubArchivePolicy.cjs';
import { parseEpubDocument } from '../projects/epubImport.cjs';
import { hasInvalidXmlCodePoint } from '../projects/epubLexicalWriteback.cjs';
import { decodeXmlBytes, elementsNamed, encodeXmlText, findElementByDomPath, parseXmlDocument, resolveArchiveHref } from '../projects/epubXml.cjs';

export type FormalExportMode = 'jp-cn' | 'cn-jp' | 'cn-only';
interface FormalAnnotation { readonly annotationId: string; readonly sourceTerm: string; readonly note: string; }

interface FormalExportData {
  readonly project: { readonly title: string; readonly sourceFormat: 'txt' | 'epub'; readonly contentMode: string; readonly sourceHash: string; readonly opfPath: string | null; readonly navigationPath: string | null };
  readonly originalBytes: Uint8Array;
  readonly txtSegments: readonly { readonly chapter_id: string; readonly chapter_ordinal: number; readonly segment_ordinal: number; readonly source_text: string; readonly translation: string; readonly annotations: readonly FormalAnnotation[] }[];
  readonly epubSegments: readonly {
    readonly chapter_id: string; readonly chapter_ordinal: number; readonly segment_ordinal: number;
    readonly source_text: string; readonly translation: string; readonly document_path: string;
    readonly document_source_hash: string; readonly source_dom_path: string; readonly source_xml: string;
    readonly source_tag: string; readonly target_dom_path: string | null; readonly target_xml: string | null; readonly target_tag: string | null;
    readonly annotations: readonly FormalAnnotation[];
  }[];
}

export interface FormalExportBuildResult { readonly bytes: Uint8Array; readonly documentCount: number; readonly segmentCount: number; readonly annotationCount: number; readonly mode: FormalExportMode; }

const serializer = new XMLSerializer();
const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const escapeXml = (text: string) => text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');

const protectedInlineNames = new Set(['rt', 'rp', 'script', 'style', 'svg', 'math']);

const replaceElementText = (document: Document, element: Element, text: string) => {
  if (!text.trim() || hasInvalidXmlCodePoint(text)) throw new Error('成稿为空或包含 XML 禁止字符。');
  const slots: { node: Node; leading: string; trailing: string; weight: number }[] = [];
  const visit = (parent: Node) => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1 && protectedInlineNames.has((child as Element).tagName.toLowerCase())) continue;
      if (child.nodeType === 3 || child.nodeType === 4) {
        const value = child.nodeValue ?? '';
        if (!value.trim()) continue;
        const leading = value.match(/^\s*/u)?.[0] ?? '';
        const trailing = value.match(/\s*$/u)?.[0] ?? '';
        const weight = Math.max(1, Array.from(value.slice(leading.length, value.length - trailing.length)).length);
        slots.push({ node: child, leading, trailing, weight });
      } else visit(child);
    }
  };
  visit(element);
  if (!slots.length) {
    if (text.includes('\n')) {
      const namespace = element.namespaceURI || 'http://www.w3.org/1999/xhtml';
      const lines = text.split('\n');
      lines.forEach((line, index) => {
        if (index > 0) element.appendChild(document.createElementNS(namespace, 'br'));
        if (line) element.appendChild(document.createTextNode(line));
      });
    } else {
      element.appendChild(document.createTextNode(text));
    }
  } else if (slots.length === 1 && text.includes('\n')) {
    const namespace = element.namespaceURI || 'http://www.w3.org/1999/xhtml';
    const lines = text.split('\n');
    const parent = slots[0].node.parentNode || element;
    const refNode = slots[0].node;
    lines.forEach((line, index) => {
      if (index > 0) parent.insertBefore(document.createElementNS(namespace, 'br'), refNode);
      if (line) parent.insertBefore(document.createTextNode(line), refNode);
    });
    parent.removeChild(refNode);
  } else {
    const characters = Array.from(text);
    const totalWeight = slots.reduce((total, slot) => total + slot.weight, 0);
    let characterOffset = 0;
    let consumedWeight = 0;
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      consumedWeight += slot.weight;
      const nextOffset = index === slots.length - 1 ? characters.length : Math.round(characters.length * consumedWeight / totalWeight);
      slot.node.nodeValue = `${slot.leading}${characters.slice(characterOffset, nextOffset).join('')}${slot.trailing}`;
      characterOffset = nextOffset;
    }
  }
  element.setAttribute('lang', 'zh-CN');
  element.setAttribute('xml:lang', 'zh-CN');
};

const translatedSibling = (document: Document, source: Element, translation: string) => {
  const target = document.createElementNS(source.namespaceURI || 'http://www.w3.org/1999/xhtml', source.tagName);
  for (const name of ['class', 'style', 'dir']) {
    const value = source.getAttribute(name);
    if (value) target.setAttribute(name, value);
  }
  const className = `${target.getAttribute('class') || ''} kitauji-translation`.trim();
  target.setAttribute('class', className);
  replaceElementText(document, target, translation);
  return target;
};

const positionTarget = (source: Element, target: Element, mode: Exclude<FormalExportMode, 'cn-only'>) => {
  const parent = source.parentNode;
  if (!parent) throw new Error('正文节点缺少父元素。');
  if (target.parentNode) target.parentNode.removeChild(target);
  if (mode === 'cn-jp') parent.insertBefore(target, source);
  else parent.insertBefore(target, source.nextSibling);
};

const appendAnnotation = (document: Document, textElement: Element, annotation: FormalAnnotation, notes: Map<string, Element>) => {
  const namespace = textElement.namespaceURI || 'http://www.w3.org/1999/xhtml';
  const referenceId = `${annotation.annotationId}-ref`;
  const noteId = `${annotation.annotationId}-note`;
  const sup = document.createElementNS(namespace, 'sup');
  sup.setAttribute('class', 'kitauji-noteref');
  const link = document.createElementNS(namespace, 'a');
  link.setAttribute('id', referenceId);
  link.setAttribute('href', `#${noteId}`);
  link.setAttributeNS('http://www.idpf.org/2007/ops', 'epub:type', 'noteref');
  link.appendChild(document.createTextNode('〔注〕'));
  sup.appendChild(link);
  textElement.appendChild(sup);
  if (notes.has(noteId)) return;
  const aside = document.createElementNS(namespace, 'aside');
  aside.setAttribute('id', noteId);
  aside.setAttribute('class', 'kitauji-footnote');
  aside.setAttributeNS('http://www.idpf.org/2007/ops', 'epub:type', 'footnote');
  const paragraph = document.createElementNS(namespace, 'p');
  paragraph.appendChild(document.createTextNode(`${annotation.sourceTerm}：${annotation.note} `));
  const back = document.createElementNS(namespace, 'a');
  back.setAttribute('href', `#${referenceId}`);
  back.appendChild(document.createTextNode('返回正文'));
  paragraph.appendChild(back);
  aside.appendChild(paragraph);
  notes.set(noteId, aside);
};

const updatePureChineseMetadata = async (zip: JSZip, data: FormalExportData, availablePaths: ReadonlySet<string>) => {
  if (!data.project.opfPath) return;
  const entry = zip.file(data.project.opfPath);
  if (!entry) return;
  const bytes = await entry.async('uint8array');
  const decoded = decodeXmlBytes(bytes, data.project.opfPath);
  const document = parseXmlDocument(decoded.text, data.project.opfPath);
  const language = elementsNamed(document, 'language')[0];
  if (language) language.textContent = 'zh-CN';
  zip.file(data.project.opfPath, encodeXmlText(serializer.serializeToString(document), decoded.encoding, decoded.hadBom), { binary: true, compression: 'DEFLATE', date: entry.date, createFolders: false });

  if (!data.project.navigationPath) return;
  const navEntry = zip.file(data.project.navigationPath);
  if (!navEntry) return;
  const navBytes = await navEntry.async('uint8array');
  const navDecoded = decodeXmlBytes(navBytes, data.project.navigationPath);
  const nav = parseXmlDocument(navDecoded.text, data.project.navigationPath, data.project.navigationPath.endsWith('.xhtml') ? 'application/xhtml+xml' : 'application/xml');
  const headingByPath = new Map(data.epubSegments.filter((segment) => /^h[1-6]$/u.test(segment.source_tag)).map((segment) => [segment.document_path, segment.translation]));
  for (const anchor of elementsNamed(nav, 'a')) {
    const href = anchor.getAttribute('href');
    if (!href) continue;
    try { const target = resolveArchiveHref(data.project.navigationPath, href, availablePaths); const title = headingByPath.get(target); if (title) anchor.textContent = title; } catch { /* auxiliary link */ }
  }
  for (const navPoint of elementsNamed(nav, 'navpoint')) {
    const href = elementsNamed(navPoint, 'content')[0]?.getAttribute('src');
    if (!href) continue;
    try { const target = resolveArchiveHref(data.project.navigationPath, href, availablePaths); const title = headingByPath.get(target); const label = elementsNamed(navPoint, 'text')[0]; if (title && label) label.textContent = title; } catch { /* auxiliary link */ }
  }
  zip.file(data.project.navigationPath, encodeXmlText(serializer.serializeToString(nav), navDecoded.encoding, navDecoded.hadBom), { binary: true, compression: 'DEFLATE', date: navEntry.date, createFolders: false });
};

const buildFromEpub = async (data: FormalExportData, mode: FormalExportMode): Promise<FormalExportBuildResult> => {
  if (sha256(data.originalBytes) !== data.project.sourceHash) throw new Error('原 EPUB 快照摘要不一致，已阻止导出。');
  const archive = inspectEpubArchive(data.originalBytes);
  const availablePaths = new Set(archive.entries.map((entry) => entry.name));
  const zip = await JSZip.loadAsync(data.originalBytes, { checkCRC32: true, createFolders: false });
  const groups = new Map<string, FormalExportData['epubSegments'][number][]>();
  let annotationCount = 0;
  for (const segment of data.epubSegments) { const group = groups.get(segment.document_path) ?? []; group.push(segment); groups.set(segment.document_path, group); }
  for (const [documentPath, segments] of groups) {
    const entry = zip.file(documentPath);
    if (!entry) throw new Error(`原 EPUB 缺少正文文档：${documentPath}`);
    const bytes = await entry.async('uint8array');
    if (segments.some((segment) => segment.document_source_hash !== sha256(bytes))) throw new Error(`正文摘要与导入时不同：${documentPath}`);
    const decoded = decodeXmlBytes(bytes, documentPath);
    const document = parseXmlDocument(decoded.text, documentPath, 'application/xhtml+xml');
    const notes = new Map<string, Element>();
    const resolved = segments.map((segment) => {
      const source = findElementByDomPath(document, segment.source_dom_path);
      if (!source) throw new Error(`无法定位日文段落：${segment.source_dom_path}`);
      const target = segment.target_dom_path ? findElementByDomPath(document, segment.target_dom_path) : null;
      if (segment.target_dom_path && !target) throw new Error(`无法定位既有中文段落：${segment.target_dom_path}`);
      return { segment, source, target };
    });
    for (const resolvedSegment of resolved) {
      const { segment, source } = resolvedSegment;
      let { target } = resolvedSegment;
      if (mode === 'cn-only') {
        replaceElementText(document, source, segment.translation);
        if (target?.parentNode) target.parentNode.removeChild(target);
        segment.annotations.forEach((annotation) => appendAnnotation(document, source, annotation, notes));
      } else {
        if (!target) target = translatedSibling(document, source, segment.translation);
        else replaceElementText(document, target, segment.translation);
        const translationTarget = target;
        positionTarget(source, translationTarget, mode);
        segment.annotations.forEach((annotation) => appendAnnotation(document, translationTarget, annotation, notes));
      }
      annotationCount += segment.annotations.length;
    }
    if (notes.size) {
      const root = document.documentElement;
      if (root && !root.getAttribute('xmlns:epub')) root.setAttribute('xmlns:epub', 'http://www.idpf.org/2007/ops');
      const body = elementsNamed(document, 'body')[0] ?? root;
      notes.forEach((note) => body?.appendChild(note));
    }
    const output = serializer.serializeToString(document);
    zip.file(documentPath, encodeXmlText(output, decoded.encoding, decoded.hadBom), { binary: true, compression: 'DEFLATE', date: entry.date, unixPermissions: entry.unixPermissions, dosPermissions: entry.dosPermissions, createFolders: false });
  }
  if (mode === 'cn-only') await updatePureChineseMetadata(zip, data, availablePaths);
  const mime = zip.file('mimetype');
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE', date: mime?.date, unixPermissions: mime?.unixPermissions, dosPermissions: mime?.dosPermissions, createFolders: false });
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'DOS' });
  const outputArchive = inspectEpubArchive(bytes);
  const outputNames = new Set(outputArchive.entries.map((entry) => entry.name));
  if (archive.entries.some((entry) => !outputNames.has(entry.name)) || archive.entries.length !== outputArchive.entries.length) throw new Error('导出后 EPUB 资源清单发生变化。');
  await parseEpubDocument(bytes);
  return { bytes, documentCount: groups.size, segmentCount: data.epubSegments.length, annotationCount, mode };
};

const buildFromTxt = async (data: FormalExportData, mode: FormalExportMode): Promise<FormalExportBuildResult> => {
  if (sha256(data.originalBytes) !== data.project.sourceHash) throw new Error('原 TXT 快照摘要不一致，已阻止导出。');
  const chapters = new Map<number, FormalExportData['txtSegments'][number][]>();
  for (const segment of data.txtSegments) { const group = chapters.get(segment.chapter_ordinal) ?? []; group.push(segment); chapters.set(segment.chapter_ordinal, group); }
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE', createFolders: false });
  zip.file('META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const nav: string[] = [];
  const manifest: string[] = [];
  const spine: string[] = [];
  let annotationCount = 0;
  for (const [ordinal, segments] of chapters) {
    const title = segments[0];
    const chapterTitle = mode === 'cn-only' ? title.translation : `${title.translation}`;
    const filename = `chapter-${ordinal.toString().padStart(4, '0')}.xhtml`;
    nav.push(`<li><a href="${filename}">${escapeXml(chapterTitle)}</a></li>`);
    manifest.push(`<item id="c${ordinal}" href="${filename}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="c${ordinal}"/>`);
    const notes: string[] = [];
    const blocks = segments.slice(1).map((segment) => {
      const jp = `<p class="jp" lang="ja" xml:lang="ja">${escapeXml(segment.source_text)}</p>`;
      const references = segment.annotations.map((annotation) => {
        annotationCount += 1;
        const noteId = `${annotation.annotationId}-note`; const referenceId = `${annotation.annotationId}-ref`;
        notes.push(`<aside id="${escapeXml(noteId)}" class="kitauji-footnote" epub:type="footnote"><p>${escapeXml(annotation.sourceTerm)}：${escapeXml(annotation.note)} <a href="#${escapeXml(referenceId)}">返回正文</a></p></aside>`);
        return `<sup class="kitauji-noteref"><a id="${escapeXml(referenceId)}" href="#${escapeXml(noteId)}" epub:type="noteref">〔注〕</a></sup>`;
      }).join('');
      const cn = `<p class="cn" lang="zh-CN" xml:lang="zh-CN">${escapeXml(segment.translation)}${references}</p>`;
      return mode === 'cn-only' ? cn : mode === 'cn-jp' ? `${cn}${jp}` : `${jp}${cn}`;
    }).join('');
    zip.file(`OEBPS/${filename}`, `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${mode === 'cn-only' ? 'zh-CN' : 'ja'}"><head><title>${escapeXml(chapterTitle)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><h1>${escapeXml(chapterTitle)}</h1>${blocks}${notes.join('')}</body></html>`);
  }
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN"><head><title>目录</title></head><body><nav epub:type="toc" id="toc"><h1>目录</h1><ol>${nav.join('')}</ol></nav></body></html>`);
  zip.file('OEBPS/style.css', 'body{max-width:42em;margin:0 auto;padding:1.5em;line-height:1.85;}h1{margin:1.4em 0;}.jp{color:#555;}.cn{color:#111;}p{margin:.65em 0;text-indent:2em;}.kitauji-noteref{font-size:.72em}.kitauji-footnote{border-top:1px solid #aaa;margin-top:1em;font-size:.9em}');
  const identifier = `urn:uuid:${randomUUID()}`;
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${identifier}</dc:identifier><dc:title>${escapeXml(data.project.title)}</dc:title><dc:language>${mode === 'cn-only' ? 'zh-CN' : 'ja'}</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="style" href="style.css" media-type="text/css"/>${manifest.join('')}</manifest><spine>${spine.join('')}</spine></package>`);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'DOS' });
  inspectEpubArchive(bytes); await parseEpubDocument(bytes);
  return { bytes, documentCount: chapters.size, segmentCount: data.txtSegments.length, annotationCount, mode };
};

export const buildFormalEpub = (data: FormalExportData, mode: FormalExportMode) => data.project.sourceFormat === 'epub'
  ? buildFromEpub(data, mode)
  : buildFromTxt(data, mode);
