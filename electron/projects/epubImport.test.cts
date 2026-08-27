import { describe, expect, it } from 'vitest';
import { parseEpubDocument } from './epubImport.cjs';
import { createEpubFixture } from './epubTestFixture.cjs';

describe('EPUB structural import', () => {
  it('reads container, OPF, nav, spine and alternating bilingual blocks without executing script', async () => {
    const parsed = await parseEpubDocument(await createEpubFixture());
    expect(parsed).toMatchObject({
      title: '検証用の本',
      contentMode: 'bilingual',
      textBlockCount: 4,
      details: {
        packageVersion: '3.0',
        opfPath: 'OPS/package.opf',
        navigationKind: 'nav',
        navigationPath: 'OPS/nav.xhtml',
        pageProgression: 'rtl',
        bilingualLayout: 'alternating-lang',
        bilingualPairCount: 1,
        scriptCount: 1,
        imageCount: 1,
        rubyCount: 1,
      },
    });
    expect(parsed.spineDocuments).toHaveLength(1);
    expect(parsed.spineDocuments[0].title).toBe('序章');
    expect(parsed.spineDocuments[0].blocks.map((block) => block.sourceText)).toEqual([
      '序章', '这是中文。', 'これは日本語です。', '弱い身体《からだ》。',
    ]);
    expect(parsed.spineDocuments[0].blocks[1]).toMatchObject({ scriptKind: 'chinese', pairedOrdinal: 3 });
    expect(parsed.spineDocuments[0].blocks[2]).toMatchObject({ scriptKind: 'japanese', pairedOrdinal: 2 });
    expect(parsed.details.warnings[0]).toContain('不在界面执行');
  });

  it('keeps a stable DOM path, source XML and digest for every visible block', async () => {
    const parsed = await parseEpubDocument(await createEpubFixture());
    const rubyBlock = parsed.spineDocuments[0].blocks[3];
    expect(rubyBlock.domPath).toBe('/html[1]/body[1]/p[3]');
    expect(rubyBlock.sourceXml).toContain('<ruby>');
    expect(rubyBlock.sourceHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('correctly maps TOC chapter ranges and handles扉页/body splitting', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const realEpub = path.resolve('..', 'JP-幼女戦記 14 Dum spiro,spero ‐下‐.epub');
    if (!fs.existsSync(realEpub)) return;
    const bytes = fs.readFileSync(realEpub);
    const parsed = await parseEpubDocument(bytes);
    expect(parsed.title).toContain('幼女戦記 14');
    expect(parsed.spineDocuments.length).toBeGreaterThan(30);

    // Find Chapter 1
    const ch1 = parsed.spineDocuments.find((d) => d.title === '第壱章 義務の名のもとに');
    expect(ch1).toBeDefined();
    expect(ch1?.characterCount).toBeGreaterThan(30000);

    // Find Chapter 5
    const ch5 = parsed.spineDocuments.find((d) => d.title === '第伍章 魔導師の墓場');
    expect(ch5).toBeDefined();
    expect(ch5?.characterCount).toBeGreaterThan(40000);
  });

  it('correctly extracts Kobo-style div blocks and preserves br newlines', async () => {
    const { parseXmlDocument } = await import('./epubXml.cjs');
    const { buildEpubTextBlocks } = await import('./epubTextBlocks.cjs');
    const koboXml = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Kobo Test</title></head>
<body>
  <div class="kobo-content">
    第一行のテキスト。<br/>第二行のテキスト。<br/>第三行のテキスト。
  </div>
</body>
</html>`;
    const doc = parseXmlDocument(koboXml, 'kobo.xhtml', 'application/xhtml+xml');
    const { blocks } = buildEpubTextBlocks(doc, 'kobo.xhtml');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].tagName).toBe('div');
    expect(blocks[0].sourceText).toBe('第一行のテキスト。\n第二行のテキスト。\n第三行のテキスト。');
  });
});
