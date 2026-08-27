export const humanReadingTablesSql = `
  CREATE TABLE narrative_series (
    series_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE series_projects (
    series_id TEXT NOT NULL REFERENCES narrative_series(series_id) ON DELETE CASCADE,
    project_id TEXT NOT NULL UNIQUE REFERENCES projects(project_id) ON DELETE CASCADE,
    volume_ordinal INTEGER NOT NULL CHECK (volume_ordinal >= 1),
    volume_label TEXT NOT NULL,
    assignment_source TEXT NOT NULL CHECK (assignment_source IN ('manual', 'imported')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(series_id, project_id),
    UNIQUE(series_id, volume_ordinal)
  ) STRICT;
  CREATE INDEX series_projects_order ON series_projects(series_id, volume_ordinal);

  CREATE TABLE series_entities (
    series_entity_id TEXT PRIMARY KEY,
    series_id TEXT NOT NULL REFERENCES narrative_series(series_id) ON DELETE CASCADE,
    canonical_source TEXT NOT NULL,
    canonical_translation TEXT NOT NULL,
    entity_kind TEXT NOT NULL,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    status TEXT NOT NULL CHECK (status IN ('candidate', 'confirmed', 'locked', 'conflict')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(series_id, canonical_source)
  ) STRICT;
  CREATE INDEX series_entities_lookup ON series_entities(series_id, canonical_source, status);

  CREATE TABLE series_entity_links (
    link_id TEXT PRIMARY KEY,
    series_entity_id TEXT NOT NULL REFERENCES series_entities(series_entity_id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    entity_id TEXT NOT NULL REFERENCES narrative_entities(entity_id) ON DELETE CASCADE,
    link_reason TEXT NOT NULL,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    status TEXT NOT NULL CHECK (status IN ('candidate', 'confirmed', 'locked', 'conflict')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, entity_id)
  ) STRICT;
  CREATE INDEX series_entity_links_entity ON series_entity_links(series_entity_id, status);

  CREATE TABLE series_terms (
    series_term_id TEXT PRIMARY KEY,
    series_id TEXT NOT NULL REFERENCES narrative_series(series_id) ON DELETE CASCADE,
    source_term TEXT NOT NULL,
    translated_term TEXT NOT NULL,
    sense TEXT NOT NULL,
    entity_kind TEXT NOT NULL,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    status TEXT NOT NULL CHECK (status IN ('candidate', 'confirmed', 'locked', 'conflict')),
    source_project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    source_glossary_id TEXT NOT NULL REFERENCES glossary_entries(glossary_id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(series_id, source_term, sense)
  ) STRICT;
  CREATE INDEX series_terms_lookup ON series_terms(series_id, source_term, status);

  CREATE TABLE consolidated_memories (
    memory_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    series_id TEXT REFERENCES narrative_series(series_id) ON DELETE SET NULL,
    source_record_type TEXT NOT NULL CHECK (source_record_type IN ('fact', 'claim', 'event', 'frame', 'summary')),
    source_record_id TEXT NOT NULL,
    memory_class TEXT NOT NULL CHECK (memory_class IN ('canon', 'character', 'relationship', 'event', 'state', 'episode-detail')),
    summary TEXT NOT NULL,
    subject_key TEXT,
    object_key TEXT,
    track_key TEXT NOT NULL,
    worldline_key TEXT NOT NULL,
    scene_key TEXT NOT NULL,
    chapter_ordinal INTEGER NOT NULL CHECK (chapter_ordinal >= 1),
    segment_ordinal INTEGER CHECK (segment_ordinal IS NULL OR segment_ordinal >= 1),
    source_start_offset INTEGER CHECK (source_start_offset IS NULL OR source_start_offset >= 0),
    source_end_offset INTEGER CHECK (source_end_offset IS NULL OR source_end_offset >= source_start_offset),
    importance REAL NOT NULL CHECK (importance >= 0 AND importance <= 1),
    retention_policy TEXT NOT NULL CHECK (retention_policy IN ('permanent', 'stable', 'episodic', 'working')),
    retrieval_scope TEXT NOT NULL CHECK (retrieval_scope IN ('series', 'volume', 'chapter', 'scene')),
    consolidation_status TEXT NOT NULL CHECK (consolidation_status IN ('candidate', 'consolidated', 'archived', 'superseded', 'conflict')),
    supersedes_memory_id TEXT REFERENCES consolidated_memories(memory_id) ON DELETE SET NULL,
    evidence_ids_json TEXT NOT NULL,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    source_signature TEXT NOT NULL,
    last_accessed_at TEXT,
    access_count INTEGER NOT NULL DEFAULT 0 CHECK (access_count >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, source_record_type, source_record_id)
  ) STRICT;
  CREATE INDEX consolidated_memory_retrieval ON consolidated_memories(project_id, consolidation_status, memory_class, importance DESC);
  CREATE INDEX consolidated_series_memory ON consolidated_memories(series_id, consolidation_status, retrieval_scope, importance DESC);

  CREATE TABLE memory_consolidation_runs (
    run_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    chapter_id TEXT NOT NULL,
    chapter_ordinal INTEGER NOT NULL CHECK (chapter_ordinal >= 1),
    source_signature TEXT NOT NULL,
    created_count INTEGER NOT NULL CHECK (created_count >= 0),
    superseded_count INTEGER NOT NULL CHECK (superseded_count >= 0),
    archived_count INTEGER NOT NULL CHECK (archived_count >= 0),
    status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
    details_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(project_id, chapter_id, source_signature)
  ) STRICT;
  CREATE INDEX memory_consolidation_chapter ON memory_consolidation_runs(project_id, chapter_ordinal, created_at);

  CREATE TABLE translation_style_memories (
    style_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    series_id TEXT REFERENCES narrative_series(series_id) ON DELETE SET NULL,
    owner_type TEXT NOT NULL CHECK (owner_type IN ('series', 'narrator', 'character', 'relationship', 'scene')),
    owner_key TEXT NOT NULL,
    decision_kind TEXT NOT NULL CHECK (decision_kind IN ('register', 'pronoun', 'address', 'syntax', 'rhythm', 'punctuation', 'dialect', 'catchphrase', 'profanity', 'ambiguity-policy')),
    source_pattern TEXT NOT NULL,
    target_strategy TEXT NOT NULL,
    rationale TEXT NOT NULL,
    valid_from_chapter INTEGER NOT NULL CHECK (valid_from_chapter >= 1),
    valid_from_segment INTEGER CHECK (valid_from_segment IS NULL OR valid_from_segment >= 1),
    valid_from_offset INTEGER CHECK (valid_from_offset IS NULL OR valid_from_offset >= 0),
    valid_to_chapter INTEGER CHECK (valid_to_chapter IS NULL OR valid_to_chapter >= valid_from_chapter),
    valid_to_segment INTEGER CHECK (valid_to_segment IS NULL OR valid_to_segment >= 1),
    valid_to_offset INTEGER CHECK (valid_to_offset IS NULL OR valid_to_offset >= 0),
    evidence_id TEXT NOT NULL REFERENCES narrative_evidence(evidence_id) ON DELETE CASCADE,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    status TEXT NOT NULL CHECK (status IN ('candidate', 'confirmed', 'locked', 'superseded', 'conflict')),
    usage_count INTEGER NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, owner_type, owner_key, decision_kind, source_pattern, valid_from_chapter)
  ) STRICT;
  CREATE INDEX translation_style_retrieval ON translation_style_memories(project_id, owner_key, valid_from_chapter, status);
  CREATE INDEX translation_style_series ON translation_style_memories(series_id, owner_key, status);

  CREATE TABLE narrative_ambiguities (
    ambiguity_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    series_id TEXT REFERENCES narrative_series(series_id) ON DELETE SET NULL,
    chapter_id TEXT NOT NULL,
    chapter_ordinal INTEGER NOT NULL CHECK (chapter_ordinal >= 1),
    segment_ordinal INTEGER NOT NULL CHECK (segment_ordinal >= 1),
    source_start_offset INTEGER CHECK (source_start_offset IS NULL OR source_start_offset >= 0),
    source_end_offset INTEGER CHECK (source_end_offset IS NULL OR source_end_offset >= source_start_offset),
    ambiguity_kind TEXT NOT NULL CHECK (ambiguity_kind IN ('pun', 'identity', 'referent', 'scope', 'role', 'voice', 'temporal', 'narrative', 'other')),
    source_excerpt TEXT NOT NULL,
    interpretations_json TEXT NOT NULL,
    preservation_strategy TEXT NOT NULL CHECK (preservation_strategy IN ('preserve', 'resolve', 'transliterate', 'annotate', 'review')),
    reveal_chapter INTEGER CHECK (reveal_chapter IS NULL OR reveal_chapter >= 1),
    reveal_segment INTEGER CHECK (reveal_segment IS NULL OR reveal_segment >= 1),
    reveal_offset INTEGER CHECK (reveal_offset IS NULL OR reveal_offset >= 0),
    selected_interpretation TEXT,
    resolution_note TEXT NOT NULL,
    evidence_id TEXT NOT NULL REFERENCES narrative_evidence(evidence_id) ON DELETE CASCADE,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    status TEXT NOT NULL CHECK (status IN ('candidate', 'open', 'resolved', 'locked', 'superseded')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, chapter_id, segment_ordinal, source_start_offset, ambiguity_kind, source_excerpt)
  ) STRICT;
  CREATE INDEX narrative_ambiguity_workbench ON narrative_ambiguities(project_id, status, chapter_ordinal, segment_ordinal);
`;
