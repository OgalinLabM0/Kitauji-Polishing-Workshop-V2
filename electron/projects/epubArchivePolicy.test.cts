import { describe, expect, it } from 'vitest';
import { inspectEpubArchive } from './epubArchivePolicy.cjs';
import { createEpubFixture } from './epubTestFixture.cjs';

describe('EPUB archive safety policy', () => {
  it('accepts a standard archive with stored first mimetype', async () => {
    const report = inspectEpubArchive(await createEpubFixture());
    expect(report.entries[0]).toMatchObject({ name: 'mimetype', compressionMethod: 0 });
    expect(report.entries.map((entry) => entry.name)).toContain('META-INF/container.xml');
    expect(report.totalUncompressedBytes).toBeGreaterThan(0);
  });

  it('rejects a compressed mimetype entry', async () => {
    const bytes = await createEpubFixture({ compressedMimeType: true });
    expect(() => inspectEpubArchive(bytes)).toThrow('mimetype 必须使用 STORE');
  });

  it('rejects archive path traversal before JSZip extraction', async () => {
    const bytes = await createEpubFixture({ unsafePath: true });
    expect(() => inspectEpubArchive(bytes)).toThrow('路径穿越');
  });

  it('rejects empty input', () => {
    expect(() => inspectEpubArchive(new Uint8Array())).toThrow('为空');
  });
});
