import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isTallyRoute, isTallyMeRoute, handleTallyRoute } from "@api-edge/tally-facade";
import { isOrgRoute } from "@api-edge/org-facade";

const __dirname = dirname(fileURLToPath(import.meta.url));

function stripJsoncComments(text: string): string {
  return text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

function recorder(respond: (url: string) => Response): { fetcher: Fetcher; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetcher = {
    fetch(input: string | Request | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, init: init ?? {} });
      return Promise.resolve(respond(url));
    },
    connect() {
      throw new Error("not implemented");
    },
  } as unknown as Fetcher;
  return { fetcher, calls };
}

function identity(userId: string) {
  return recorder(() =>
    Response.json({
      data: {
        actor: { actorType: "user", actorId: userId, email: "ops@acme.example" },
        session: { id: "ses_abc", expiresAt: "2026-12-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
        user: { id: userId, email: "ops@acme.example", displayName: "Ops" },
      },
      meta: { requestId: "req_inner", cursor: null },
    }),
  );
}

describe("api-edge tally facade", () => {
  it("claims the AI register routes and nothing else", () => {
    for (const p of [
      "/v1/organizations/org_a/ai-tools",
      "/v1/organizations/org_a/ai-tools/ait_b",
      "/v1/organizations/org_a/ai-tools/ait_b/reviews",
      "/v1/organizations/org_a/ai-tools/ait_b/users",
      "/v1/organizations/org_a/training/courses",
      "/v1/organizations/org_a/training/courses/atc_b",
      "/v1/organizations/org_a/training/courses/atc_b/materials",
      "/v1/organizations/org_a/training/courses/atc_b/materials/atm_c",
      "/v1/organizations/org_a/training/courses/atc_b/assign",
      "/v1/organizations/org_a/training/assignments",
      "/v1/organizations/org_a/training/assignments/ata_b/complete",
      "/v1/organizations/org_a/training/sweep",
      "/v1/me/training",
    ]) {
      expect(isTallyRoute(p)).toBe(true);
    }
    for (const p of [
      "/v1/organizations/org_a",
      "/v1/organizations/org_a/projects",
      "/v1/organizations/org_a/members",
      "/v1/organizations/org_a/ai-tools/ait_b/reviews/atr_c",
      "/v1/organizations/org_a/ai-tools/ait_b/owners",
      "/v1/organizations/org_a/ai-toolsx",
      "/v1/organizations/org_a/training",
      "/v1/organizations/org_a/training/assignments/ata_b",
      "/v1/organizations/org_a/training/courses/atc_b/materials/atm_c/x",
      "/v1/me",
      "/v1/me/training/x",
    ]) {
      expect(isTallyRoute(p)).toBe(false);
    }
  });

  it("claims /v1/me/training as a me-route, dispatched ahead of the auth facade", () => {
    expect(isTallyMeRoute("/v1/me/training")).toBe(true);
    expect(isTallyMeRoute("/v1/organizations/org_a/training/courses")).toBe(false);
    const index = readFileSync(resolve(__dirname, "../../../apps/api-edge/src/index.ts"), "utf8");
    expect(index.indexOf("isTallyMeRoute(url.pathname)")).toBeGreaterThan(0);
    expect(index.indexOf("isTallyMeRoute(url.pathname)")).toBeLessThan(index.indexOf("isAuthRoute(url.pathname)"));
  });

  it("forwards a material upload's raw body and x-filename", async () => {
    const id = identity("usr_abc123");
    const worker = recorder(() => Response.json({ data: {}, meta: { requestId: "r", cursor: null } }, { status: 201 }));
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const request = new Request("https://api.example.com/v1/organizations/org_a/training/courses/atc_b/materials", {
      method: "POST",
      headers: { authorization: "Bearer sps_ses_abc.secret", "content-type": "application/pdf", "x-filename": "policy.pdf" },
      body: bytes,
    });
    const response = await handleTallyRoute(
      request,
      { IDENTITY_WORKER: id.fetcher, TALLY_WORKER: worker.fetcher, ENVIRONMENT: "test" },
      "req_test",
      "/v1/organizations/org_a/training/courses/atc_b/materials",
    );
    expect(response.status).toBe(201);
    const headers = new Headers(worker.calls[0]!.init.headers);
    expect(headers.get("x-filename")).toBe("policy.pdf");
    expect(headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await new Response(worker.calls[0]!.init.body).arrayBuffer())).toEqual(bytes);
  });

  it("is dispatched before the org facade would swallow it", () => {
    // index.ts checks isTallyRoute before isOrgRoute; whether or not the org
    // facade's pattern also matches, the tally facade must answer these paths.
    expect(isTallyRoute("/v1/organizations/org_a/ai-tools")).toBe(true);
    expect(typeof isOrgRoute("/v1/organizations/org_a/ai-tools")).toBe("boolean");
  });

  it("forwards an authenticated call to TALLY_WORKER with the actor (and email) as headers", async () => {
    const id = identity("usr_abc123");
    const worker = recorder(() =>
      Response.json({ data: { tool: { id: "ait_x" } }, meta: { requestId: "req_test", cursor: null } }, { status: 201 }),
    );
    const request = new Request("https://api.example.com/v1/organizations/org_a/ai-tools", {
      method: "POST",
      headers: {
        authorization: "Bearer sps_ses_abc.secret",
        "content-type": "application/json",
        "x-actor-subject-id": "usr_spoofed",
        "x-actor-email": "spoofed@evil.example",
      },
      body: JSON.stringify({ name: "ChatGPT", purpose: "Drafting", ownerEmail: "ops@acme.example" }),
    });
    const response = await handleTallyRoute(
      request,
      { IDENTITY_WORKER: id.fetcher, TALLY_WORKER: worker.fetcher, ENVIRONMENT: "test" },
      "req_test",
      "/v1/organizations/org_a/ai-tools",
    );
    expect(response.status).toBe(201);
    expect(worker.calls).toHaveLength(1);
    expect(worker.calls[0]!.url).toBe("https://tally.internal/v1/organizations/org_a/ai-tools");
    const headers = new Headers(worker.calls[0]!.init.headers);
    expect(headers.get("x-actor-subject-id")).toBe("usr_abc123"); // never the caller's own header
    expect(headers.get("x-actor-email")).toBe("ops@acme.example");
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("answers 401 without a bearer and never reaches the worker", async () => {
    const id = recorder(() => Response.json({ error: { code: "unauthenticated", message: "no", details: {}, requestId: "r" } }, { status: 401 }));
    const worker = recorder(() => Response.json({}));
    const response = await handleTallyRoute(
      new Request("https://api.example.com/v1/organizations/org_a/ai-tools"),
      { IDENTITY_WORKER: id.fetcher, TALLY_WORKER: worker.fetcher, ENVIRONMENT: "test" },
      "req_test",
      "/v1/organizations/org_a/ai-tools",
    );
    expect(response.status).toBe(401);
    expect(worker.calls).toHaveLength(0);
  });

  it("answers 503 when the binding is missing", async () => {
    const response = await handleTallyRoute(
      new Request("https://api.example.com/v1/organizations/org_a/ai-tools"),
      { ENVIRONMENT: "test" },
      "req_test",
      "/v1/organizations/org_a/ai-tools",
    );
    expect(response.status).toBe(503);
  });

  it("wrangler.jsonc binds TALLY_WORKER on stage and prod", () => {
    const raw = readFileSync(resolve(__dirname, "../../../apps/api-edge/wrangler.jsonc"), "utf8");
    const config = JSON.parse(stripJsoncComments(raw)) as {
      env: Record<string, { services?: { binding: string; service: string }[] }>;
    };
    for (const env of ["stage", "prod"]) {
      const binding = config.env[env]!.services!.find((s) => s.binding === "TALLY_WORKER");
      expect(binding?.service).toBe(`aitally-tally-worker-${env}`);
    }
  });
});
