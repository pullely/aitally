# Epic: aitally-ai-literacy-evidence (AT)

**A company with 10 to 250 staff now uses ChatGPT, Copilot, a meeting
transcriber and half a dozen AI features built into its SaaS tools. Article 4
of the EU AI Act asks every deployer to take measures on its staff's AI
literacy, and small firms have no dated record of which tools are in use, who
answers for each one, or who was trained on what and when. Enterprise
AI-governance suites cost too much for them, and training vendors sell courses
with no register and no evidence trail. This epic makes three records and
nothing more: the AI tool register (each tool, what it is for, which data
reaches it, its risk level and its accountable owner, reviewed on a date), the
training record (who was assigned which course, when it was due, when they
completed it and how they scored, re-assigned every year), and the evidence
pack (an immutable, hashed export of both, per employee or per tool, that the
company can hand to an authority or an auditor). The one design idea: every
fact the company might be asked to prove is a dated row written when it
happened, and the evidence pack is a read of those rows, never a report someone
writes afterwards.**

Aitally is for EU companies with 10 to 250 staff, and US companies with EU
staff, that use general-purpose AI tools at work. An operations lead lists the
AI tools in use and names an owner for each. The owner reviews each tool once a
year. Every staff member is assigned the training for the tools they use, is
reminded until they finish it, and is re-assigned it a year later. When anyone
asks, the company exports what it did and when.

## Status

| Field | Value |
|-------|-------|
| Status | Draft |
| Cluster | **AT** (AT0–AT3) |
| Owner(s) | `apps/tally-worker` (the register, the training record, the evidence packs, the reminder cron) · `apps/api-edge` (the facade) · `packages/db` (migrations `200`–`220`) · `packages/contracts` + `packages/sdk` (the wire) · `infra/terraform/cloudflare-r2` (training content and evidence packs, from AT2) · `apps/notifications-worker` (the templates) · `apps/web-console-next` (the surface) |
| Builds on | `cirrus baseline-v12`: organizations as companies, members as staff, the policy engine for who may edit, `notifications-worker` for email, the audit trail in `events-worker`, api-edge rate limiting |
| Changes | Adds one bounded context (`tally`), one worker, one R2 bucket per environment (AT2) and one cron trigger (AT2). Turns the Solo profile off, because a company has several staff and a consultant may serve several companies. Every baseline context is reused, and none is changed beyond new actions, templates and subject prefixes. |
| Decisions locked | (1) A company is a cirrus organization, and its staff are its members. Staff who only take training join as `viewer`. (2) Nothing in the register is deleted. A tool that is no longer used is `retired` and stays in the register as evidence. (3) A risk level of `prohibited` can only be held by a `blocked` or `retired` tool, and the schema enforces this. (4) Each tool review is its own dated row, and the tool's `next_review_on` is derived from the last review. (5) Training completion, the score and the version of the content that was taken are written once and never edited. A correction is a new assignment. (6) Aitally ships no legal advice and no training content of its own. The company uploads its own material (see AT-D). |
| Gate | AT1 is the first user-visible change (the register). AT2 makes the training obligation provable. AT3 is what the company hands to an authority. |
| Shipped as | |

## Read order

1. `design.md`: the obligation, the resources, the routes, the surfaces, and what is out of scope
2. `implementation-plan.md`: the milestones and what "done" means for each
3. `risks-and-open-questions.md`: what could go wrong and what was decided
4. `IMPLEMENTATION-STATUS.md`: what actually shipped, kept separate from intent

## Milestones at a glance

| Milestone | What it lands | Done when |
|---|---|---|
| AT0 — the spec | this doc set | merged and pushed with `orun spec push` |
| AT1 — the AI tool register | the `tally` context (migration `200_tally_register`), `tally-worker`, tool CRUD (owner, purpose, data categories, risk level, status, annual review date), dated tool reviews, the owner-assigned email, the register summary, the console register and tool pages | on stage a signed-in user creates an org (201), registers a tool, records a review that moves its next review date a year out, and a `prohibited` tool that is still `approved` is refused (422); a non-member gets 404 |
| AT2 — training assignments, completion records and escalating reminders | `210_tally_training`, the R2 bucket per env (bound with its `stg-`/`prod-` prefix), courses with content in R2 and an optional quiz, assignments per staff member (by tool or to everyone), completion with score and content SHA-256, a daily cron with a reminder ladder that escalates to the tool owner and org owners, annual re-assignment, the staff member's own "my training" view | on stage course material uploads and downloads byte for byte; an assignee completes a quiz and the record shows score, time and content hash; each reminder rung is sent once across two cron ticks; an overdue assignment escalates |
| AT3 — the regulator-ready evidence pack | `220_tally_evidence`, per-employee and per-tool evidence (JSON and CSV), an org pack (PDF summary, CSVs and a `manifest.json` of SHA-256 digests) stored immutably in R2, the console evidence page | on stage an org pack builds, and every file in it downloads with the SHA-256 its manifest lists; a per-employee export lists exactly that person's assignments; packs cannot be overwritten |

Later, and not built here: the Colorado impact-assessment wizard with LLM
drafting (no model credential, AT-B), discovery of AI apps from Google
Workspace and Microsoft 365 sign-in logs (no OAuth credentials or admin
consent, AT-C), per-seat billing (Polar, once priced), and the `aitally.app`
domain. See `risks-and-open-questions.md`.
