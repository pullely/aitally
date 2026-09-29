import type { Env } from "./env.js";
import { route } from "./router.js";
import { runClock } from "./clock.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return route(request, env);
  },

  /**
   * Daily at 07:00 UTC (wrangler `triggers.crons`), the morning of the working
   * day across the EU: annual re-assignment, then the training reminder ladder.
   */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date(controller.scheduledTime);
    ctx.waitUntil(
      runClock(env, now).then((r) => {
        // eslint-disable-next-line no-console -- one structured line per daily run
        console.log(
          JSON.stringify({
            level: "info",
            msg: "tally training clock",
            today: r.today,
            considered: r.considered,
            claimed: r.claimed.length,
            alreadySent: r.alreadySent,
            reassigned: r.reassigned.length,
          }),
        );
      }),
    );
  },
} satisfies ExportedHandler<Env>;
