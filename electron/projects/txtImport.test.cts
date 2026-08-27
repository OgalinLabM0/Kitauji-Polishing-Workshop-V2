import { describe, expect, it } from 'vitest';
import { decodeTxtBytes, isTxtChapterHeading, parseTxtChapters, parseTxtDocument } from './txtImport.cjs';

const encodeUtf16Le = (text: string) => {
  const buffer = Buffer.from(text, 'utf16le');
  return new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), buffer]));
};

describe('TXT import', () => {
  it('decodes UTF-8 with BOM and records CRLF line endings', () => {
    const bytes = new Uint8Array(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('序章\r\n本文', 'utf8')]));
    expect(decodeTxtBytes(bytes)).toEqual({ encoding: 'utf-8', text: '序章\r\n本文', newline: 'crlf' });
  });

  it('decodes UTF-16LE with BOM', () => {
    expect(decodeTxtBytes(encodeUtf16Le('第一章\n本文'))).toMatchObject({ encoding: 'utf-16le', text: '第一章\n本文' });
  });

  it('falls back to Shift_JIS only when UTF-8 is invalid', () => {
    expect(decodeTxtBytes(new Uint8Array([0x82, 0xa0]))).toEqual({ encoding: 'shift_jis', text: 'あ', newline: 'none' });
  });

  it('rejects empty and binary-looking input', () => {
    expect(() => decodeTxtBytes(new Uint8Array())).toThrow('为空');
    expect(() => decodeTxtBytes(new Uint8Array(Buffer.from('abc\u0000def', 'utf8')))).toThrow('二进制空字符');
  });

  it('recognizes conservative Japanese and Markdown chapter headings', () => {
    expect(isTxtChapterHeading('第一章　合奏')).toBe(true);
    expect(isTxtChapterHeading('プロローグ')).toBe(true);
    expect(isTxtChapterHeading('## 第二楽章')).toBe(true);
    expect(isTxtChapterHeading('第一章で彼女は迷った。')).toBe(false);
  });

  it('creates a preface and stable source lines around headings', () => {
    const chapters = parseTxtChapters('作品名\n作者名\n\n序章\n一行目。\n\n第一章　出会い\n二行目。');
    expect(chapters.map((chapter) => chapter.title)).toEqual(['开篇', '序章', '第一章　出会い']);
    expect(chapters[1]).toMatchObject({ ordinal: 2, startLine: 4, endLine: 6 });
    expect(chapters[2].paragraphs[0]).toMatchObject({ ordinal: 1, sourceLine: 8, text: '二行目。' });
  });

  it('falls back to one body chapter when headings are absent', () => {
    const chapters = parseTxtChapters('彼女は窓を開けた。\n風が入ってきた。');
    expect(chapters).toHaveLength(1);
    expect(chapters[0]).toMatchObject({ title: '正文', startLine: 1 });
    expect(chapters[0].paragraphs).toHaveLength(2);
  });

  it('keeps source-line whitespace in non-empty paragraphs', () => {
    const chapters = parseTxtChapters('  字下げされた行　');
    expect(chapters[0].paragraphs[0].text).toBe('  字下げされた行　');
  });

  it('returns document-level paragraph and Unicode character counts', () => {
    const document = parseTxtDocument(new Uint8Array(Buffer.from('序章\n響け！\n北宇治。', 'utf8')));
    expect(document).toMatchObject({ encoding: 'utf-8', paragraphCount: 2, characterCount: 7 });
  });
});
