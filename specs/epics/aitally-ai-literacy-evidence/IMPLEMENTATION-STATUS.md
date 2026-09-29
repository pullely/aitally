# aitally-ai-literacy-evidence (AT) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place
the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| AT0 — the spec | ✅ Landed. Doc set on `main` and pushed with `orun spec push` | #9 (d5c4151) |
| AT1 — the AI tool register | ✅ Landed. Deploy run 35910146783 on `main` green 66/66; stage smoke 29/29, prod 7/7 (2026-09-23) | #10 (f3f91ed), task AT-2 |
| AT2 — training assignments, completion records and escalating reminders | ✅ Landed. Deploy run 36642817780 on `main` green 34/34 (cloudflare-r2 applied stage + prod, `210_tally_training` migrated, `0 7 * * *` scheduled on tally-worker stage + prod); stage smoke 59/59, prod 16/16 (2026-09-29) | #11 (bf51aeb), task AT-3 |
| AT3 — the regulator-ready evidence pack | ✅ Landed. Deploy run 36645221915 on `main` green 28/28 (`220_tally_evidence` migrated; identity-worker redeployed with its public hostname closed); stage smoke of every milestone 105/105, prod 23/23 (2026-09-29) | #12 (ff749ed), task AT-4 |

## Departures from the design

### AT1

- **Baseline fix carried: `cirrus-d1-fix.patch` (runbook trap 16).** The cirrus
  baseline's `appendEventWithAudit` (a Postgres data-modifying CTE) and its
  membership SQL cannot run on D1, so organization create returned 503 and
  every audited write was lost. AT1 applies the tested patch: events/audit,
  membership, and the SQLite schema test harness. This changes the baseline,
  not the design.
- **Every worker's `component.yaml` carries a redeploy marker (trap 17).**
  `packages/db`, `packages/policy-engine` and `packages/contracts` changed, and a
  worker only redeploys when its own component changes.
- **The register summary gains `inUse`** (tools not retired). The design listed
  `total` only. `byRiskLevel`, `reviewsDue` and `withPersonalData` count tools in
  use, so a retired tool's history never inflates today's exposure. `byStatus`
  and `total` still count every tool.
- **A review response carries `applied`.** A review dated before the tool's last
  review is kept in the history, but it does not move the tool (§1.2). The flag
  says which happened.
- **`reviewDue` is false for a retired tool**, even when its date has passed.
- **`tally-worker` has no R2 binding yet.** The bucket arrives with AT2's
  training content, as planned.

### AT2

- **The R2 bucket is `${namespacePrefix}aitally-training-content-${env}`**, so
  Orun creates `stg-aitally-training-content-stage` and
  `prod-aitally-training-content-prod`, and `tally-worker` binds those names
  (runbook trap 26). Its `CLOUDFLARE_R2_TOKEN` was created per environment
  with `--param buckets=aitally-training-content-<env>` before the PR opened
  (trap 20). The terraform is leakbook's, renamed, with self-healing adoption.
- **"The users of one tool" is a list the company keeps.** AT1's register has
  only a free-text `usersDescription`, so `{ toolUsers: true }` had nothing to
  read. AT2 adds `tally_tool_users` and `GET`/`PUT
  /v1/organizations/{org}/ai-tools/{ait}/users` (read: `tally.read`, replace:
  `tally.write`). It is current state, replaced wholesale, and the only table in
  the context that is ever deleted from.
- **An on-demand sweep route**, `POST /v1/organizations/{org}/training/sweep`
  (`tally.write`), runs today's clock for one organization exactly as the
  07:00 UTC cron does. Repeating it the same day sends nothing new, because each
  rung is claimed once.
- **The ladder sends the latest rung whose day has come.** A sweep that missed a
  day sends the current rung, never a stale one, and nothing goes out more than
  7 days before the due date. late3/late7 add the owner of the course's tool;
  late14 adds the organization's owners (their addresses come from membership,
  whose `usr_` subject ids are converted in the join — trap 39).
- **`assign` accepts a `dueOn`** from 60 days back to a year ahead, so training
  that was already due can be recorded. The default is today + `due_days`.
- **Completion can carry `materialSha256`**, the `x-content-sha256` of the
  version the assignee opened. If a newer version was uploaded since, the
  completion is refused (409). The record always stores the SHA-256 of the
  current version at completion.
