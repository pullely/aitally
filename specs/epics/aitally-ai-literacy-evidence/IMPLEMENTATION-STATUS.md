# aitally-ai-literacy-evidence (AT) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place
the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| AT0 — the spec | ✅ Landed. Doc set on `main` and pushed with `orun spec push` | #9 (d5c4151) |
| AT1 — the AI tool register | ✅ Landed. Deploy run 35910146783 on `main` green 66/66; stage smoke 29/29, prod 7/7 (2026-09-23) | #10 (f3f91ed), task AT-2 |
| AT2 — training assignments, completion records and escalating reminders | In progress | task AT-3 |
| AT3 — the regulator-ready evidence pack | | |

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
