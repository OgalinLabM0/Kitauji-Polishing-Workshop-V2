import type { DatabaseSync } from 'node:sqlite';
import { humanReadingTablesSql } from './humanReadingSchema.cjs';
import { narrativeIntelligenceTablesSql } from './narrativeSchema.cjs';

export const CURRENT_PROJECT_SCHEMA_VERSION = 9;

const projectTableSql = (tableName: string) => `
  CREATE TABLE ${tableName} (
    project_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source_path TEXT NOT NULL,
    source_format TEXT NOT NULL CHECK (source_format IN ('txt', 'epub')),
    source_encoding TEXT CHECK (source_encoding IS NULL OR source_encoding IN ('utf-8', 'utf-16le', 'utf-16be', 'shift_jis')),
    content_mode TEXT NOT NULL CHECK (content_mode IN ('japanese', 'bilingual', 'unknown')),
    source_hash TEXT NOT NULL UNIQUE,
    source_size_bytes INTEGER NOT NULL CHECK (source_size_bytes >= 0),
    chapter_count INTEGER NOT NULL CHECK (chapter_count >= 0),
    paragraph_count INTEGER NOT NULL CHECK (paragraph_count >= 0),
    character_count INTEGER NOT NULL CHECK (character_count >= 0),
    imported_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_opened_at TEXT NOT NULL
  ) STRICT;
`;

const epubTablesSql = `
  CREATE TABLE source_archives (
    project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
    original_bytes BLOB NOT NULL
  ) STRICT;
  CREATE TABLE epub_documents (
    project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
    package_version TEXT NOT NULL, opf_path TEXT NOT NULL, package_language TEXT,
    creators_json TEXT NOT NULL,
    navigation_kind TEXT NOT NULL CHECK (navigation_kind IN ('nav', 'ncx', 'both', 'none')),
    navigation_path TEXT, page_progression TEXT,
    manifest_count INTEGER NOT NULL CHECK (manifest_count >= 0),
    spine_count INTEGER NOT NULL CHECK (spine_count >= 0),
    image_count INTEGER NOT NULL CHECK (image_count >= 0),
    ruby_count INTEGER NOT NULL CHECK (ruby_count >= 0),
    script_count INTEGER NOT NULL CHECK (script_count >= 0),
    external_reference_count INTEGER NOT NULL CHECK (external_reference_count >= 0),
    bilingual_layout TEXT NOT NULL CHECK (bilingual_layout IN ('none', 'alternating-lang', 'alternating-opacity', 'mixed', 'unknown')),
    bilingual_pair_count INTEGER NOT NULL CHECK (bilingual_pair_count >= 0),
    total_uncompressed_bytes INTEGER NOT NULL CHECK (total_uncompressed_bytes >= 0),
    warnings_json TEXT NOT NULL
  ) STRICT;
  CREATE TABLE epub_spine_items (
    spine_item_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL, item_id TEXT NOT NULL, href TEXT NOT NULL, media_type TEXT NOT NULL,
    linear INTEGER NOT NULL CHECK (linear IN (0, 1)), title TEXT NOT NULL,
    source_hash TEXT NOT NULL, source_size_bytes INTEGER NOT NULL CHECK (source_size_bytes >= 0),
    text_block_count INTEGER NOT NULL CHECK (text_block_count >= 0),
    character_count INTEGER NOT NULL CHECK (character_count >= 0),
    kana_count INTEGER NOT NULL CHECK (kana_count >= 0),
    han_count INTEGER NOT NULL CHECK (han_count >= 0),
    script_count INTEGER NOT NULL CHECK (script_count >= 0),
    ruby_count INTEGER NOT NULL CHECK (ruby_count >= 0),
    image_count INTEGER NOT NULL CHECK (image_count >= 0),
    external_reference_count INTEGER NOT NULL CHECK (external_reference_count >= 0),
    UNIQUE(project_id, ordinal), UNIQUE(project_id, href)
  ) STRICT;
  CREATE TABLE epub_text_blocks (
    block_id TEXT PRIMARY KEY,
    spine_item_id TEXT NOT NULL REFERENCES epub_spine_items(spine_item_id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL, dom_path TEXT NOT NULL, source_line INTEGER,
    tag_name TEXT NOT NULL, language TEXT,
    script_kind TEXT NOT NULL CHECK (script_kind IN ('japanese', 'chinese', 'mixed', 'neutral', 'unknown')),
    source_text TEXT NOT NULL, source_xml TEXT NOT NULL, source_hash TEXT NOT NULL,
    style_hint TEXT, paired_ordinal INTEGER,
    UNIQUE(spine_item_id, ordinal), UNIQUE(spine_item_id, dom_path)
  ) STRICT;
  CREATE INDEX epub_spine_project_order ON epub_spine_items(project_id, ordinal);
  CREATE INDEX epub_blocks_project_spine_order ON epub_text_blocks(project_id, spine_item_id, ordinal);
`;

