# tally-worker — architecture

```
staff ──► api-edge ──(resolveActor)──► tally-worker ──► D1 (tally_*)
                                                     ├─► membership-worker (context)
                                                     ├─► policy-worker (authorize)
                                                     └─► notifications-worker (email)
```

- Reachable only over the `TALLY_WORKER` service binding (`workers_dev: false`).
- Every route runs membership authorization-context then policy authorize; a
  deny is `404`, never `403`.
- The actor's email arrives as `x-actor-email`, set by api-edge from the
  resolved session (a caller's own header is never forwarded); reviews record it.
- D1 has no interactive transactions: every write whose outcome matters uses
  `RETURNING` (the D1 executor's `rowCount` is 0 for a bare write), a review is
  written before it is applied to its tool, and audit appends are best-effort
  after the write they describe.
- Depends on `db-migrate`, so a run that adds a migration applies it before this
  worker's code that reads the new columns goes live.
