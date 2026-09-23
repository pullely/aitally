import type { Env } from "./env.js";
import type { TallyRepository } from "@saas/db/tally";
import type { SqlExecutor } from "@saas/db/d1";
import { createTallyRepository } from "@saas/db/tally";
import { createSqlExecutor } from "@saas/db/d1";

export interface Db {
  executor: SqlExecutor;
  tally: TallyRepository;
}

/** Open the request's database handle, or null when the binding is missing. */
export function openDb(env: Env): (Db & { dispose(): Promise<void> }) | null {
  if (!env.PLATFORM_DB) return null;
  const executor = createSqlExecutor(env.PLATFORM_DB);
  return { executor, tally: createTallyRepository(executor), dispose: () => executor.dispose() };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayUtc(now: string = nowIso()): string {
  return now.slice(0, 10);
}
