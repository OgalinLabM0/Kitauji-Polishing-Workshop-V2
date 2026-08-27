import path from 'node:path';
import { DOMParser, type Document, type Element, type Node as XmlNode } from '@xmldom/xmldom';
import type JSZip from 'jszip';

const MAX_XML_ENTRY_BYTES = 16 * 1024 * 1024;
const protectedTextTags = new Set(['script', 'style', 'noscript', 'svg', 'math']);

export const localName = (node: XmlNode) => (node.localName || node.nodeName || '').toLocaleLowerCase('en-US');

export const elementChildren = (node: XmlNode) => {
  const result: Element[] = [];
  for (let index = 0; index < node.childNodes.length; index += 1) {
    const child = node.childNodes.item(index);
    if (child?.nodeType === 1) result.push(child as Element);
  }
  return result;
};

export const allElements = (root: Document | Element) => {
  const nodes = root.getElementsByTagName('*');
  return Array.from({ length: nodes.length }, (_, index) => nodes.item(index)).filter((node): node is Element => Boolean(node));
};

export const elementsNamed = (root: Document | Element, name: string) => allElements(root).filter((node) => localName(node) === name);
export const firstNamed = (root: Document | Element, name: string) => elementsNamed(root, name)[0] ?? null;
export const normalizedText = (text: string) => text.replace(/[\t\r ]+/gu, ' ').replace(/\n +/gu, '\n').replace(/ +\n/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim();

export const parseXmlDocument = (source: string, label: string, mimeType = 'application/xml') => {
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/iu.test(source)) throw new Error(`${label} 包含自定义实体或内部 DTD，当前拒绝解析。`);
  const parseSource = source.replace(/<!DOCTYPE[\s\S]*?>/iu, '');
  try {
    const document = new DOMParser({
      locator: true,
      onError: (level, message) => {
        if (level !== 'warning') throw new Error(message);
      },
    }).parseFromString(parseSource, mimeType);
    if (!document.documentElement) throw new Error('缺少根元素');
    return document;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'XML 语法错误';
    throw new Error(`${label} 无法作为 XML 解析：${reason}`);
  }
};

export type EpubXmlEncoding = 'utf-8' | 'utf-16le' | 'utf-16be';

export interface DecodedXmlEntry {
  readonly text: string;
  readonly encoding: EpubXmlEncoding;
  readonly hadBom: boolean;
}

export const decodeXmlBytes = (bytes: Uint8Array, label: string): DecodedXmlEntry => {
  if (bytes.byteLength > MAX_XML_ENTRY_BYTES) throw new Error(`${label} 超过 16 MiB 的 XML 安全上限。`);
  let encoding: EpubXmlEncoding = 'utf-8';
  let offset = 0;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'utf-16le';
    offset = 2;
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = 'utf-16be';
    offset = 2;
  } else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    offset = 3;
  }
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset));
    const declaration = text.slice(0, 240).match(/<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/iu)?.[1]?.toLocaleLowerCase('en-US');
    if (declaration && !['utf-8', 'utf8', 'utf-16', 'utf-16le', 'utf-16be', 'us-ascii'].includes(declaration)) {
      throw new Error(`声明了当前不支持的 XML 编码 ${declaration}`);
    }
    return { text: text.replace(/^\uFEFF/u, ''), encoding, hadBom: offset > 0 };
  } catch (error) {
    const reason = error instanceof Error ? error.message : '字符编码错误';
    throw new Error(`${label} 无法可靠解码：${reason}`);
  }
};

export const readXmlEntryBytes = async (zip: JSZip, entryPath: string, label = entryPath) => {
  const entry = zip.file(entryPath);
  if (!entry) throw new Error(`EPUB 缺少 ${label}：${entryPath}`);
  const bytes = await entry.async('uint8array');
  return { bytes, ...decodeXmlBytes(bytes, label) };
};

