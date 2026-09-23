# aitally-ai-literacy-evidence — design

This epic adds one bounded context, `tally`, owned by one new worker,
`apps/tally-worker`, behind the baseline's api-edge. Everything else is the
cirrus baseline reused. An organization is a company and its members are its
staff. The policy engine decides who may edit, the notifications worker sends
email, and the events worker holds the audit trail.

## 0. The obligation this answers

Aitally records evidence. It does not give legal advice, and it does not decide
whether a company complies. This section quotes the texts the product is built
around, so the design can be checked against them.

### 0.1 EU AI Act, Article 4 (AI literacy)

Regulation (EU) 2024/1689 of 13 June 2024, as published in the Official Journal
(OJ L, 2024/1689, 12.7.2024). The text below was read from the Publications
Office copy of the OJ act:

> **Article 4 — AI literacy.** Providers and deployers of AI systems shall take
> measures to ensure, to their best extent, a sufficient level of AI literacy of
> their staff and other persons dealing with the operation and use of AI systems
> on their behalf, taking into account their technical knowledge, experience,
> education and training and the context the AI systems are to be used in, and
> considering the persons or groups of persons on whom the AI systems are to be
> used.

> **Article 3(56).** 'AI literacy' means skills, knowledge and understanding
> that allow providers, deployers and affected persons, taking into account their
> respective rights and obligations in the context of this Regulation, to make an
> informed deployment of AI systems, as well as to gain awareness about the
> opportunities and risks of AI and possible harm it can cause;

> **Article 3(4).** 'deployer' means a natural or legal person, public
> authority, agency or other body using an AI system under its authority except
> where the AI system is used in the course of a personal non-professional
> activity;

**Application.** Article 113(a) says that Chapters I and II apply from
2 February 2025. Article 4 is in Chapter I. The rest of the Regulation applies
from 2 August 2026 (Article 113, second paragraph), apart from the exceptions
in Article 113(b) and (c). Recital 20 describes what AI literacy should cover:
the measures to apply during use, and suitable ways to interpret an AI system's
output.

**The amendment the brief mentions.** The brief says Article 4 was "softened in
June 2026". The AI Act Explorer (artificialintelligenceact.eu, read
2026-09-23) shows Article 4 as amended. Paragraph 1 now says providers and
deployers "shall take measures to support the development of AI literacy" of
the same people, and it adds: "This obligation does not require providers or
deployers to guarantee any specific level of AI literacy of any individual". A
new paragraph 2 asks the Commission and the Member States to support providers
and deployers, "in particular SMEs", and a new paragraph 3 asks the Board to
adopt recommendations. This design has not seen the amending act in the
Official Journal, so the amending regulation's number and date are an open
question (AT-A).

**What follows for the product.** Under both wordings, the duty is to take
*measures* on the literacy of the staff who use AI systems, taking into account
their background and the context each system is used in. Aitally records those
measures:

- **The context** is the register (AT1): which systems are used, for what, with
  which data, and who answers for each one.
- **The measures** are the training record (AT2): who was assigned which
  material, tied to the tools they use, when it was due, when they completed it,
  the version of the material, and how they scored.
- **The proof** is the evidence pack (AT3): an immutable, hashed export of both.

Aitally never states that a company is "compliant". The console words every
result as a record: "12 of 14 assigned staff completed", never "compliant".

### 0.2 Colorado AI Act (out of scope here, AT4 later)

