import { describe, expect, it } from 'vitest';
import { escapeXmlText, hasInvalidXmlCodePoint, locateElementContentRange } from './epubLexicalWriteback.cjs';
import { decodeXmlBytes, encodeXmlText } from './epubXml.cjs';

describe('EPUB lexical writeback', () => {
  it('locates namespaced elements without rewriting surrounding markup', () => {
    const source = `<?xml version="1.0"?><html xmlns="x"><body><p class='lead'>原文</p><p><span>复杂</span></p></body></html>`;
    const range = locateElementContentRange(source, '/html[1]/body[1]/p[1]');
    expect(source.slice(range.contentStart, range.contentEnd)).toBe('原文');
    const changed = `${source.slice(0, range.contentStart)}${escapeXmlText('改&<译>')}${source.slice(range.contentEnd)}`;
    expect(changed).toBe(`<?xml version="1.0"?><html xmlns="x"><body><p class='lead'>改&amp;&lt;译&gt;</p><p><span>复杂</span></p></body></html>`);
  });

  it('counts same-name siblings per parent and ignores doctype/comment markup', () => {
    const source = '<!DOCTYPE html><!-- x --><html><body><section><p>一</p></section><p>二</p></body></html>';
    const range = locateElementContentRange(source, '/html[1]/body[1]/p[1]');
    expect(source.slice(range.contentStart, range.contentEnd)).toBe('二');
  });

  it('rejects invalid XML control characters', () => {
    expect(hasInvalidXmlCodePoint('正常\n正文')).toBe(false);
    expect(hasInvalidXmlCodePoint('坏\u0001字')).toBe(true);
  });

  it('preserves UTF-16 byte order and BOM for modified XHTML', () => {
    const source = '<?xml version="1.0" encoding="UTF-16"?><p>日本語</p>';
    for (const encoding of ['utf-16le', 'utf-16be'] as const) {
      const encoded = encodeXmlText(source, encoding, true);
      expect(decodeXmlBytes(encoded, 'fixture.xhtml')).toEqual({ text: source, encoding, hadBom: true });
    }
  });
});
