# cloudflare-r2

Provisions the private R2 bucket that holds Aitally's training material (AT2)
and evidence packs (AT3), one per environment. The runner injects
`namespacePrefix`, so the buckets are `stg-aitally-training-content-stage` and
`prod-aitally-training-content-prod` (runbook trap 26).

Nothing reads the bucket directly. `apps/tally-worker` binds it as
`TALLY_CONTENT` by that prefixed name, and every read is authorized by
organization membership (`tally.read`) through api-edge.

Objects are written once under a fresh id and never overwritten:
`orgs/{org}/courses/{course}/materials/{material}` for course material and
`orgs/{org}/packs/{pack}/{file}` for evidence packs. Each object's SHA-256 is
recorded in D1 and served as `x-content-sha256`.

The component authenticates with its own brokered `CLOUDFLARE_R2_TOKEN`
(`r2-data` scope template), created per environment with
`--param buckets=aitally-training-content-<env>` (runbook trap 20).