- **A failed quiz attempt is recorded** in `tally_quiz_attempts` and counted on
  the assignment, which stays open.
- **The quiz's correct answers are only on the wire for writers.** Readers,
  and `/v1/me/training`, get the prompts and options only.
- **`/v1/me/training` lists assignments in organizations the caller is an
  active member of.** An assignment addressed to someone who has not joined the
  organization is not shown to them until they join.
- **No new policy action.** Training reuses `tally.read` / `tally.write`, so
  `policy-worker` did not need a redeploy (trap 17). events-worker gained the
  `atc_`, `ata_` and (ahead of AT3) `atx_` subject prefixes.

### AT3

- **Every pack holds the same five files, whatever its scope.** An org pack
  covers everything. An employee pack covers that person's training records and
  the tools they were trained for or are a named user of, with those tools'
  reviews. A tool pack covers that tool, its reviews and the training for it.
- **Immutability is enforced twice.** Every object is written under a fresh
  `orgs/{org}/packs/{atx}/` prefix with `onlyIf: If-None-Match: *`, and R2
  refuses the put if the key exists (the request then fails, and no row is
  written). No route updates or deletes a pack: `PUT`, `PATCH` and `DELETE`
  answer 405. R2 also checks each object's SHA-256 on the way in.
- **`manifest.json` lists the other four files; its own digest is the pack's
  `manifestSha256`**, stored in D1 and shown in the console. `summary.pdf`
  lists the three CSVs' digests.
- **`GET …/evidence-packs/{atx}`** (one pack's metadata) was added beside the
  list and the file download.
- **The per-tool CSV is that tool's training records.** Its JSON carries the
  tool, its reviews, its named users and the records.
- **CSV cells that a spreadsheet would read as a formula** (leading `=`, `+`,
  `-`, `@`) are prefixed with an apostrophe.
- **`summary.pdf` is A4** (the EU paper size), from the hand-rolled PDF 1.4
  writer carried over from leakbook and arcdesk.
- **identity-worker's public `workers.dev` hostname is closed** in this PR
  (runbook trap 37): `"workers_dev": false` on stage and prod.

## Verification at ship (2026-09-29, after AT3's deploy)

Every milestone was driven end to end on stage by one scripted smoke (105
checks, all passing on the first run), signed in through stage's
`DEBUG_DELIVERY`:

- **AT1**: organization create 201; a tool registered and reviewed
  (`nextReviewOn` moved a year from the review date); a second tool retired by
  review.
- **AT2**: a learner invited as viewer and joined; a course with a quiz; the PDF
  material uploaded and downloaded byte for byte, with the SHA-256 the worker
  computed, R2 checked and `x-content-sha256` returned. Only the assignee
  completed (the owner, the learner on the owner's assignment, and an outsider
  all got 404). A failed attempt was recorded, the pass stored score, time and
  material hash, and a second completion was refused (409). `/v1/me/training`
  returned exactly each caller's assignments. Six assignments due today +7, +1,
  0, −3, −7 and −14: the first sweep claimed each rung once (late3/late7 copied
  the tool owner, late14 the org owner through membership's `usr_` ids), and
  notifications-worker accepted every reminder. The second sweep on the same day
  sent nothing (`alreadySent` 6). The `0 7 * * *` schedule is live on
  tally-worker in stage and prod.
- **AT3**: the per-employee export listed exactly that person's records (JSON
  and CSV). An org pack's `manifest.json` matched the pack's `manifestSha256`,
  and every file downloaded from R2 with the digest the manifest lists; the
  retired tool and its review were in it. A second pack was a new `atx_`, and
  the first pack's objects were unchanged (re-verified, and R2's
  `last_modified` predates the second pack). PUT/PATCH/DELETE on a pack: 405.
- **Cross-org**: a user in another organization got 404 on every route tried.
- **Prod**: `/health` 200, all 19 new routes 401 unauthenticated where an
  unknown route is 404, identity-worker's public hostname 404, and
  `DEBUG_DELIVERY` false.

"Sent" for a reminder means accepted by notifications-worker. Cloudflare Email
refuses delivery from `mail.aitally.app`, which this account does not own
(runbook trap 27).
