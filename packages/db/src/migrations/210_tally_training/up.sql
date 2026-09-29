-- 210_tally_training
-- Staff AI-literacy training (AT2): courses, their immutable material versions
-- (the bytes live in R2; the row keeps the SHA-256), the named users of each
-- tool, one assignment per (course, person, cycle), every quiz attempt, and
-- the reminder ladder's claims.
-- Bounded context: tally
-- A completion (time, score, the material hash taken) is written once and
-- never edited; a correction is a new assignment. Nothing here is deleted
-- except a tool's list of named users, which is current state, not evidence.

CREATE TABLE IF NOT EXISTS tally_courses (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL,
  title              TEXT NOT NULL,
  summary            TEXT NOT NULL DEFAULT '',
  tool_id            TEXT REFERENCES tally_tools (id),
  due_days           INTEGER NOT NULL DEFAULT 30 CHECK (due_days BETWEEN 1 AND 365),
  recurrence_months  INTEGER NOT NULL DEFAULT 12 CHECK (recurrence_months BETWEEN 0 AND 36),
  pass_mark_pct      INTEGER CHECK (pass_mark_pct IS NULL OR pass_mark_pct BETWEEN 1 AND 100),
  quiz_json          TEXT,
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_by         TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((pass_mark_pct IS NULL) = (quiz_json IS NULL))
);

-- table tally_courses: One piece of AI-literacy training a company assigns. tool_id null = for everyone.
-- column tally_courses.recurrence_months: 0 = once; otherwise the next cycle is assigned this long after a completion.
-- column tally_courses.quiz_json: JSON array of {prompt, options[], correct}; null = no quiz (completion is a confirmation).

CREATE INDEX IF NOT EXISTS idx_tally_courses_org ON tally_courses (org_id, status, title);

CREATE TABLE IF NOT EXISTS tally_course_materials (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,
  course_id     TEXT NOT NULL REFERENCES tally_courses (id),
  version       INTEGER NOT NULL CHECK (version >= 1),
  object_key    TEXT NOT NULL UNIQUE,
  filename      TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  byte_size     INTEGER NOT NULL CHECK (byte_size > 0),
  sha256        TEXT NOT NULL CHECK (length(sha256) = 64),
  uploaded_by   TEXT,
  uploaded_at   TEXT NOT NULL,
  UNIQUE (course_id, version)
);

-- table tally_course_materials: Immutable versions of a course's material in R2 (TALLY_CONTENT). The newest version is current.

CREATE TABLE IF NOT EXISTS tally_tool_users (
  org_id     TEXT NOT NULL,
  tool_id    TEXT NOT NULL REFERENCES tally_tools (id),
  email      TEXT NOT NULL,
  added_at   TEXT NOT NULL,
  PRIMARY KEY (tool_id, email)
);

-- table tally_tool_users: The named staff who use one AI tool: who a "users of this tool" assignment reaches.

CREATE TABLE IF NOT EXISTS tally_assignments (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL,
  course_id        TEXT NOT NULL REFERENCES tally_courses (id),
  assignee_email   TEXT NOT NULL,
  cycle            INTEGER NOT NULL DEFAULT 1 CHECK (cycle >= 1),
  assigned_on      TEXT NOT NULL,
  due_on           TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','excused')),
  completed_at     TEXT,
  score_pct        INTEGER CHECK (score_pct IS NULL OR score_pct BETWEEN 0 AND 100),
  material_id      TEXT REFERENCES tally_course_materials (id),
  material_sha256  TEXT,
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  assigned_by      TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (course_id, assignee_email, cycle),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CHECK (status <> 'completed' OR material_sha256 IS NOT NULL)
);

-- table tally_assignments: One person's duty to take one course in one cycle. Completion fields are written once.
-- column tally_assignments.material_sha256: The SHA-256 of the material version the assignee completed.

CREATE INDEX IF NOT EXISTS idx_tally_assignments_org ON tally_assignments (org_id, status, due_on);
CREATE INDEX IF NOT EXISTS idx_tally_assignments_email ON tally_assignments (assignee_email, status);
CREATE INDEX IF NOT EXISTS idx_tally_assignments_due ON tally_assignments (status, due_on);

CREATE TABLE IF NOT EXISTS tally_quiz_attempts (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL,
  assignment_id    TEXT NOT NULL REFERENCES tally_assignments (id),
  answers_json     TEXT NOT NULL,
  score_pct        INTEGER NOT NULL CHECK (score_pct BETWEEN 0 AND 100),
  passed           INTEGER NOT NULL CHECK (passed IN (0, 1)),
  material_sha256  TEXT,
  attempted_at     TEXT NOT NULL
);

-- table tally_quiz_attempts: Every quiz attempt, passed or not. Append-only.

CREATE INDEX IF NOT EXISTS idx_tally_quiz_attempts_assignment ON tally_quiz_attempts (assignment_id, attempted_at);

CREATE TABLE IF NOT EXISTS tally_reminders (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  assignment_id   TEXT NOT NULL REFERENCES tally_assignments (id),
  rung            TEXT NOT NULL CHECK (rung IN ('d7','d1','d0','late3','late7','late14')),
  due_on          TEXT NOT NULL,
  recipients      TEXT NOT NULL,
  sent_at         TEXT NOT NULL,
  UNIQUE (assignment_id, rung, due_on)
);

-- table tally_reminders: One row per reminder rung sent. The UNIQUE key is the claim: a rung goes out once per due date.
