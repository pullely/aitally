# cloudflare-r2

Provisions the private Cloudflare R2 bucket holding training material and evidence packs (stage and prod)

Terraform-managed infrastructure for aitally, per environment (`stage`, `prod`; `dev` is verify-only and provisions nothing).

## Depends on

- (none)

## Depended on by

- **tally-worker** — binds the bucket as `TALLY_CONTENT`: course material (AT2) and evidence packs (AT3)
