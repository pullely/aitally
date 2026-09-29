export interface Env {
  PLATFORM_DB?: D1Database;
  /** Private R2 bucket: training material (AT2) and evidence packs (AT3). */
  TALLY_CONTENT?: R2Bucket;
  MEMBERSHIP_WORKER?: Fetcher;
  POLICY_WORKER?: Fetcher;
  NOTIFICATIONS_WORKER?: Fetcher;
  ENVIRONMENT: string;
}