export const encodeXmlText = (text: string, encoding: EpubXmlEncoding, withBom: boolean) => {
  if (encoding === 'utf-8') {
    const body = Buffer.from(text, 'utf8');
    return withBom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
  }
  const littleEndian = Buffer.from(text, 'utf16le');
  const body = encoding === 'utf-16le'
    ? littleEndian
    : Buffer.from(littleEndian).map((_value, index, buffer) => buffer[index ^ 1]);
  const bom = encoding === 'utf-16le' ? Buffer.from([0xff, 0xfe]) : Buffer.from([0xfe, 0xff]);
  return withBom ? Buffer.concat([bom, body]) : body;
};

const safeDecodeHref = (href: string) => {
  try {
    return decodeURIComponent(href);
  } catch {
    throw new Error(`EPUB 包含无法解码的资源地址：${href}`);
  }
};

export const resolveArchiveHref = (baseDocument: string, href: string, availablePaths: ReadonlySet<string>) => {
  const withoutFragment = href.split('#', 1)[0].split('?', 1)[0];
  for (const candidate of [safeDecodeHref(withoutFragment), withoutFragment]) {
    if (!candidate || candidate.includes('\\') || candidate.startsWith('/')) continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(baseDocument), candidate));
    if (resolved === '..' || resolved.startsWith('../') || path.posix.isAbsolute(resolved)) continue;
    if (availablePaths.has(resolved)) return resolved;
  }
  throw new Error(`EPUB 资源不存在或路径越界：${href}`);
};

export const visibleText = (node: XmlNode): string => {
  if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue ?? '';
  if (node.nodeType !== 1) return '';
  const name = localName(node);
  if (protectedTextTags.has(name) || name === 'rt' || name === 'rp') return '';
  if (name === 'br') return '\n';
  if (name === 'ruby') {
    const base = elementChildren(node).length === 0
      ? node.textContent ?? ''
      : Array.from({ length: node.childNodes.length }, (_, index) => node.childNodes.item(index))
        .filter((child): child is XmlNode => child !== null)
        .filter((child) => !['rt', 'rp'].includes(localName(child)))
        .map(visibleText)
        .join('');
    const reading = elementChildren(node).filter((child) => localName(child) === 'rt').map((child) => normalizedText(child.textContent ?? '')).join('／');
    return reading ? `${base}《${reading}》` : base;
  }
  return Array.from({ length: node.childNodes.length }, (_, index) => node.childNodes.item(index))
    .filter((child): child is XmlNode => Boolean(child))
    .map(visibleText)
    .join('');
};

export const elementDomPath = (element: Element) => {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current) {
    const name = localName(current);
    let siblingIndex = 1;
    let sibling = current.previousSibling;
    while (sibling) {
      if (sibling.nodeType === 1 && localName(sibling) === name) siblingIndex += 1;
      sibling = sibling.previousSibling;
    }
    parts.unshift(`${name}[${siblingIndex}]`);
    current = current.parentNode?.nodeType === 1 ? current.parentNode as Element : null;
  }
  return `/${parts.join('/')}`;
};

export const findElementByDomPath = (document: Document, domPath: string) => {
  const parts = domPath.split('/').filter(Boolean).map((part) => {
    const match = part.match(/^([^\[]+)\[(\d+)\]$/u);
    return match ? { name: match[1].toLocaleLowerCase('en-US'), index: Number(match[2]) } : null;
  });
  if (parts.length === 0 || parts.some((part) => !part || part.index < 1)) return null;
  let current: Element | null = document.documentElement;
  const root = parts[0];
  if (!current || !root || localName(current) !== root.name || root.index !== 1) return null;
  for (const part of parts.slice(1)) {
    if (!part) return null;
    const parent = current;
    const matches: Element[] = elementChildren(parent).filter((child) => localName(child) === part.name);
    current = matches[part.index - 1] ?? null;
    if (!current) return null;
  }
  return current;
};

export const countElements = (document: Document, name: string) => elementsNamed(document, name).length;

export const countExternalReferences = (document: Document) => allElements(document).reduce((count, element) => {
  const href = element.getAttribute('href') || element.getAttribute('src');
  return count + (href && /^(?:https?:)?\/\//iu.test(href) ? 1 : 0);
}, 0);
