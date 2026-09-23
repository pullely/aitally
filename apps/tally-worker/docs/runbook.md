# tally-worker — runbook

- **Health:** `GET /health` on the worker (via a service binding) reports which
  bindings are configured: database, membership, policy, notifications.
- **Every route answers 404 for a member:** policy-worker is running an old
  action table without `tally.read`/`tally.write`. A change to
  `packages/policy-engine` does not redeploy policy-worker by itself: touch its
  `component.yaml` and merge.
- **Every write answers 503:** migration `200_tally_register` has not applied
  in that environment. Check the `db-migrate` lane of the deploy run.
- **The owner got no email:** notifications are advisory. Check that
  `tally-worker` is in `NOTIFICATIONS_INTERNAL_ACTOR_VALUES` and that
  notifications-worker was redeployed after it was added; otherwise the call is
  refused with 403. On prod no email is delivered until a sending domain is
  verified.
