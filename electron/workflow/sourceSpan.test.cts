import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { locateSourceSpan } from './sourceSpan.cjs';

const databaseWithSegments = () => {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE translation_segments(
      source_block_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
      segment_ordinal INTEGER NOT NULL, source_text TEXT NOT NULL
    ) STRICT;
    INSERT INTO translation_segments VALUES
      ('b1', 'p1', 'c1', 1, '彼女は笑った。彼女は笑った。'),
      ('b2', 'p1', 'c1', 2, '彼は静かに答えた。');
  `);
  return database;
};

describe('exact source-span grounding', () => {
  it('does not pretend a repeated excerpt has a unique character position', () => {
    const database = databaseWithSegments();
    expect(locateSourceSpan(database, 'p1', 'c1', '彼女は笑った', 1, null)).toMatchObject({
      segmentOrdinal: 1, startOffset: null, endOffset: null, status: 'ambiguous',
    });
    database.close();
  });

  it('accepts a verified UTF-16 start offset and rejects a wrong preferred offset', () => {
    const database = databaseWithSegments();
    expect(locateSourceSpan(database, 'p1', 'c1', '彼女は笑った', 1, 7)).toMatchObject({
      segmentOrdinal: 1, startOffset: 7, endOffset: 13, status: 'exact',
    });
    expect(locateSourceSpan(database, 'p1', 'c1', '彼は静かに答えた', 2, 1)).toMatchObject({
      segmentOrdinal: 2, startOffset: 0, status: 'exact',
    });
    database.close();
  });
});
