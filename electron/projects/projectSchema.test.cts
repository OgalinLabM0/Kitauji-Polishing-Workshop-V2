import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { migrateProjectDatabase } from './projectSchema.cjs';

describe('project schema migrations', () => {
  it('migrates a version two project library without changing existing source rows', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE projects (project_id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE epub_text_blocks (block_id TEXT PRIMARY KEY) STRICT;
      INSERT INTO projects(project_id) VALUES('project-existing');
      INSERT INTO epub_text_blocks(block_id) VALUES('block-existing');
      PRAGMA user_version = 2;
    `);
    migrateProjectDatabase(database);
    expect((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(9);
    expect(database.prepare('SELECT project_id FROM projects').get()).toEqual({ project_id: 'project-existing' });
    expect(database.prepare('SELECT block_id FROM epub_text_blocks').get()).toEqual({ block_id: 'block-existing' });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reading_positions'").get()).toEqual({ name: 'reading_positions' });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='epub_block_drafts'").get()).toEqual({ name: 'epub_block_drafts' });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_tasks'").get()).toEqual({ name: 'workflow_tasks' });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_facts'").get()).toEqual({ name: 'memory_facts' });
    expect(database.prepare("SELECT name FROM pragma_table_info('glossary_entries') WHERE name='epub_note'").get()).toEqual({ name: 'epub_note' });
    expect(database.prepare("SELECT name FROM pragma_table_info('workflow_task_items') WHERE name='checkpoint_json'").get()).toEqual({ name: 'checkpoint_json' });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='narrative_entities'").get()).toEqual({ name: 'narrative_entities' });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='narrative_events'").get()).toEqual({ name: 'narrative_events' });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='translation_dependencies'").get()).toEqual({ name: 'translation_dependencies' });
    expect(database.prepare("SELECT name FROM pragma_table_info('narrative_claims') WHERE name='reader_visible_from_segment'").get()).toEqual({ name: 'reader_visible_from_segment' });
    expect(database.prepare("SELECT name FROM pragma_table_info('character_knowledge') WHERE name='known_to_segment'").get()).toEqual({ name: 'known_to_segment' });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='consolidated_memories'").get()).toEqual({ name: 'consolidated_memories' });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='narrative_ambiguities'").get()).toEqual({ name: 'narrative_ambiguities' });
    database.close();
  });

  it('adds resumable pre-read checkpoints to an existing version five library', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE workflow_task_items (task_item_id TEXT PRIMARY KEY) STRICT;
      INSERT INTO workflow_task_items(task_item_id) VALUES('item-existing');
      PRAGMA user_version = 5;
    `);
    migrateProjectDatabase(database);
    expect((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(9);
    expect(database.prepare('SELECT task_item_id, checkpoint_json FROM workflow_task_items').get()).toEqual({
      task_item_id: 'item-existing', checkpoint_json: '',
    });
    database.close();
  });

  it('upgrades version seven narrative tables to exact segment knowledge boundaries without losing rows', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE memory_facts (fact_id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE narrative_aliases (alias_id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE narrative_claims (claim_id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE narrative_events (event_id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE character_knowledge (knowledge_id TEXT PRIMARY KEY) STRICT;
      INSERT INTO memory_facts(fact_id) VALUES('fact-existing');
      INSERT INTO narrative_aliases(alias_id) VALUES('alias-existing');
      PRAGMA user_version = 7;
    `);
    migrateProjectDatabase(database);
    expect((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(9);
    expect(database.prepare('SELECT fact_id, chapter_start_segment, chapter_end_segment, reader_visible_from_segment FROM memory_facts').get()).toEqual({
      fact_id: 'fact-existing', chapter_start_segment: null, chapter_end_segment: null, reader_visible_from_segment: null,
    });
    expect(database.prepare('SELECT alias_id, reader_visible_from_chapter, reader_visible_from_segment FROM narrative_aliases').get()).toEqual({
      alias_id: 'alias-existing', reader_visible_from_chapter: 1, reader_visible_from_segment: null,
    });
    expect(database.prepare("SELECT name FROM pragma_table_info('memory_facts') WHERE name='chapter_start_offset'").get()).toEqual({ name: 'chapter_start_offset' });
    expect(database.prepare("SELECT name FROM pragma_table_info('narrative_aliases') WHERE name='valid_from_offset'").get()).toEqual({ name: 'valid_from_offset' });
    database.close();
  });
});
