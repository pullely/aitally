-- 200_tally_register
-- AI tool register — the AI systems a company uses, what for, with which data,
-- at which risk level, who answers for each, and every dated review of them
-- Bounded context: tally
-- schema tally: Aitally bounded context — owns the AI tool register and its
-- review history (AT1), the training record (AT2) and the evidence packs (AT3).
-- Nothing in the register is deleted: a tool leaves use by being retired, and
-- stays as evidence. reviewDue is derived from next_review_on; it is never stored.

CREATE TABLE IF NOT EXISTS tally_tools (
  id                      TEXT PRIMARY KEY,
  org_id                  TEXT NOT NULL,
  name                    TEXT NOT NULL,
  vendor                  TEXT NOT NULL DEFAULT '',
  website_url             TEXT,
  category                TEXT NOT NULL DEFAULT 'other'
                          CHECK (category IN ('general_assistant','coding_assistant','writing_assistant',
                                              'meeting_assistant','image_media','analytics','embedded_feature',
                                              'custom_model','other')),
  purpose                 TEXT NOT NULL,
  data_categories         TEXT NOT NULL DEFAULT '',
  risk_level              TEXT NOT NULL DEFAULT 'unassessed'
                          CHECK (risk_level IN ('unassessed','minimal','limited','high','prohibited')),
  act_role                TEXT NOT NULL DEFAULT 'deployer' CHECK (act_role IN ('deployer','provider')),
  status                  TEXT NOT NULL DEFAULT 'proposed'
                          CHECK (status IN ('proposed','approved','restricted','blocked','retired')),
  owner_email             TEXT NOT NULL,
  users_description       TEXT NOT NULL DEFAULT '',
  review_interval_months  INTEGER NOT NULL DEFAULT 12 CHECK (review_interval_months BETWEEN 1 AND 24),
  last_reviewed_on        TEXT,
  next_review_on          TEXT NOT NULL,
  notes                   TEXT NOT NULL DEFAULT '',
  created_by              TEXT,
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (risk_level <> 'prohibited' OR status IN ('blocked','retired'))
);

-- table tally_tools: One AI system a company uses or is considering. Every query must scope by org_id. Never deleted; retired instead.
-- column tally_tools.data_categories: Sorted comma list of the data kinds that reach the tool ('' = none recorded).
-- column tally_tools.risk_level: The company's own classification, on the EU AI Act's tiers plus 'unassessed'. 'prohibited' only on a blocked or retired tool.
-- column tally_tools.owner_email: The accountable owner. Reviews, and from AT2 training escalations, go here.
-- column tally_tools.next_review_on: YYYY-MM-DD. Created date + interval, then the last review + interval.

CREATE INDEX IF NOT EXISTS idx_tally_tools_org_status ON tally_tools (org_id, status, name);
CREATE INDEX IF NOT EXISTS idx_tally_tools_org_review ON tally_tools (org_id, next_review_on);

CREATE TABLE IF NOT EXISTS tally_tool_reviews (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  tool_id         TEXT NOT NULL REFERENCES tally_tools (id) ON DELETE CASCADE,
  reviewed_on     TEXT NOT NULL,
  decision        TEXT NOT NULL CHECK (decision IN ('approved','restricted','blocked','retired')),
  risk_level      TEXT NOT NULL
                  CHECK (risk_level IN ('unassessed','minimal','limited','high','prohibited')),
  reviewer_email  TEXT,
  notes           TEXT NOT NULL DEFAULT '',
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (risk_level <> 'prohibited' OR decision IN ('blocked','retired'))
);

-- table tally_tool_reviews: A dated decision about one AI tool. Append-only: the register's history is these rows.
-- column tally_tool_reviews.reviewed_on: YYYY-MM-DD the review was made; never after the day it was recorded.
-- column tally_tool_reviews.reviewer_email: The signed-in reviewer's email as api-edge resolved it.

CREATE INDEX IF NOT EXISTS idx_tally_tool_reviews_tool ON tally_tool_reviews (tool_id, reviewed_on DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tally_tool_reviews_org ON tally_tool_reviews (org_id, reviewed_on DESC);
