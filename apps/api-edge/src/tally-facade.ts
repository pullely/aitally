import type { Env } from "./env.js";
import { errorResponse, withEdgeTimings } from "./http.js";
import { replayOrExecute } from "./idempotency.js";
import { resolveActor } from "./resolve-actor.js";
import { createTimings } from "@saas/contracts/timing";

// Aitally (tally-worker). One authenticated lane, /v1/organizations/{org}/…:
// the AI tool register and each tool's reviews. resolveActor → actor headers
// over the TALLY_WORKER binding, like every other org route; the worker runs
// membership + policy itself. The actor's email travels too: a review records
// who made it.

const TALLY_RE = /^\/v1\/organizations\/[^/]+\/ai-tools(?:\/[^/]+(?:\/reviews)?)?$/;

const FORWARDED_HEADERS = ["content-type", "content-length", "traceparent", "idempotency-key"];
const BODY_METHODS = new Set(["POST", "PATCH", "PUT"]);

export function isTallyRoute(pathname: string): boolean {
  return TALLY_RE.test(pathname);
}

export async function handleTallyRoute(
  request: Request,
  env: Env,
  requestId: string,
  pathname: string,
): Promise<Response> {
  return replayOrExecute(request, requestId, env, "tally", async () => {
    if (!env.TALLY_WORKER) {
      return errorResponse("internal_error", "AI register service unavailable", 503, requestId);
    }
    if (!env.IDENTITY_WORKER) {
      return errorResponse("internal_error", "Authentication service unavailable", 503, requestId);
    }
    const timings = createTimings();
    const endTotal = timings.start("edge_total");
    const session = await timings.measure("edge_auth", () => resolveActor(request, env, requestId));
    if ("error" in session) return session.error;

    const headers = new Headers();
    headers.set("x-request-id", requestId);
    headers.set("x-actor-subject-id", session.subjectId);
    headers.set("x-actor-subject-type", session.subjectType);
    headers.set("x-actor-email", session.email);
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const url = new URL(request.url);
    const target = new URL(pathname + url.search, "https://tally.internal");
    const init: RequestInit = { method: request.method, headers };
    if (BODY_METHODS.has(request.method)) init.body = request.body;

    try {
      const downstream = await timings.measure("edge_downstream", () =>
        env.TALLY_WORKER!.fetch(target.toString(), init),
      );
      const res = new Response(downstream.body, { status: downstream.status, headers: downstream.headers });
      endTotal();
      return withEdgeTimings(res, requestId, "edge.tally", timings);
    } catch {
      return errorResponse("internal_error", "AI register service unavailable", 503, requestId);
    }
  });
}
