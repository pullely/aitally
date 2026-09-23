# tally-worker — overview

Owns the `tally` bounded context. In AT1 that is the **AI tool register**: the
AI systems a company uses (name, vendor, category, purpose, the data categories
that reach each one, its risk level on the EU AI Act's tiers, its status and its
accountable owner) and the **dated reviews** of each tool. AT2 adds the staff
AI-training record and AT3 the evidence packs.

The invariants this worker holds:

- nothing in the register is deleted — a tool leaves use by being retired and
  stays as evidence (there is no `DELETE` route);
- a `prohibited` risk level is only ever held by a `blocked` or `retired` tool
  (checked on the merged patch here, and by a `CHECK` in the schema);
- a review is its own dated row; the tool's `next_review_on` is the latest
  review's date plus the interval, and a back-dated review never rolls it back;
- `reviewDue` is derived from `next_review_on` on every read, never stored.

## What it serves

| Route | Who |
|---|---|
| `GET/POST /v1/organizations/{org}/ai-tools` | `tally.read` / `tally.write` |
| `GET/PATCH /v1/organizations/{org}/ai-tools/{ait}` | `tally.read` / `tally.write` |
| `POST /v1/organizations/{org}/ai-tools/{ait}/reviews` | `tally.write` |