The brief cites Colorado's AI Act, "effective 30 June 2026, currently under
legal challenge", and its impact assessments for high-risk uses. That module
(the brief's M4) needs an LLM drafting step that this workspace has no
credential for (AT-B). Its statutory citations are to be checked against the
Colorado General Assembly's text when that milestone is planned (AT-E). Nothing
in AT1–AT3 depends on it.

## 1. The resource

Ids are UUIDs in D1 and prefixed public ids on the wire: `ait_`, `atr_`, and so
on, followed by the UUID's 32 hex digits, exactly like the baseline's `org_` and
`prj_`. Every row carries `org_id`, and every query is scoped by it. Timestamps
are ISO-8601 `TEXT`. Dates (`next_review_on`, `due_on`) are `YYYY-MM-DD`
`TEXT`, so comparing two of them as strings compares them as dates.

### 1.1 `tally_tools` (AT1): `ait_`

One AI system the company uses or is considering.

```
tally_tools
  id                      text  pk
  org_id                  text  the company
  name                    text  "ChatGPT Team"
  vendor                  text  '' — "OpenAI"
  website_url             text  null — https only
  category                text  general_assistant | coding_assistant | writing_assistant | meeting_assistant
                                | image_media | analytics | embedded_feature | custom_model | other
  purpose                 text  what the company uses it for, as written ("drafting customer emails")
  data_categories         text  sorted comma list of: public, internal, confidential, customer_personal,
                                employee_personal, special_category, source_code, financial ('' = none recorded)
  risk_level              text  unassessed | minimal | limited | high | prohibited
  act_role                text  deployer | provider — Art. 3(4)/(3); almost every customer is a deployer
  status                  text  proposed | approved | restricted | blocked | retired
  owner_email             text  the accountable owner; reviews and (AT2) escalations go here
  users_description       text  '' — who uses it ("Sales, about 12 people")
  review_interval_months  int   12 by default, 1..24
  last_reviewed_on        text  null until the first review
  next_review_on          text  YYYY-MM-DD — created date + interval, then last review + interval
  notes                   text  ''
  created_by, created_at, updated_at
  CHECK (risk_level <> 'prohibited' OR status IN ('blocked','retired'))
```

The wire derives `reviewDue` as `next_review_on <= today (UTC)` and never
stores it. The risk levels follow the Act's tiers (Article 5 prohibited
practices, Article 6 high-risk classification, Article 50 transparency, and
everything else), plus `unassessed`. The company chooses the level, and Aitally
records it. Classifying a system is the company's call (AT-D).

### 1.2 `tally_tool_reviews` (AT1): `atr_`

A dated decision about a tool. The register's history is the list of these
rows. They are append-only.

```
tally_tool_reviews
  id             text  pk
  org_id         text
  tool_id        text  → tally_tools (cascade)
  reviewed_on    text  YYYY-MM-DD, not in the future
  decision       text  approved | restricted | blocked | retired
  risk_level     text  the level the reviewer set (same set as the tool)
  reviewer_email text  the signed-in reviewer's email, as api-edge resolved it
  notes          text  ''
  created_by     text  null — the member's UUID
  created_at     text
  CHECK (risk_level <> 'prohibited' OR decision IN ('blocked','retired'))
```

Recording a review writes the review row (`INSERT … RETURNING`) and then sets
the tool's `status = decision`, `risk_level`, `last_reviewed_on` and
`next_review_on = reviewed_on + review_interval_months` (`UPDATE … RETURNING`).
D1 has no interactive transactions. If the second write fails, the review is
already recorded and repeating the request applies it again. A later review is
never overwritten by an earlier one, because the tool update only applies when
`reviewed_on >= last_reviewed_on`.

### 1.3 Training (AT2): `atc_`, `atm_`, `ata_`, `atq_`

```
tally_courses            atc_  title, summary, tool_id null (training for users of one tool) | null = everyone,
                               due_days (30), recurrence_months (12, 0 = once), pass_mark_pct (80, null = no quiz),
                               quiz_json (questions: prompt, options[], correct index), status draft|published|archived
tally_course_materials   atm_  course_id, object_key in TALLY_CONTENT, filename, content_type, byte_size, sha256,
                               version (1..n) — immutable; the newest is current
tally_assignments        ata_  course_id, assignee_email, cycle (1..n), assigned_on, due_on, status open|completed|excused,
                               completed_at, score_pct, material_sha256 (what they actually took), attempt_count
                               UNIQUE (course_id, assignee_email, cycle); completed_at set iff status = 'completed'
tally_quiz_attempts      atq_  assignment_id, answers_json, score_pct, passed, attempted_at — append-only
tally_reminders                assignment_id, rung d7|d1|d0|late3|late7|late14, due_on, recipients, sent_at
                               UNIQUE (assignment_id, rung, due_on)
```

