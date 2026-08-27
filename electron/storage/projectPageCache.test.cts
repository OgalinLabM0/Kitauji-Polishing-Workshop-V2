import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProjectChapterContent } from '../projects/models.cjs';
import { ProjectPageCache } from './projectPageCache.cjs';

const projectId = 'project-1234567890abcdef12345678';
const content: ProjectChapterContent = {
  projectId,
  chapterId: `${projectId}:s00001`,
  chapterOrdinal: 1,
  chapterTitle: '序章',
  sourceFormat: 'epub',
  contentMode: 'bilingual',
  totalBlocks: 1,
  offset: 0,
  limit: 120,
  blocks: [{
    blockId: `${projectId}:s00001:b0000001`,
    ordinal: 1,
    sourceLine: 1,
    tagName: 'p',
    language: 'zh',
    scriptKind: 'chinese',
    sourceText: '缓存正文',
    styleHint: null,
    pairedOrdinal: 2,
    draftText: null,
    canEdit: true,
    editRestriction: null,
  }],
};

describe('project page cache', () => {
  it('round-trips a validated chapter page and invalidates by project', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kitauji-page-cache-'));
    const cache = new ProjectPageCache(directory);
    cache.set(content);
    expect(cache.get(projectId, content.chapterId, 0, 120)).toEqual(content);
    cache.invalidateProject(projectId);
    expect(cache.get(projectId, content.chapterId, 0, 120)).toBeNull();
  });

  it('drops malformed cache data instead of returning it', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kitauji-page-cache-'));
    const cache = new ProjectPageCache(directory);
    cache.set(content);
    const file = readdirSync(directory).find((name) => name.endsWith('.json'))!;
    writeFileSync(path.join(directory, file), '{"projectId":"wrong"}');
    expect(cache.get(projectId, content.chapterId, 0, 120)).toBeNull();
  });
});
