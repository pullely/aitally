-- 220_tally_evidence
-- Evidence packs (AT3): an immutable, hashed export of the register, its
-- reviews and the training record, stored in R2 (TALLY_CONTENT) under
-- orgs/{org}/packs/{pack}/{file}. A pack is written once and never
-- regenerated in place: a new request is a new pack with its own keys.
-- Bounded context: tally

CREATE TABLE IF NOT EXISTS tally_evidence_packs (
  id                  TEXT PRIMARY KEY,
  org_id              TEXT NOT NULL,
  scope               TEXT NOT NULL CHECK (scope IN ('org','employee','tool')),
  subject             TEXT,
  as_of               TEXT NOT NULL,
  files_json          TEXT NOT NULL,
  manifest_sha256     TEXT NOT NULL CHECK (length(manifest_sha256) = 64),
  requested_by        TEXT,
  requested_by_email  TEXT,
  created_at          TEXT NOT NULL,
  CHECK ((scope = 'org') = (subject IS NULL))
);

-- table tally_evidence_packs: One evidence pack. Immutable: no code path updates or deletes a row, and its R2 objects are put only if absent.
-- column tally_evidence_packs.files_json: JSON array of {name, contentType, byteSize, sha256}; manifest.json last.
-- column tally_evidence_packs.subject: The employee's email (scope employee), the tool's UUID (scope tool), null for the org.

CREATE INDEX IF NOT EXISTS idx_tally_evidence_packs_org ON tally_evidence_packs (org_id, created_at DESC);