Course material goes to one private R2 bucket per environment. It is declared
as `aitally-training-content-{stage,prod}` and bound under the name Orun gives
the bucket, `stg-aitally-training-content-stage` and
`prod-aitally-training-content-prod`, because Orun adds an environment prefix to
the name. It is created by `infra/terraform/cloudflare-r2` under a brokered
`CLOUDFLARE_R2_TOKEN` (`r2-data`, with `buckets` named) and bound to
`tally-worker` as `TALLY_CONTENT`.

An assignment is completed when the assignee opens the current material and
either confirms it (a course with no quiz) or passes the quiz. The completion
stores the SHA-256 of the material version they took, so the record proves
*what* they were trained on, not only that they clicked.

### 1.4 Evidence packs (AT3): `atx_`

```
tally_evidence_packs     atx_  scope org|employee|tool, subject (email or ait_ id, null for org), as_of,
                               files_json [{name, object_key, content_type, byte_size, sha256}], manifest_sha256,
                               requested_by, created_at — immutable, never regenerated in place
```

## 2. The API

Envelopes are the baseline's: `{ data, meta: { requestId, cursor } }` and
`{ error: { code, message, details, requestId } }`. Every route is under the
org lane and is authenticated at api-edge (`resolveActor`), which forwards the
actor as headers over the service binding. Authorization is the baseline pair:
membership authorization-context, then policy authorize. A denial is **404,
never 403**, so a non-member cannot probe for a tool.

| Action | owner | admin | builder | viewer |
|---|---|---|---|---|
| `tally.read` | ✓ | ✓ | ✓ | ✓ |
| `tally.write` | ✓ | ✓ | ✓ | |

A viewer can read the register. From AT2, a viewer can also complete
assignments addressed to their own email, which the worker checks against the
actor email api-edge resolved.

### 2.1 The register (AT1)

```
GET    /v1/organizations/{org}/ai-tools?status=&riskLevel=
         → { tools: PublicAiTool[], summary: { total, byRiskLevel, byStatus, reviewsDue, withPersonalData } }
POST   /v1/organizations/{org}/ai-tools                 → 201 { tool, ownerNotified }
GET    /v1/organizations/{org}/ai-tools/{ait}           → { tool, reviews: PublicAiToolReview[] }   newest first
PATCH  /v1/organizations/{org}/ai-tools/{ait}           → { tool, ownerNotified }
POST   /v1/organizations/{org}/ai-tools/{ait}/reviews   → 201 { review, tool }
```

There is no `DELETE`. A tool leaves use by being retired (decision 2). When a
field fails validation the answer is 422 `validation_failed` with
`details.fields`:

- `name` (at most 120 characters), `purpose` (at most 2000) and `ownerEmail`
  are required on create.
- `category`, `riskLevel`, `actRole` and `status` must come from their sets.
- `dataCategories` is an array of known values without duplicates.
- `websiteUrl` must be `https://`.
- `reviewIntervalMonths` is an integer from 1 to 24.
- A `prohibited` risk level on a tool that is not `blocked` or `retired` is
  refused as `riskLevel`.
- A review's `reviewedOn` is a real date and is not after today.

Creating a tool, or changing its owner, emails the owner once
(`tally.tool.owner_assigned`), with idempotency key = tool + owner.

### 2.2 Training (AT2)

```
GET/POST /v1/organizations/{org}/training/courses                          tally.read / tally.write
GET/PATCH /v1/organizations/{org}/training/courses/{atc}
POST     /v1/organizations/{org}/training/courses/{atc}/materials          raw body (PDF, MP4, PNG, JPEG, DOCX; ≤ 50 MB)
GET      /v1/organizations/{org}/training/courses/{atc}/materials/{atm}    bytes + x-content-sha256
POST     /v1/organizations/{org}/training/courses/{atc}/assign             { emails[] } | { everyone: true } | { toolUsers: true }
GET      /v1/organizations/{org}/training/assignments?status=&email=
POST     /v1/organizations/{org}/training/assignments/{ata}/complete       assignee only; { answers[] } when there is a quiz
GET      /v1/me/training                                                   the caller's assignments across their orgs
```