const readerAndDraftTablesSql = `
  CREATE TABLE reading_positions (
    project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
    chapter_id TEXT NOT NULL,
    block_ordinal INTEGER NOT NULL CHECK (block_ordinal >= 1),
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE epub_block_drafts (
    block_id TEXT PRIMARY KEY REFERENCES epub_text_blocks(block_id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    draft_text TEXT NOT NULL,
    saved_source_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX epub_drafts_project ON epub_block_drafts(project_id, updated_at);
`;

const intelligenceAndWorkflowTablesSql = `
  CREATE TABLE translation_segments (
    segment_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    chapter_id TEXT NOT NULL,
    chapter_ordinal INTEGER NOT NULL CHECK (chapter_ordinal >= 1),
    segment_ordinal INTEGER NOT NULL CHECK (segment_ordinal >= 1),
    source_block_id TEXT NOT NULL,
    target_block_id TEXT,
    source_text TEXT NOT NULL,
    original_translation TEXT,
    source_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'translating', 'reviewing', 'approved', 'needs-human', 'failed', 'skipped')),
    selected_version_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, source_block_id)
  ) STRICT;
  CREATE INDEX translation_segments_project_order ON translation_segments(project_id, chapter_ordinal, segment_ordinal);
  CREATE INDEX translation_segments_status ON translation_segments(project_id, status, chapter_ordinal, segment_ordinal);

  CREATE TABLE translation_versions (
    version_id TEXT PRIMARY KEY,
    segment_id TEXT NOT NULL REFERENCES translation_segments(segment_id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL CHECK (version_number >= 1),
    stage TEXT NOT NULL CHECK (stage IN ('initial', 'self-repair', 'independent-review', 'manual', 'final')),
    text TEXT NOT NULL,
    model TEXT,
    provider_profile_id TEXT,
    prompt_version TEXT,
    context_manifest_json TEXT NOT NULL,
    response_id TEXT,
    finish_reason TEXT,
    input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
    output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
    cached_input_tokens INTEGER CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
    reasoning_tokens INTEGER CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0),
    elapsed_ms INTEGER CHECK (elapsed_ms IS NULL OR elapsed_ms >= 0),
    created_at TEXT NOT NULL,
    UNIQUE(segment_id, version_number)
  ) STRICT;
  CREATE INDEX translation_versions_segment ON translation_versions(segment_id, version_number DESC);

  CREATE TABLE workflow_tasks (
    task_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    task_type TEXT NOT NULL CHECK (task_type IN ('pre-read', 'translate', 'review', 'export')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'pausing', 'paused', 'completed', 'failed', 'cancelled', 'interrupted')),
    provider_profile_id TEXT,
    scope_json TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    total_items INTEGER NOT NULL CHECK (total_items >= 0),
    completed_items INTEGER NOT NULL CHECK (completed_items >= 0),
    failed_items INTEGER NOT NULL CHECK (failed_items >= 0),
    warning_items INTEGER NOT NULL CHECK (warning_items >= 0),
    input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
    output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
    error_message TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  ) STRICT;
  CREATE INDEX workflow_tasks_project_time ON workflow_tasks(project_id, created_at DESC);

  CREATE TABLE workflow_task_items (
    task_item_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES workflow_tasks(task_id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    chapter_id TEXT NOT NULL,
    segment_id TEXT REFERENCES translation_segments(segment_id) ON DELETE CASCADE,
    item_ordinal INTEGER NOT NULL CHECK (item_ordinal >= 1),
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
    attempts INTEGER NOT NULL CHECK (attempts >= 0),
    error_message TEXT,
    checkpoint_json TEXT NOT NULL DEFAULT '',
    started_at TEXT,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    UNIQUE(task_id, item_ordinal)
  ) STRICT;
  CREATE INDEX workflow_items_pending ON workflow_task_items(task_id, status, item_ordinal);

  CREATE TABLE glossary_entries (
    glossary_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    source_term TEXT NOT NULL,
    translated_term TEXT NOT NULL,
    reading TEXT,
    entity_kind TEXT NOT NULL CHECK (entity_kind IN ('character', 'animal', 'place', 'organization', 'item', 'ability', 'concept', 'other')),
    gender TEXT NOT NULL CHECK (gender IN ('unknown', 'male', 'female', 'nonbinary', 'not-applicable')),
    grammatical_number TEXT NOT NULL CHECK (grammatical_number IN ('unknown', 'singular', 'plural', 'collective', 'not-applicable')),
    sense TEXT NOT NULL,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    status TEXT NOT NULL CHECK (status IN ('candidate', 'confirmed', 'locked', 'rejected', 'conflict')),
    notes TEXT NOT NULL,
    epub_note TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, source_term, sense)
  ) STRICT;
  CREATE INDEX glossary_project_term ON glossary_entries(project_id, source_term);

  CREATE TABLE glossary_evidence (
    evidence_id TEXT PRIMARY KEY,
    glossary_id TEXT NOT NULL REFERENCES glossary_entries(glossary_id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    chapter_id TEXT NOT NULL,
    source_block_id TEXT NOT NULL,
    source_excerpt TEXT NOT NULL,
    translation_excerpt TEXT,
    evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('occurrence', 'reading', 'gender', 'number', 'identity', 'pun', 'translation')),
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX glossary_evidence_entry ON glossary_evidence(glossary_id, chapter_id);

  CREATE TABLE memory_facts (
    fact_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    fact_kind TEXT NOT NULL CHECK (fact_kind IN ('character', 'event', 'relationship', 'address', 'voice', 'viewpoint', 'setting', 'secret', 'foreshadowing', 'pun', 'scene-summary', 'chapter-summary')),
    subject_key TEXT,
    object_key TEXT,
    statement TEXT NOT NULL,
    chapter_start INTEGER NOT NULL CHECK (chapter_start >= 1),
    chapter_start_segment INTEGER CHECK (chapter_start_segment IS NULL OR chapter_start_segment >= 1),
    chapter_start_offset INTEGER CHECK (chapter_start_offset IS NULL OR chapter_start_offset >= 0),
    chapter_end INTEGER CHECK (chapter_end IS NULL OR chapter_end >= chapter_start),
    chapter_end_segment INTEGER CHECK (chapter_end_segment IS NULL OR chapter_end_segment >= 1),
    chapter_end_offset INTEGER CHECK (chapter_end_offset IS NULL OR chapter_end_offset >= 0),
    reader_visible_from INTEGER NOT NULL CHECK (reader_visible_from >= 1),
    reader_visible_from_segment INTEGER CHECK (reader_visible_from_segment IS NULL OR reader_visible_from_segment >= 1),
    reader_visible_from_offset INTEGER CHECK (reader_visible_from_offset IS NULL OR reader_visible_from_offset >= 0),
    memory_class TEXT NOT NULL CHECK (memory_class IN ('canon', 'character', 'relationship', 'event', 'state', 'episode-detail')),
    importance REAL NOT NULL CHECK (importance >= 0 AND importance <= 1),
    retention_policy TEXT NOT NULL CHECK (retention_policy IN ('permanent', 'stable', 'episodic', 'working')),
    retrieval_scope TEXT NOT NULL CHECK (retrieval_scope IN ('series', 'volume', 'chapter', 'scene')),
    consolidation_status TEXT NOT NULL CHECK (consolidation_status IN ('candidate', 'consolidated', 'archived', 'superseded', 'conflict')),
    supersedes_fact_id TEXT REFERENCES memory_facts(fact_id) ON DELETE SET NULL,
    character_knowledge_json TEXT NOT NULL,
    source_block_id TEXT,
    evidence_excerpt TEXT NOT NULL,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    status TEXT NOT NULL CHECK (status IN ('hypothesis', 'confirmed', 'locked', 'superseded', 'conflict')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX memory_facts_retrieval ON memory_facts(project_id, fact_kind, chapter_start, reader_visible_from);
  CREATE INDEX memory_facts_subject ON memory_facts(project_id, subject_key, object_key);

  CREATE TABLE review_items (
    review_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    segment_id TEXT REFERENCES translation_segments(segment_id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('hard-rule', 'semantic', 'glossary', 'identity', 'knowledge-boundary', 'literary-choice', 'format', 'provider-refusal')),
    severity TEXT NOT NULL CHECK (severity IN ('warning', 'blocking', 'must-human')),
    status TEXT NOT NULL CHECK (status IN ('open', 'auto-resolved', 'accepted', 'rejected', 'superseded')),
    title TEXT NOT NULL,
    explanation TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    proposed_text TEXT,
    resolution_note TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  ) STRICT;
  CREATE INDEX review_items_queue ON review_items(project_id, status, severity, created_at);

  CREATE TABLE operation_log (
    log_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    task_id TEXT REFERENCES workflow_tasks(task_id) ON DELETE SET NULL,
    segment_id TEXT REFERENCES translation_segments(segment_id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    details_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX operation_log_project_time ON operation_log(project_id, created_at DESC);
`;

