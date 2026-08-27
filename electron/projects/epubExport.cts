import { createHash } from 'node:crypto';
import { XMLSerializer } from '@xmldom/xmldom';
import JSZip from 'jszip';
import type { EpubExportInput } from './models.cjs';
import { inspectEpubArchive } from './epubArchivePolicy.cjs';
import { parseEpubDocument } from './epubImport.cjs';
import { escapeXmlText, hasInvalidXmlCodePoint, locateElementContentRange } from './epubLexicalWriteback.cjs';
import {
  decodeXmlBytes,
  elementChildren,
  encodeXmlText,
  findElementByDomPath,
  parseXmlDocument,
} from './epubXml.cjs';

const serializer = new XMLSerializer();

export interface EpubExportBuildResult {
  readonly bytes: Uint8Array;
  readonly changedDocumentCount: number;
  readonly changedBlockCount: number;
}

interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const sameBytes = (left: Uint8Array, right: Uint8Array) => {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
};

const assertProjectSnapshot = (input: EpubExportInput) => {
  if (input.project.sourceFormat !== 'epub') throw new Error('只有 EPUB 项目可以导出 EPUB 校样。');
  if (sha256(input.originalBytes) !== input.project.sourceHash) {
    throw new Error('项目中的原始 EPUB 快照摘要不一致，已阻止导出。');
  }
  if (input.drafts.length === 0) throw new Error('当前作品还没有已保存的中文校改。');
};

const applyDocumentDrafts = async (
  zip: JSZip,
  documentPath: string,
  drafts: EpubExportInput['drafts'],
  compression: 'STORE' | 'DEFLATE',
) => {
  const entry = zip.file(documentPath);
  if (!entry) throw new Error(`原 EPUB 缺少待写回文档：${documentPath}`);
  const sourceBytes = await entry.async('uint8array');
  if (drafts.some((draft) => draft.documentSourceHash !== sha256(sourceBytes))) {
    throw new Error(`原 XHTML 摘要已变化，已阻止写回：${documentPath}`);
  }
  const decoded = decodeXmlBytes(sourceBytes, documentPath);
  const document = parseXmlDocument(decoded.text, documentPath, 'application/xhtml+xml');
  const replacements: Replacement[] = [];
  for (const draft of drafts) {
    if (draft.savedSourceHash !== draft.sourceHash) {
      throw new Error(`校改草稿所依据的原文已经变化：${draft.blockId}`);
    }
    if (!draft.draftText.trim()) throw new Error(`校改内容不能为空：${draft.blockId}`);
    if (hasInvalidXmlCodePoint(draft.draftText)) throw new Error(`校改内容包含 XML 禁止字符：${draft.blockId}`);
    const element = findElementByDomPath(document, draft.domPath);
    if (!element) throw new Error(`无法重新定位待写回节点：${draft.domPath}`);
    const currentXml = serializer.serializeToString(element);
    const currentHash = createHash('sha256').update(`${documentPath}\0${currentXml}`).digest('hex');
    if (currentHash !== draft.sourceHash || currentXml !== draft.sourceXml) {
      throw new Error(`节点结构或原文摘要不一致，已阻止写回：${draft.domPath}`);
    }
    if (elementChildren(element).length > 0) {
      throw new Error(`节点包含 ruby、链接、强调或其他行内结构，不能按纯文本写回：${draft.domPath}`);
    }
    const range = locateElementContentRange(decoded.text, draft.domPath);
    replacements.push({ start: range.contentStart, end: range.contentEnd, text: escapeXmlText(draft.draftText) });
  }
  replacements.sort((left, right) => right.start - left.start);
  for (let index = 1; index < replacements.length; index += 1) {
    if (replacements[index - 1].start < replacements[index].end) {
      throw new Error(`同一 XHTML 中的写回范围发生重叠：${documentPath}`);
    }
  }
  let output = decoded.text;
  for (const replacement of replacements) {
    output = `${output.slice(0, replacement.start)}${replacement.text}${output.slice(replacement.end)}`;
  }
  zip.file(documentPath, encodeXmlText(output, decoded.encoding, decoded.hadBom), {
    binary: true,
    compression,
    createFolders: false,
    date: entry.date,
    unixPermissions: entry.unixPermissions,
    dosPermissions: entry.dosPermissions,
  });
};

export const buildEpubProofExport = async (input: EpubExportInput): Promise<EpubExportBuildResult> => {
  assertProjectSnapshot(input);
  const archive = inspectEpubArchive(input.originalBytes);
  const compressionByPath = new Map(archive.entries.map((entry) => [entry.name, entry.compressionMethod === 0 ? 'STORE' as const : 'DEFLATE' as const]));
  const zip = await JSZip.loadAsync(input.originalBytes, { checkCRC32: true, createFolders: false });
  const draftsByDocument = new Map<string, EpubExportInput['drafts'][number][]>();
  for (const draft of input.drafts) {
    const group = draftsByDocument.get(draft.documentPath) ?? [];
    group.push(draft);
    draftsByDocument.set(draft.documentPath, group);
  }
  for (const [documentPath, drafts] of draftsByDocument) {
    await applyDocumentDrafts(zip, documentPath, drafts, compressionByPath.get(documentPath) ?? 'DEFLATE');
  }
  const mimeEntry = zip.file('mimetype');
  zip.file('mimetype', 'application/epub+zip', {
    compression: 'STORE',
    date: mimeEntry?.date,
    unixPermissions: mimeEntry?.unixPermissions,
    dosPermissions: mimeEntry?.dosPermissions,
  });
  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'DOS',
  });

  const outputArchive = inspectEpubArchive(bytes);
  const originalNames = archive.entries.map((entry) => entry.name);
  const outputNames = outputArchive.entries.map((entry) => entry.name);
  const outputNameSet = new Set(outputNames);
  if (originalNames.length !== outputNames.length || originalNames.some((name) => !outputNameSet.has(name))) {
    const originalNameSet = new Set(originalNames);
    const missing = originalNames.filter((name) => !outputNameSet.has(name)).slice(0, 5);
    const added = outputNames.filter((name) => !originalNameSet.has(name)).slice(0, 5);
    throw new Error(`导出后 EPUB 的资源清单发生变化。缺少：${missing.join('、') || '无'}；新增：${added.join('、') || '无'}。`);
  }
  const outputZip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false });
  for (const entry of archive.entries) {
    if (entry.name.endsWith('/') || draftsByDocument.has(entry.name)) continue;
    const originalEntry = zip.file(entry.name);
    const outputEntry = outputZip.file(entry.name);
    if (!originalEntry || !outputEntry) throw new Error(`导出后缺少未修改资源：${entry.name}`);
    const [originalData, outputData] = await Promise.all([originalEntry.async('uint8array'), outputEntry.async('uint8array')]);
    if (!sameBytes(originalData, outputData)) throw new Error(`未修改资源的内容发生变化：${entry.name}`);
  }
  await parseEpubDocument(bytes);
  return {
    bytes,
    changedDocumentCount: draftsByDocument.size,
    changedBlockCount: input.drafts.length,
  };
};