`scheduled()` runs on `tally-worker` daily at `0 7 * * *` UTC, which is the
morning of the working day across the EU. For each open assignment whose next
rung is due, it claims the rung with
`INSERT … ON CONFLICT DO NOTHING RETURNING id` and sends only when a row comes
back. The ladder:

- 7, 1 and 0 days before `due_on`, to the assignee.
- 3 and 7 days late, to the assignee plus the owner of the course's tool.
- 14 days late, to the assignee plus the org's owners.

The same tick creates the next cycle's assignment when a completion is
`recurrence_months` old, which is the annual re-training.

### 2.3 Evidence (AT3)

```
GET  /v1/organizations/{org}/evidence/employees/{email}?format=json|csv
GET  /v1/organizations/{org}/evidence/tools/{ait}?format=json|csv
POST /v1/organizations/{org}/evidence-packs            { scope: "org" | "employee" | "tool", subject? } → 201 { pack }
GET  /v1/organizations/{org}/evidence-packs            → { packs }
GET  /v1/organizations/{org}/evidence-packs/{atx}/files/{name}   bytes + x-content-sha256
```

An org pack holds:

- `register.csv`: every tool, retired ones included.
- `reviews.csv`: every review.
- `training-records.csv`: one row per assignment, with the completion time,
  the score and the material SHA-256.
- `summary.pdf`: a one-page summary, with counts and dates only.
- `manifest.json`: every file's SHA-256 and the `as_of` timestamp.

## 3. The console

- **AI register** (`/orgs/{org}/ai-tools`, AT1) has four parts:
  - summary tiles: tools in use, high-risk, reviews due, and tools that touch
    personal data
  - the table of tools, with owner, risk, status and next review
  - the "Register a tool" form
  - a filter by status
- **Tool** (`/orgs/{org}/ai-tools/{ait}`, AT1) shows the tool's facts: purpose,
  data categories, users and owner. It has an edit form, a "Record a review"
  form (date, decision, risk level, notes) and the review history.
- **Training** (`/orgs/{org}/training`, AT2) lists courses and their
  assignments with a completion rate. **My training** (`/training`) is where a
  staff member reads the material and takes the quiz.
- **Evidence** (`/orgs/{org}/evidence`, AT3) builds a pack and lists past packs
  with their digests.

The nav gains "AI register" for every org. The Solo profile is turned off
(`SOLO_MODE=false` on api-edge, identity-worker, membership-worker and the
console), because a company has several staff.

## 4. Events, secrets, and integrations

Audit events (a domain event plus an audit row, category `tally`):

- AT1: `tally.tool.created`, `tally.tool.updated`, `tally.tool.reviewed`.
- AT2: `tally.course.*`, `tally.assignment.created`,
  `tally.assignment.completed`, `tally.reminder.sent`.
- AT3: `tally.evidence_pack.created`.

The subject kinds `ai_tool` and `ai_tool_review` get the `ait_` and `atr_`
prefixes in events-worker's public-id table.

Email templates (notifications-worker):

- AT1: `tally.tool.owner_assigned`.
- AT2: `tally.training.assigned` and `tally.training.reminder`.

`tally-worker` is added to `NOTIFICATIONS_INTERNAL_ACTOR_VALUES` in AT1.
Without that entry, notifications-worker refuses its calls with 403.

Secrets: `CLOUDFLARE_R2_TOKEN` per environment from AT2 (brokered, `r2-data`,
with `buckets` named), used only by the R2 terraform component. No other
provider connection is needed.

## 5. Out of scope

- **The Colorado impact-assessment wizard and its LLM drafting step** (the
  brief's M4). It needs a model credential this workspace does not hold (AT-B).
- **Discovery of AI apps from Google Workspace or Microsoft 365 sign-in logs**
  (the brief's M3). It needs OAuth client credentials, admin consent in each
  customer's tenant, and a verified app (AT-C). The register is filled in by
  hand until then, and discovery would only suggest rows for it.
- **Training content.** The brief is looking for an instructional designer.
  Aitally stores and serves the company's own material and ships none (AT-D).
- **Per-seat billing** (€3 per employee per month, minimum €39): Polar
  configuration on the baseline's billing context, once priced.
- **The `aitally.app` custom domain**: the zone is not on this account.
