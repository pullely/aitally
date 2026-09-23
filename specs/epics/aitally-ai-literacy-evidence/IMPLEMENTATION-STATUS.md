# aitally-ai-literacy-evidence (AT) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place
the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| AT0 — the spec | ✅ Landed. Doc set on `main` and pushed with `orun spec push` | #9 (d5c4151) |
| AT1 — the AI tool register | In review | task AT-2 |
| AT2 — training assignments, completion records and escalating reminders | | |
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
