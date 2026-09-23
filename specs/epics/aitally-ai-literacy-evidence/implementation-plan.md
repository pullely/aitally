# aitally-ai-literacy-evidence — implementation plan

Milestones land in order. Each one is made of one or more tasks, each task is
one pull request, and each pull request is landed with `orun pr land`. A
milestone is marked ✅ here when its "done when" list is true, and it is
recorded in `IMPLEMENTATION-STATUS.md`.

A workspace can mint only 200 brokered credentials per rolling 24 hours, and
every CI job that deploys spends one. The bootstrap, this spec and AT1 fit into
one day. AT2 and AT3 land the next day. Each milestone's tests run green
locally before its pull request opens, because every push to a pull request
spends mints.

## AT0 — the spec

This doc set, merged to `main` and attached to the epic with `orun spec push`.

**Done when**
- the five documents are on `main`
- `orun spec list --epic aitally-ai-literacy-evidence` shows them

## AT1 — the AI tool register

This milestone builds the `tally` bounded context end to end:

- Migration `200_tally_register` (`tally_tools`, `tally_tool_reviews`, with
  the prohibited-risk CHECK on both) and its repository in `packages/db`.
- The wire types in `packages/contracts/src/tally.ts` and a `TallyClient` in
  the SDK.
- `apps/tally-worker`: tool CRUD, the register summary, dated reviews that move
  `next_review_on`, the owner-assigned email and audit events. It depends on
  `db-migrate`, so its migration always deploys first.
- The api-edge tally facade, its binding and its rate-limit family.
- `tally.read` and `tally.write` in the policy engine.
- The `tally.tool.owner_assigned` template, and `tally-worker` on the
  notifications allow-list.
- The console register page and tool page.
- The Solo profile is turned off.

AT1 also carries two baseline fixes. Every cirrus product needs them before its
first audited write works on D1:

- the tested `cirrus-d1-fix.patch`, which fixes events/audit and membership SQL
  that SQLite cannot run. Without it, no organization can be created.
- a redeploy marker on every worker's `component.yaml`, because a
  shared-package change does not redeploy the workers that bundle it.

**Done when**
- migration `200_tally_register` is applied on stage and prod
- on stage, a signed-in user creates an organization (201), registers a tool with an owner, purpose, data categories and a risk level, and sees it in the register summary
- recording a review sets the tool's status and risk level, and moves `nextReviewOn` to the review date plus the interval
- a `prohibited` risk level on a tool that is not `blocked` or `retired` is refused with 422
- a non-member reading the register gets 404, and a viewer registering a tool gets 404
- `tests/tally-worker` runs the worker over a real SQLite engine and is green in CI

## AT2 — training assignments, completion records and escalating reminders

AT2 adds:

- Migration `210_tally_training`.
- `infra/terraform/cloudflare-r2`, with the bucket `aitally-training-content-{env}`
  bound as `stg-…`/`prod-…`. Its `CLOUDFLARE_R2_TOKEN` is created per
  environment with `--param buckets=…` **before** the PR opens.
- Courses, with material in R2 (SHA-256 on the way in and out) and an optional
  quiz.
- Assignments by email, to everyone in the org, or to the users of one tool,
  with a due date 30 days out by default.
- Completion by the assignee only, which records the score, the time and the
  material SHA-256.
- The `scheduled()` handler (`0 7 * * *`) with a reminder ladder: 7, 1 and 0
  days before; 3 and 7 days late, adding the tool owner; 14 days late, adding
  the org owners. Each rung is claimed with
  `INSERT … ON CONFLICT DO NOTHING RETURNING id`.
- Annual re-assignment.
- `GET /v1/me/training`.
- The `tally.training.assigned` and `tally.training.reminder` templates.
- The console training page and the "My training" page.

**Done when**
- on stage a course PDF uploads, and it downloads with the same SHA-256
- an assignee (a viewer) passes the quiz. The assignment records `completedAt`, `scorePct` and the `materialSha256` of the version taken. Someone else completing it gets 404.
- a rung that is due is sent exactly once across two cron ticks run back to back (tested with an injected clock over real SQLite)
- an assignment 7 days late emails the tool owner as well as the assignee, and the deploy log lists the `0 7 * * *` schedule on stage and prod
- a completion 12 months old produces the next cycle's assignment exactly once

## AT3 — the regulator-ready evidence pack

AT3 adds:

- Migration `220_tally_evidence`.
- Per-employee and per-tool evidence as JSON and CSV.
- `POST …/evidence-packs`, which builds the org pack and stores it immutably in
  R2 under `orgs/{org}/packs/{atx}/`. The pack holds the register, the review
  history, the training records, a one-page `summary.pdf` (a hand-rolled
  PDF 1.4 writer with no dependency) and a `manifest.json` of SHA-256 digests.
- The `tally.evidence_pack.created` audit event.
- The console evidence page.

**Done when**
- on stage an org pack builds, and every file downloads with the digest `manifest.json` lists
- a per-employee export lists exactly that person's assignments and no one else's
- a second pack is a new `atx_` with its own keys, and no earlier object is overwritten
- retired tools and their reviews appear in the pack

## Sequencing note

AT1 is the record the other milestones read. AT2's "users of this tool"
assignment and its escalation to the tool owner both read `tally_tools`, and
AT3 exports both. So AT1 lands first and alone, together with the D1 fix that
makes organization create work at all. AT2 needs the R2 bucket and the cron.
AT3 needs AT2's training rows, so the order is fixed. The Colorado module
(AT-B) and app discovery (AT-C) wait on credentials and are not sequenced here.
