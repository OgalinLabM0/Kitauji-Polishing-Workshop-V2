export const narrativeIntelligenceTablesSql = `
  CREATE TABLE narrative_evidence (
    evidence_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    chapter_id TEXT NOT NULL,
    chapter_ordinal INTEGER NOT NULL CHECK (chapter_ordinal >= 1),
    segment_ordinal INTEGER CHECK (segment_ordinal IS NULL OR segment_ordinal >= 1),
    source_block_id TEXT,
    source_excerpt TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    source_start_offset INTEGER CHECK (source_start_offset IS NULL OR source_start_offset >= 0),
    source_end_offset INTEGER CHECK (source_end_offset IS NULL OR source_end_offset >= source_start_offset),
    locator_status TEXT NOT NULL CHECK (locator_status IN ('exact', 'ambiguous', 'unlocated')),
    evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('direct', 'inferred', 'reviewer-corrected', 'manual')),
    created_at TEXT NOT NULL,
    UNIQUE(project_id, chapter_id, source_hash, evidence_kind)
  ) STRICT;
  CREATE INDEX narrative_evidence_position ON narrative_evidence(project_id, chapter_ordinal, segment_ordinal);

  CREATE TABLE narrative_context_frames (
    frame_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    chapter_id TEXT NOT NULL,
    frame_kind TEXT NOT NULL CHECK (frame_kind IN ('main', 'flashback', 'flashforward', 'dream', 'hypothetical', 'fiction-within-fiction', 'unreliable', 'unknown')),
    worldline_key TEXT NOT NULL,
    story_time_key TEXT NOT NULL,
    scene_key TEXT NOT NULL,
    location_key TEXT NOT NULL,
    viewpoint_key TEXT NOT NULL,
    narrator_key TEXT NOT NULL,
    participant_keys_json TEXT NOT NULL,
    frame_key TEXT NOT NULL,
    parent_frame_key TEXT NOT NULL,
    parent_frame_id TEXT REFERENCES narrative_context_frames(frame_id) ON DELETE SET NULL,
    nesting_depth INTEGER NOT NULL CHECK (nesting_depth >= 0),
    discourse_mode TEXT NOT NULL CHECK (discourse_mode IN ('narration', 'direct-quote', 'indirect-quote', 'free-indirect', 'monologue', 'unknown')),
    quote_level INTEGER NOT NULL CHECK (quote_level >= 0),
    speaker_key TEXT NOT NULL,
    addressee_key TEXT NOT NULL,
    valid_from_chapter INTEGER NOT NULL CHECK (valid_from_chapter >= 1),
    valid_from_segment INTEGER NOT NULL CHECK (valid_from_segment >= 1),
    valid_from_offset INTEGER CHECK (valid_from_offset IS NULL OR valid_from_offset >= 0),
    valid_to_chapter INTEGER CHECK (valid_to_chapter IS NULL OR valid_to_chapter >= valid_from_chapter),
    valid_to_segment INTEGER CHECK (valid_to_segment IS NULL OR valid_to_segment >= 1),
    valid_to_offset INTEGER CHECK (valid_to_offset IS NULL OR valid_to_offset >= 0),
    evidence_id TEXT NOT NULL REFERENCES narrative_evidence(evidence_id) ON DELETE CASCADE,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    status TEXT NOT NULL CHECK (status IN ('hypothesis', 'confirmed', 'locked', 'conflict')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX narrative_context_frame_position ON narrative_context_frames(project_id, valid_from_chapter, valid_from_segment, valid_to_chapter, valid_to_segment);

  CREATE TABLE narrative_entities (
    entity_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    canonical_source TEXT NOT NULL,
    canonical_translation TEXT NOT NULL,
    entity_kind TEXT NOT NULL CHECK (entity_kind IN ('character', 'animal', 'place', 'organization', 'item', 'ability', 'concept', 'other')),
    gender TEXT NOT NULL CHECK (gender IN ('unknown', 'male', 'female', 'nonbinary', 'not-applicable')),
    grammatical_number TEXT NOT NULL CHECK (grammatical_number IN ('unknown', 'singular', 'plural', 'collective', 'not-applicable')),
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    status TEXT NOT NULL CHECK (status IN ('candidate', 'confirmed', 'locked', 'conflict')),
    first_seen_chapter INTEGER NOT NULL CHECK (first_seen_chapter >= 1),
    last_seen_chapter INTEGER NOT NULL CHECK (last_seen_chapter >= first_seen_chapter),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, canonical_source)
  ) STRICT;
  CREATE INDEX narrative_entities_project_kind ON narrative_entities(project_id, entity_kind, status);

  CREATE TABLE narrative_aliases (
    alias_id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL REFERENCES narrative_entities(entity_id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    source_form TEXT NOT NULL,
    translated_form TEXT NOT NULL,
    alias_kind TEXT NOT NULL CHECK (alias_kind IN ('canonical', 'family-name', 'given-name', 'title', 'nickname', 'codename', 'old-name', 'misnomer', 'other')),
    valid_from_chapter INTEGER NOT NULL CHECK (valid_from_chapter >= 1),
    valid_from_segment INTEGER CHECK (valid_from_segment IS NULL OR valid_from_segment >= 1),
    valid_from_offset INTEGER CHECK (valid_from_offset IS NULL OR valid_from_offset >= 0),
    valid_to_chapter INTEGER CHECK (valid_to_chapter IS NULL OR valid_to_chapter >= valid_from_chapter),
    valid_to_segment INTEGER CHECK (valid_to_segment IS NULL OR valid_to_segment >= 1),
    valid_to_offset INTEGER CHECK (valid_to_offset IS NULL OR valid_to_offset >= 0),
    reader_visible_from_chapter INTEGER NOT NULL CHECK (reader_visible_from_chapter >= 1),
    reader_visible_from_segment INTEGER CHECK (reader_visible_from_segment IS NULL OR reader_visible_from_segment >= 1),
    reader_visible_from_offset INTEGER CHECK (reader_visible_from_offset IS NULL OR reader_visible_from_offset >= 0),
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    status TEXT NOT NULL CHECK (status IN ('hypothesis', 'confirmed', 'locked', 'conflict')),
    evidence_id TEXT REFERENCES narrative_evidence(evidence_id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    UNIQUE(project_id, entity_id, source_form, alias_kind, valid_from_chapter)
  ) STRICT;
  CREATE INDEX narrative_alias_lookup ON narrative_aliases(project_id, source_form, valid_from_chapter, valid_to_chapter);

  CREATE TABLE narrative_mentions (
    mention_id TEXT PRIMARY KEY,
    entity_id TEXT REFERENCES narrative_entities(entity_id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    chapter_id TEXT NOT NULL,
    chapter_ordinal INTEGER NOT NULL CHECK (chapter_ordinal >= 1),
    segment_ordinal INTEGER CHECK (segment_ordinal IS NULL OR segment_ordinal >= 1),
    source_start_offset INTEGER CHECK (source_start_offset IS NULL OR source_start_offset >= 0),
    source_end_offset INTEGER CHECK (source_end_offset IS NULL OR source_end_offset >= source_start_offset),
    source_form TEXT NOT NULL,
    semantic_role TEXT NOT NULL CHECK (semantic_role IN ('speaker', 'agent', 'patient', 'recipient', 'experiencer', 'referent', 'unknown')),
    evidence_id TEXT NOT NULL REFERENCES narrative_evidence(evidence_id) ON DELETE CASCADE,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX narrative_mentions_entity_position ON narrative_mentions(project_id, entity_id, chapter_ordinal, segment_ordinal);

  CREATE TABLE narrative_claims (
    claim_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    claim_kind TEXT NOT NULL CHECK (claim_kind IN ('identity', 'character-state', 'relationship', 'address', 'voice', 'viewpoint', 'setting', 'secret', 'foreshadowing', 'wordplay', 'number', 'age', 'appearance', 'affiliation')),
    predicate TEXT NOT NULL,
    subject_entity_id TEXT REFERENCES narrative_entities(entity_id) ON DELETE SET NULL,
    object_entity_id TEXT REFERENCES narrative_entities(entity_id) ON DELETE SET NULL,
    subject_key TEXT,
    object_key TEXT,
    worldline_key TEXT NOT NULL,
    scene_key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    valid_from_chapter INTEGER NOT NULL CHECK (valid_from_chapter >= 1),
    valid_from_segment INTEGER CHECK (valid_from_segment IS NULL OR valid_from_segment >= 1),
    valid_from_offset INTEGER CHECK (valid_from_offset IS NULL OR valid_from_offset >= 0),
    valid_to_chapter INTEGER CHECK (valid_to_chapter IS NULL OR valid_to_chapter >= valid_from_chapter),
    valid_to_segment INTEGER CHECK (valid_to_segment IS NULL OR valid_to_segment >= 1),
    valid_to_offset INTEGER CHECK (valid_to_offset IS NULL OR valid_to_offset >= 0),
    reader_visible_from_chapter INTEGER NOT NULL CHECK (reader_visible_from_chapter >= 1),
    reader_visible_from_segment INTEGER CHECK (reader_visible_from_segment IS NULL OR reader_visible_from_segment >= 1),
    reader_visible_from_offset INTEGER CHECK (reader_visible_from_offset IS NULL OR reader_visible_from_offset >= 0),
    memory_class TEXT NOT NULL CHECK (memory_class IN ('canon', 'character', 'relationship', 'event', 'state', 'episode-detail')),
    importance REAL NOT NULL CHECK (importance >= 0 AND importance <= 1),
    retrieval_scope TEXT NOT NULL CHECK (retrieval_scope IN ('series', 'volume', 'chapter', 'scene')),
    character_knowledge_json TEXT NOT NULL,
    statement TEXT NOT NULL,
    evidence_id TEXT NOT NULL REFERENCES narrative_evidence(evidence_id) ON DELETE CASCADE,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    status TEXT NOT NULL CHECK (status IN ('hypothesis', 'confirmed', 'locked', 'superseded', 'conflict')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX narrative_claims_retrieval ON narrative_claims(project_id, subject_entity_id, object_entity_id, valid_from_chapter, reader_visible_from_chapter, status);

  CREATE TABLE narrative_events (
    event_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    predicate TEXT NOT NULL,
    agent_entity_id TEXT REFERENCES narrative_entities(entity_id) ON DELETE SET NULL,
    patient_entity_id TEXT REFERENCES narrative_entities(entity_id) ON DELETE SET NULL,
    recipient_entity_id TEXT REFERENCES narrative_entities(entity_id) ON DELETE SET NULL,
    agent_key TEXT,
    patient_key TEXT,
    recipient_key TEXT,
    worldline_key TEXT NOT NULL,
    scene_key TEXT NOT NULL,
    statement TEXT NOT NULL,
    direction_status TEXT NOT NULL CHECK (direction_status IN ('verified', 'ambiguous', 'unresolved')),
    valid_from_chapter INTEGER NOT NULL CHECK (valid_from_chapter >= 1),
    valid_from_segment INTEGER CHECK (valid_from_segment IS NULL OR valid_from_segment >= 1),
    valid_from_offset INTEGER CHECK (valid_from_offset IS NULL OR valid_from_offset >= 0),
    valid_to_chapter INTEGER CHECK (valid_to_chapter IS NULL OR valid_to_chapter >= valid_from_chapter),
    valid_to_segment INTEGER CHECK (valid_to_segment IS NULL OR valid_to_segment >= 1),
    valid_to_offset INTEGER CHECK (valid_to_offset IS NULL OR valid_to_offset >= 0),
    reader_visible_from_chapter INTEGER NOT NULL CHECK (reader_visible_from_chapter >= 1),
    reader_visible_from_segment INTEGER CHECK (reader_visible_from_segment IS NULL OR reader_visible_from_segment >= 1),
    reader_visible_from_offset INTEGER CHECK (reader_visible_from_offset IS NULL OR reader_visible_from_offset >= 0),
    memory_class TEXT NOT NULL CHECK (memory_class IN ('canon', 'character', 'relationship', 'event', 'state', 'episode-detail')),
    importance REAL NOT NULL CHECK (importance >= 0 AND importance <= 1),
    retrieval_scope TEXT NOT NULL CHECK (retrieval_scope IN ('series', 'volume', 'chapter', 'scene')),
    character_knowledge_json TEXT NOT NULL,
    evidence_id TEXT NOT NULL REFERENCES narrative_evidence(evidence_id) ON DELETE CASCADE,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    status TEXT NOT NULL CHECK (status IN ('hypothesis', 'confirmed', 'locked', 'superseded', 'conflict')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX narrative_events_roles ON narrative_events(project_id, agent_entity_id, patient_entity_id, recipient_entity_id, valid_from_chapter, status);

  CREATE TABLE character_knowledge (
    knowledge_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    character_entity_id TEXT NOT NULL REFERENCES narrative_entities(entity_id) ON DELETE CASCADE,
    claim_id TEXT REFERENCES narrative_claims(claim_id) ON DELETE CASCADE,
    event_id TEXT REFERENCES narrative_events(event_id) ON DELETE CASCADE,
    epistemic_state TEXT NOT NULL CHECK (epistemic_state IN ('knows', 'believes', 'suspects', 'denies')),
    known_from_chapter INTEGER NOT NULL CHECK (known_from_chapter >= 1),
    known_from_segment INTEGER CHECK (known_from_segment IS NULL OR known_from_segment >= 1),
    known_from_offset INTEGER CHECK (known_from_offset IS NULL OR known_from_offset >= 0),
    known_to_chapter INTEGER CHECK (known_to_chapter IS NULL OR known_to_chapter >= known_from_chapter),
    known_to_segment INTEGER CHECK (known_to_segment IS NULL OR known_to_segment >= 1),
    known_to_offset INTEGER CHECK (known_to_offset IS NULL OR known_to_offset >= 0),
    evidence_id TEXT NOT NULL REFERENCES narrative_evidence(evidence_id) ON DELETE CASCADE,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    created_at TEXT NOT NULL,
    CHECK ((claim_id IS NULL) <> (event_id IS NULL))
  ) STRICT;
  CREATE INDEX character_knowledge_retrieval ON character_knowledge(project_id, character_entity_id, known_from_chapter);

  CREATE TABLE world_state_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    entity_id TEXT NOT NULL REFERENCES narrative_entities(entity_id) ON DELETE CASCADE,
    predicate TEXT NOT NULL,
    worldline_key TEXT NOT NULL,
    scene_key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    valid_from_chapter INTEGER NOT NULL CHECK (valid_from_chapter >= 1),
    valid_from_segment INTEGER CHECK (valid_from_segment IS NULL OR valid_from_segment >= 1),
    valid_from_offset INTEGER CHECK (valid_from_offset IS NULL OR valid_from_offset >= 0),
    valid_to_chapter INTEGER CHECK (valid_to_chapter IS NULL OR valid_to_chapter >= valid_from_chapter),
    valid_to_segment INTEGER CHECK (valid_to_segment IS NULL OR valid_to_segment >= 1),
    valid_to_offset INTEGER CHECK (valid_to_offset IS NULL OR valid_to_offset >= 0),
    source_claim_id TEXT NOT NULL REFERENCES narrative_claims(claim_id) ON DELETE CASCADE,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    status TEXT NOT NULL CHECK (status IN ('active', 'historical', 'conflict')),
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX world_state_at_time ON world_state_snapshots(project_id, entity_id, predicate, valid_from_chapter, valid_to_chapter);

  CREATE TABLE claim_conflicts (
    conflict_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    left_claim_id TEXT NOT NULL REFERENCES narrative_claims(claim_id) ON DELETE CASCADE,
    right_claim_id TEXT NOT NULL REFERENCES narrative_claims(claim_id) ON DELETE CASCADE,
    conflict_kind TEXT NOT NULL CHECK (conflict_kind IN ('value', 'identity', 'direction', 'time', 'knowledge-boundary')),
    status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'dismissed')),
    explanation TEXT NOT NULL,
    resolution_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    UNIQUE(project_id, left_claim_id, right_claim_id, conflict_kind)
  ) STRICT;
  CREATE INDEX claim_conflicts_queue ON claim_conflicts(project_id, status, created_at);

  CREATE TABLE translation_dependencies (
    dependency_id TEXT PRIMARY KEY,
    translation_version_id TEXT NOT NULL REFERENCES translation_versions(version_id) ON DELETE CASCADE,
    segment_id TEXT NOT NULL REFERENCES translation_segments(segment_id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    entity_ids_json TEXT NOT NULL,
    claim_ids_json TEXT NOT NULL,
    event_ids_json TEXT NOT NULL,
    evidence_ids_json TEXT NOT NULL,
    frame_ids_json TEXT NOT NULL,
    memory_ids_json TEXT NOT NULL,
    style_ids_json TEXT NOT NULL,
    ambiguity_ids_json TEXT NOT NULL,
    syntax_evidence_json TEXT NOT NULL,
    series_context_json TEXT NOT NULL,
    direction_constraints_json TEXT NOT NULL,
    context_position_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(translation_version_id)
  ) STRICT;
  CREATE INDEX translation_dependencies_segment ON translation_dependencies(project_id, segment_id, created_at);
`;