const createFreshSchema = (database: DatabaseSync) => database.exec(`
  BEGIN IMMEDIATE;
  ${projectTableSql('projects')}
  CREATE TABLE source_documents (
    project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
    original_bytes BLOB NOT NULL, decoded_text TEXT NOT NULL, newline_style TEXT NOT NULL
  ) STRICT;
  CREATE TABLE chapters (
    chapter_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL, title TEXT NOT NULL, start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL, source_text TEXT NOT NULL,
    paragraph_count INTEGER NOT NULL, character_count INTEGER NOT NULL,
    UNIQUE(project_id, ordinal)
  ) STRICT;
  CREATE TABLE paragraphs (
    paragraph_id TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL REFERENCES chapters(chapter_id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL, source_line INTEGER NOT NULL, source_text TEXT NOT NULL,
    UNIQUE(chapter_id, ordinal)
  ) STRICT;
  CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
  CREATE INDEX chapters_project_order ON chapters(project_id, ordinal);
  CREATE INDEX paragraphs_project_chapter_order ON paragraphs(project_id, chapter_id, ordinal);
  ${epubTablesSql}
  ${readerAndDraftTablesSql}
  ${intelligenceAndWorkflowTablesSql}
  ${narrativeIntelligenceTablesSql}
  ${humanReadingTablesSql}
  PRAGMA user_version = 9;
  COMMIT;
`);

