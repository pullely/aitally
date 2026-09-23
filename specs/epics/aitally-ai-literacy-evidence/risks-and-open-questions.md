# aitally-ai-literacy-evidence — risks and open questions

Each entry has a letter, a title and a state:

- **RISK**: open, with a mitigation.
- **RESOLVED**: decided. The entry says what was decided and why.
- **ACCEPTED**: a cost we carry knowingly.
- **SETTLED**: decided for now, to be revisited on a stated cadence.

## AT-A — The amended wording of Article 4 (RISK, open)

The design quotes Article 4 of Regulation (EU) 2024/1689 as published in the
OJ on 12 July 2024. The brief says it was "softened in June 2026". The AI Act
Explorer shows an amended paragraph 1 ("take measures to support the
development of AI literacy", and "does not require … to guarantee any specific
level of AI literacy of any individual") and new paragraphs 2 and 3. We have
not read the amending act in the Official Journal, so its number, its date and
whether it has applied are unconfirmed.

Mitigation: the product records *measures* (the register, dated training, what
was taken, completion), and both wordings call for measures. The console never
says "compliant". Before any marketing copy cites the amended text, an EU
AI-law advisor (the brief is looking for one) confirms the OJ reference and
the design's §0.1 is updated.

## AT-B — The Colorado module needs a model credential (RISK, open)

The brief's M4 is an LLM-assisted Colorado impact-assessment wizard. Drafting
needs a model credential (Claude or Workers AI), and no one has provided one to
this workspace. It is not built in this epic. When it is planned, it reads the
register's purpose, data categories and risk level for a tool, which AT1
already stores, so the wizard pre-fills from existing rows and needs no
migration of them.

## AT-C — App discovery needs OAuth credentials and tenant consent (RISK, open)

The brief's optional discovery of AI apps from Google Workspace and Microsoft
365 sign-in logs needs:

- a Google Cloud OAuth client with the Admin SDK Reports scope, and app
  verification
- a Microsoft Entra app registration with `AuditLog.Read.All`
- admin consent in every customer tenant

None of these exist. Discovery would only *suggest* `proposed` rows for the
register, so AT1's manual register is the complete product without it.

## AT-D — Aitally ships no training content and no classification advice (ACCEPTED)

The brief is "looking for an instructional designer" and "an EU AI-law
advisor". Until they exist:

- the company uploads its own material (AT2)
- the company picks each tool's risk level itself (AT1)

The console labels risk levels with the Act's tiers and does not suggest a
level. A future "starter course" is a content decision for the owner, not a
code change.

## AT-E — Colorado citations unverified (RISK, open)

The Colorado General Assembly's site refused automated reads (HTTP 406) while
this spec was written. The brief's description (effective 30 June 2026, under
legal challenge) is not verified here. It matters only for AT4, and it is
re-checked when AT4 is planned.

## AT-F — The baseline's audited writes do not run on D1 (RESOLVED)

The cirrus baseline's `appendEventWithAudit` and membership repository use
Postgres-only SQL (a data-modifying CTE, `row_to_json`, `FULL JOIN`) that
SQLite cannot parse. On D1, organization create fails and every audited write
is lost.

A tested patch (`cirrus-d1-fix.patch`, landed first in chaseid) fixes the
events/audit and membership paths. AT1 applies it, and touches every worker's
`component.yaml` so the fix actually deploys. `tally-worker` also writes its
own audit rows with two portable statements, so its audit trail does not
depend on the patched path.

## AT-G — The D1 executor's `rowCount` after a write (RESOLVED)

The baseline's D1 executor reports `rowCount = rows.length`. An `UPDATE`,
`INSERT` or `DELETE` without `RETURNING` therefore always reports 0 on D1.
Every tally repository write whose outcome is inspected uses `RETURNING`.
`tests/tally-worker` pins this over the real executor and a real SQLite engine,
because a mocked executor would hide it.

## AT-H — Email is advisory; the record is D1 (ACCEPTED)

Owner-assignment and training reminder emails go through the baseline's
best-effort notifications path, which never fails the caller. The console's
register and training lists are the source of truth. AT2's escalation to the
tool owner and the org owners is the backstop for an assignee who never reads
mail.

## AT-I — Prod sign-in needs a sending domain (ACCEPTED)

Magic-link email needs a verified sending domain, and `aitally.app` is not
held. Stage signs in through `DEBUG_DELIVERY=true`, which is what the scripted
smoke test uses. Prod keeps `DEBUG_DELIVERY=false`, so until the owner buys the
domain and sets up sending, nobody can sign in to prod. Prod is verified through
`/health` and unauthenticated 401s only.

## AT-J — Mint budget for CI (ACCEPTED)

Each workspace can mint 200 brokered credentials per rolling day, and every
deploying CI job spends one. A bootstrap plus three milestones therefore does
not fit into a day. AT1 lands on day one, and AT2 and AT3 on day two. Every
milestone is tested locally before its pull request opens.

## AT-K — Time zones and "due today" (SETTLED)

`due_on` and `next_review_on` are calendar dates with no time zone. The AT2 cron
runs at 07:00 UTC, which is morning in every EU time zone, and compares against
the UTC date. A US-based company with EU staff may see a reminder a few hours
early by its own clock. This is revisited if a design partner outside Europe
signs up.

## AT-L — Personal data in the register and the training record (RISK, open)

The training record holds staff emails, scores and completion times. That is
employee personal data under the GDPR, and the company is its controller. The
register holds no personal data beyond owner emails. The evidence pack exports
only what the company asked for (the org, one employee or one tool). A
retention setting and a per-employee erasure path are follow-ups, and they are
flagged before paid launch.

## AT-M — The custom domain (ACCEPTED)

`aitally.app` is not a zone on this Cloudflare account, so the product lives on
`*.nexo-7be.workers.dev`. Moving it is the baseline's phase 07 once the zone
exists. Nothing in the epic depends on the hostname.