const migrateVersionOneToTwo = (database: DatabaseSync) => {
  database.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;');
  try {
    database.exec(`
      ${projectTableSql('projects_v2')}
      INSERT INTO projects_v2(
        project_id, title, source_path, source_format, source_encoding, content_mode, source_hash,
        source_size_bytes, chapter_count, paragraph_count, character_count,
        imported_at, updated_at, last_opened_at
      ) SELECT project_id, title, source_path, source_format, source_encoding, 'unknown', source_hash,
        source_size_bytes, chapter_count, paragraph_count, character_count,
        imported_at, updated_at, last_opened_at FROM projects;
      DROP TABLE projects;
      ALTER TABLE projects_v2 RENAME TO projects;
      ${epubTablesSql}
      PRAGMA user_version = 2;
      COMMIT;
    `);
  } catch (error) {
    database.exec('ROLLBACK; PRAGMA foreign_keys = ON;');
    throw error;
  }
  database.exec('PRAGMA foreign_keys = ON;');
  if (database.prepare('PRAGMA foreign_key_check').all().length > 0) {
    throw new Error('项目数据库迁移后外键检查失败。');
  }
};

const migrateVersionTwoToThree = (database: DatabaseSync) => {
  database.exec('BEGIN IMMEDIATE;');
  try {
    database.exec(`${readerAndDraftTablesSql} PRAGMA user_version = 3; COMMIT;`);
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
};

const migrateVersionThreeToFour = (database: DatabaseSync) => {
  database.exec('BEGIN IMMEDIATE;');
  try {
    database.exec(`${intelligenceAndWorkflowTablesSql} PRAGMA user_version = 4; COMMIT;`);
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
};

const migrateVersionFourToFive = (database: DatabaseSync) => {
  const alreadyPresent = database.prepare("SELECT name FROM pragma_table_info('glossary_entries') WHERE name = 'epub_note'").get();
  if (alreadyPresent) {
    database.exec('PRAGMA user_version = 5;');
    return;
  }
  database.exec('BEGIN IMMEDIATE;');
  try {
    database.exec(`ALTER TABLE glossary_entries ADD COLUMN epub_note TEXT NOT NULL DEFAULT ''; PRAGMA user_version = 5; COMMIT;`);
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
};

const migrateVersionFiveToSix = (database: DatabaseSync) => {
  const alreadyPresent = database.prepare("SELECT name FROM pragma_table_info('workflow_task_items') WHERE name = 'checkpoint_json'").get();
  if (alreadyPresent) {
    database.exec('PRAGMA user_version = 6;');
    return;
  }
  database.exec('BEGIN IMMEDIATE;');
  try {
    database.exec(`ALTER TABLE workflow_task_items ADD COLUMN checkpoint_json TEXT NOT NULL DEFAULT ''; PRAGMA user_version = 6; COMMIT;`);
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
};

const migrateVersionSixToSeven = (database: DatabaseSync) => {
  const alreadyPresent = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'narrative_entities'").get();
  if (alreadyPresent) {
    database.exec('PRAGMA user_version = 7;');
    return;
  }
  database.exec('BEGIN IMMEDIATE;');
  try {
    database.exec(`${narrativeIntelligenceTablesSql} PRAGMA user_version = 7; COMMIT;`);
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
};

const addColumnIfMissing = (database: DatabaseSync, table: string, column: string, definition: string) => {
  const tableExists = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!tableExists) return;
  const columnExists = database.prepare(`SELECT name FROM pragma_table_info('${table}') WHERE name = ?`).get(column);
  if (!columnExists) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
};

const hasTable = (database: DatabaseSync, table: string) => Boolean(
  database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
);

const migrateVersionSevenToEight = (database: DatabaseSync) => {
  database.exec('BEGIN IMMEDIATE;');
  try {
    addColumnIfMissing(database, 'memory_facts', 'chapter_start_segment', 'INTEGER CHECK (chapter_start_segment IS NULL OR chapter_start_segment >= 1)');
    addColumnIfMissing(database, 'memory_facts', 'chapter_end_segment', 'INTEGER CHECK (chapter_end_segment IS NULL OR chapter_end_segment >= 1)');
    addColumnIfMissing(database, 'memory_facts', 'reader_visible_from_segment', 'INTEGER CHECK (reader_visible_from_segment IS NULL OR reader_visible_from_segment >= 1)');
    addColumnIfMissing(database, 'narrative_aliases', 'reader_visible_from_chapter', 'INTEGER NOT NULL DEFAULT 1 CHECK (reader_visible_from_chapter >= 1)');
    addColumnIfMissing(database, 'narrative_aliases', 'reader_visible_from_segment', 'INTEGER CHECK (reader_visible_from_segment IS NULL OR reader_visible_from_segment >= 1)');
    addColumnIfMissing(database, 'narrative_claims', 'reader_visible_from_segment', 'INTEGER CHECK (reader_visible_from_segment IS NULL OR reader_visible_from_segment >= 1)');
    addColumnIfMissing(database, 'narrative_claims', 'worldline_key', "TEXT NOT NULL DEFAULT 'main'");
    addColumnIfMissing(database, 'narrative_claims', 'scene_key', "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(database, 'narrative_events', 'reader_visible_from_segment', 'INTEGER CHECK (reader_visible_from_segment IS NULL OR reader_visible_from_segment >= 1)');
    addColumnIfMissing(database, 'narrative_events', 'worldline_key', "TEXT NOT NULL DEFAULT 'main'");
    addColumnIfMissing(database, 'narrative_events', 'scene_key', "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(database, 'character_knowledge', 'known_to_segment', 'INTEGER CHECK (known_to_segment IS NULL OR known_to_segment >= 1)');
    addColumnIfMissing(database, 'world_state_snapshots', 'worldline_key', "TEXT NOT NULL DEFAULT 'main'");
    addColumnIfMissing(database, 'world_state_snapshots', 'scene_key', "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(database, 'translation_dependencies', 'frame_ids_json', "TEXT NOT NULL DEFAULT '[]'");
    database.exec(`
      CREATE TABLE IF NOT EXISTS narrative_context_frames (
        frame_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
        chapter_id TEXT NOT NULL,
        frame_kind TEXT NOT NULL CHECK (frame_kind IN ('main', 'flashback', 'flashforward', 'dream', 'hypothetical', 'fiction-within-fiction', 'unreliable', 'unknown')),
        worldline_key TEXT NOT NULL, story_time_key TEXT NOT NULL, scene_key TEXT NOT NULL,
        location_key TEXT NOT NULL, viewpoint_key TEXT NOT NULL, narrator_key TEXT NOT NULL,
        participant_keys_json TEXT NOT NULL,
        valid_from_chapter INTEGER NOT NULL CHECK (valid_from_chapter >= 1),
        valid_from_segment INTEGER NOT NULL CHECK (valid_from_segment >= 1),
        valid_to_chapter INTEGER CHECK (valid_to_chapter IS NULL OR valid_to_chapter >= valid_from_chapter),
        valid_to_segment INTEGER CHECK (valid_to_segment IS NULL OR valid_to_segment >= 1),
        evidence_id TEXT NOT NULL REFERENCES narrative_evidence(evidence_id) ON DELETE CASCADE,
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        status TEXT NOT NULL CHECK (status IN ('hypothesis', 'confirmed', 'locked', 'conflict')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS narrative_context_frame_position ON narrative_context_frames(project_id, valid_from_chapter, valid_from_segment, valid_to_chapter, valid_to_segment);
    `);
    database.exec('PRAGMA user_version = 8; COMMIT;');
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
};

const migrateVersionEightToNine = (database: DatabaseSync) => {
  database.exec('BEGIN IMMEDIATE;');
  try {
    addColumnIfMissing(database, 'memory_facts', 'chapter_start_offset', 'INTEGER CHECK (chapter_start_offset IS NULL OR chapter_start_offset >= 0)');
    addColumnIfMissing(database, 'memory_facts', 'chapter_end_offset', 'INTEGER CHECK (chapter_end_offset IS NULL OR chapter_end_offset >= 0)');
    addColumnIfMissing(database, 'memory_facts', 'reader_visible_from_offset', 'INTEGER CHECK (reader_visible_from_offset IS NULL OR reader_visible_from_offset >= 0)');
    addColumnIfMissing(database, 'memory_facts', 'memory_class', "TEXT NOT NULL DEFAULT 'episode-detail' CHECK (memory_class IN ('canon', 'character', 'relationship', 'event', 'state', 'episode-detail'))");
    addColumnIfMissing(database, 'memory_facts', 'importance', 'REAL NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1)');
    addColumnIfMissing(database, 'memory_facts', 'retention_policy', "TEXT NOT NULL DEFAULT 'episodic' CHECK (retention_policy IN ('permanent', 'stable', 'episodic', 'working'))");
    addColumnIfMissing(database, 'memory_facts', 'retrieval_scope', "TEXT NOT NULL DEFAULT 'volume' CHECK (retrieval_scope IN ('series', 'volume', 'chapter', 'scene'))");
    addColumnIfMissing(database, 'memory_facts', 'consolidation_status', "TEXT NOT NULL DEFAULT 'candidate' CHECK (consolidation_status IN ('candidate', 'consolidated', 'archived', 'superseded', 'conflict'))");
    addColumnIfMissing(database, 'memory_facts', 'supersedes_fact_id', 'TEXT');

    addColumnIfMissing(database, 'narrative_evidence', 'source_start_offset', 'INTEGER CHECK (source_start_offset IS NULL OR source_start_offset >= 0)');
    addColumnIfMissing(database, 'narrative_evidence', 'source_end_offset', 'INTEGER CHECK (source_end_offset IS NULL OR source_end_offset >= source_start_offset)');
    addColumnIfMissing(database, 'narrative_evidence', 'locator_status', "TEXT NOT NULL DEFAULT 'unlocated' CHECK (locator_status IN ('exact', 'ambiguous', 'unlocated'))");

    for (const table of ['narrative_aliases', 'narrative_claims', 'narrative_events']) {
      addColumnIfMissing(database, table, 'valid_from_offset', 'INTEGER CHECK (valid_from_offset IS NULL OR valid_from_offset >= 0)');
      addColumnIfMissing(database, table, 'valid_to_offset', 'INTEGER CHECK (valid_to_offset IS NULL OR valid_to_offset >= 0)');
      addColumnIfMissing(database, table, 'reader_visible_from_offset', 'INTEGER CHECK (reader_visible_from_offset IS NULL OR reader_visible_from_offset >= 0)');
    }
    for (const table of ['narrative_claims', 'narrative_events']) {
      addColumnIfMissing(database, table, 'memory_class', "TEXT NOT NULL DEFAULT 'episode-detail' CHECK (memory_class IN ('canon', 'character', 'relationship', 'event', 'state', 'episode-detail'))");
      addColumnIfMissing(database, table, 'importance', 'REAL NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1)');
      addColumnIfMissing(database, table, 'retrieval_scope', "TEXT NOT NULL DEFAULT 'volume' CHECK (retrieval_scope IN ('series', 'volume', 'chapter', 'scene'))");
    }
    addColumnIfMissing(database, 'narrative_mentions', 'source_start_offset', 'INTEGER CHECK (source_start_offset IS NULL OR source_start_offset >= 0)');
    addColumnIfMissing(database, 'narrative_mentions', 'source_end_offset', 'INTEGER CHECK (source_end_offset IS NULL OR source_end_offset >= source_start_offset)');
    addColumnIfMissing(database, 'character_knowledge', 'known_from_offset', 'INTEGER CHECK (known_from_offset IS NULL OR known_from_offset >= 0)');
    addColumnIfMissing(database, 'character_knowledge', 'known_to_offset', 'INTEGER CHECK (known_to_offset IS NULL OR known_to_offset >= 0)');
    addColumnIfMissing(database, 'world_state_snapshots', 'valid_from_offset', 'INTEGER CHECK (valid_from_offset IS NULL OR valid_from_offset >= 0)');
    addColumnIfMissing(database, 'world_state_snapshots', 'valid_to_offset', 'INTEGER CHECK (valid_to_offset IS NULL OR valid_to_offset >= 0)');

    addColumnIfMissing(database, 'narrative_context_frames', 'frame_key', "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(database, 'narrative_context_frames', 'parent_frame_key', "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(database, 'narrative_context_frames', 'parent_frame_id', 'TEXT');
    addColumnIfMissing(database, 'narrative_context_frames', 'nesting_depth', 'INTEGER NOT NULL DEFAULT 0 CHECK (nesting_depth >= 0)');
    addColumnIfMissing(database, 'narrative_context_frames', 'discourse_mode', "TEXT NOT NULL DEFAULT 'unknown' CHECK (discourse_mode IN ('narration', 'direct-quote', 'indirect-quote', 'free-indirect', 'monologue', 'unknown'))");
    addColumnIfMissing(database, 'narrative_context_frames', 'quote_level', 'INTEGER NOT NULL DEFAULT 0 CHECK (quote_level >= 0)');
    addColumnIfMissing(database, 'narrative_context_frames', 'speaker_key', "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(database, 'narrative_context_frames', 'addressee_key', "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(database, 'narrative_context_frames', 'valid_from_offset', 'INTEGER CHECK (valid_from_offset IS NULL OR valid_from_offset >= 0)');
    addColumnIfMissing(database, 'narrative_context_frames', 'valid_to_offset', 'INTEGER CHECK (valid_to_offset IS NULL OR valid_to_offset >= 0)');

    addColumnIfMissing(database, 'translation_dependencies', 'memory_ids_json', "TEXT NOT NULL DEFAULT '[]'");
    addColumnIfMissing(database, 'translation_dependencies', 'style_ids_json', "TEXT NOT NULL DEFAULT '[]'");
    addColumnIfMissing(database, 'translation_dependencies', 'ambiguity_ids_json', "TEXT NOT NULL DEFAULT '[]'");
    addColumnIfMissing(database, 'translation_dependencies', 'syntax_evidence_json', "TEXT NOT NULL DEFAULT '[]'");
    addColumnIfMissing(database, 'translation_dependencies', 'series_context_json', "TEXT NOT NULL DEFAULT '{}'");

    database.exec(humanReadingTablesSql);
    if (hasTable(database, 'narrative_evidence')) database.exec(
      'CREATE INDEX IF NOT EXISTS narrative_evidence_exact_span ON narrative_evidence(project_id, chapter_ordinal, segment_ordinal, source_start_offset, source_end_offset)',
    );
    if (hasTable(database, 'narrative_context_frames')) database.exec(
      'CREATE INDEX IF NOT EXISTS narrative_frame_nested_position ON narrative_context_frames(project_id, chapter_id, valid_from_segment, valid_from_offset, nesting_depth)',
    );
    database.exec('PRAGMA user_version = 9; COMMIT;');
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
};

export const migrateProjectDatabase = (database: DatabaseSync) => {
  let version = (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (version > CURRENT_PROJECT_SCHEMA_VERSION) throw new Error(`项目数据库版本 ${version} 高于当前软件支持版本。`);
  if (version === 0) {
    createFreshSchema(database);
    version = 9;
  }
  if (version === 1) {
    migrateVersionOneToTwo(database);
    version = 2;
  }
  if (version === 2) {
    migrateVersionTwoToThree(database);
    version = 3;
  }
  if (version === 3) {
    migrateVersionThreeToFour(database);
    version = 4;
  }
  if (version === 4) {
    migrateVersionFourToFive(database);
    version = 5;
  }
  if (version === 5) {
    migrateVersionFiveToSix(database);
    version = 6;
  }
  if (version === 6) {
    migrateVersionSixToSeven(database);
    version = 7;
  }
  if (version === 7) {
    migrateVersionSevenToEight(database);
    version = 8;
  }
  if (version === 8) migrateVersionEightToNine(database);
  const finalVersion = (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (finalVersion !== CURRENT_PROJECT_SCHEMA_VERSION) throw new Error('项目数据库迁移未完成。');
};
