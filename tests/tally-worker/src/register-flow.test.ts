/* eslint-disable @typescript-eslint/no-explicit-any -- test payloads are asserted field by field */
import { addMonthsToDate } from "@saas/contracts/tally";
import { route } from "@tally-worker/router";
import { orgPublicId } from "@tally-worker/ids";
import { MEMBER, OWNER, STRANGER, VIEWER, as, json, world, type TestWorld } from "./harness";

const ORG_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG = orgPublicId(ORG_UUID);
const OTHER_ORG = orgPublicId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const BASE = "https://tally.internal";
const TOOLS = `/v1/organizations/${ORG}/ai-tools`;

const today = (): string => new Date().toISOString().slice(0, 10);

function call(w: TestWorld, path: string, init: RequestInit = {}): Promise<Response> {
  return route(new Request(`${BASE}${path}`, init), w.env);
}

function send(w: TestWorld, path: string, who: string, body: unknown, method = "POST"): Promise<Response> {
  return call(w, path, {
    method,
    headers: { ...as(who), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function register(w: TestWorld, overrides: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const res = await send(w, TOOLS, OWNER, {
    name: "ChatGPT Team",
    vendor: "OpenAI",
    websiteUrl: "https://chatgpt.com",
    category: "general_assistant",
    purpose: "Drafting customer emails and summarising meeting notes",
    dataCategories: ["internal", "customer_personal"],
    riskLevel: "limited",
    status: "approved",
    ownerEmail: "Ops.Lead@Acme.example",
    usersDescription: "Sales and support, about 14 people",
    ...overrides,
  });
  expect(res.status).toBe(201);
  return (await json(res)).data;
}

function auditTypes(w: TestWorld): string[] {
  return (w.db.prepare("SELECT event_type FROM events_audit_entries ORDER BY occurred_at, rowid").all() as { event_type: string }[]).map(
    (r) => r.event_type,
  );
}

describe("the AI tool register", () => {
  it("registers a tool, emails its owner once, and audits the write", async () => {
    const w = world();
    const { tool, ownerNotified } = await register(w);
    expect(tool.id).toMatch(/^ait_[0-9a-f]{32}$/);
    expect(tool.orgId).toBe(ORG);
    expect(tool.ownerEmail).toBe("ops.lead@acme.example");
    expect(tool.dataCategories).toEqual(["customer_personal", "internal"]); // stored sorted
    expect(tool.actRole).toBe("deployer");
    expect(tool.reviewIntervalMonths).toBe(12);
    expect(tool.lastReviewedOn).toBeNull();
    expect(tool.nextReviewOn).toBe(addMonthsToDate(today(), 12));
    expect(tool.reviewDue).toBe(false);
    expect(ownerNotified).toBe(true);

    expect(w.sent).toHaveLength(1);
    const mail = w.sent[0] as Record<string, any>;
    expect(mail.templateKey).toBe("tally.tool.owner_assigned");
    expect(mail.recipient).toEqual({ channel: "email", address: "ops.lead@acme.example" });
    expect(mail.templateData.toolName).toBe("ChatGPT Team");

    const audit = w.db.prepare("SELECT event_type, category, org_id FROM events_audit_entries").all() as {
      event_type: string;
      category: string;
      org_id: string;
    }[];
    expect(audit).toEqual([{ event_type: "tally.tool.created", category: "tally", org_id: ORG_UUID }]);
  });

  it("defaults what the pitch leaves open: unassessed, proposed, deployer, 12 months", async () => {
    const w = world();
    const res = await send(w, TOOLS, MEMBER, { name: "Copilot", purpose: "Code completion", ownerEmail: "cto@acme.example" });
    expect(res.status).toBe(201);
    const tool = (await json(res)).data.tool;
    expect([tool.riskLevel, tool.status, tool.actRole, tool.category]).toEqual(["unassessed", "proposed", "deployer", "other"]);
    expect(tool.dataCategories).toEqual([]);
  });

  it("lists the register with a summary over every tool, whatever the filter", async () => {
    const w = world();
    await register(w);
    await register(w, { name: "Otter", category: "meeting_assistant", riskLevel: "minimal", dataCategories: ["internal"] });
    await register(w, { name: "Old bot", status: "retired", riskLevel: "high", dataCategories: ["employee_personal"] });

    const all = await json(await call(w, TOOLS, { headers: as(VIEWER) }));
    expect(all.data.tools.map((t: { name: string }) => t.name)).toEqual(["ChatGPT Team", "Old bot", "Otter"]);
    expect(all.data.summary).toMatchObject({
      total: 3,
      inUse: 2,
      reviewsDue: 0,
      withPersonalData: 1, // the retired tool's personal data is not "in use"
      byStatus: { approved: 2, retired: 1 },
      byRiskLevel: { limited: 1, minimal: 1, high: 0 },
    });

    const retired = await json(await call(w, `${TOOLS}?status=retired`, { headers: as(OWNER) }));
    expect(retired.data.tools).toHaveLength(1);
    expect(retired.data.summary.total).toBe(3);
    expect((await call(w, `${TOOLS}?riskLevel=extreme`, { headers: as(OWNER) })).status).toBe(422);
  });

  it("validates the fields and refuses a prohibited practice on a tool still in use", async () => {
    const w = world();
    const bad = await send(w, TOOLS, OWNER, {
      name: "",
      purpose: "x",
      ownerEmail: "not-an-email",
      websiteUrl: "http://insecure.example",
      dataCategories: ["internal", "internal"],
      reviewIntervalMonths: 36,
      category: "robot",
    });
    expect(bad.status).toBe(422);
    expect(Object.keys((await json(bad)).error.details.fields).sort()).toEqual(
      ["category", "dataCategories", "name", "ownerEmail", "reviewIntervalMonths", "websiteUrl"].sort(),
    );

    const prohibited = await send(w, TOOLS, OWNER, {
      name: "Emotion scanner",
      purpose: "Inferring emotions of staff at work",
      ownerEmail: "hr@acme.example",
      riskLevel: "prohibited",
      status: "approved",
    });
    expect(prohibited.status).toBe(422);
    expect(Object.keys((await json(prohibited)).error.details.fields)).toEqual(["riskLevel"]);

    const blocked = await register(w, { name: "Emotion scanner", riskLevel: "prohibited", status: "blocked" });
    // A patch that only changes the status is checked against the merged tool.
    const reopen = await send(w, `${TOOLS}/${blocked.tool.id}`, OWNER, { status: "approved" }, "PATCH");
    expect(reopen.status).toBe(422);
  });

  it("patches a tool, re-derives the next review when the interval changes, and re-notifies a new owner", async () => {
    const w = world();
    const { tool } = await register(w);
    const patched = await json(
      await send(w, `${TOOLS}/${tool.id}`, MEMBER, { reviewIntervalMonths: 6, ownerEmail: "dpo@acme.example" }, "PATCH"),
    );
    expect(patched.data.tool.reviewIntervalMonths).toBe(6);
    expect(patched.data.tool.nextReviewOn).toBe(addMonthsToDate(tool.createdAt.slice(0, 10), 6));
    expect(patched.data.tool.purpose).toBe(tool.purpose); // absent fields keep their value
    expect(patched.data.ownerNotified).toBe(true);
    expect(w.sent.map((m) => (m as Record<string, any>).recipient.address)).toEqual([
      "ops.lead@acme.example",
      "dpo@acme.example",
    ]);

    const again = await json(await send(w, `${TOOLS}/${tool.id}`, MEMBER, { notes: "Enterprise plan" }, "PATCH"));
    expect(again.data.ownerNotified).toBe(false);
    expect(w.sent).toHaveLength(2);
    expect(auditTypes(w)).toEqual(["tally.tool.created", "tally.tool.updated", "tally.tool.updated"]);
  });
});

describe("tool reviews", () => {
  it("records a dated review that sets status and risk and moves the next review a year out", async () => {
    const w = world();
    const { tool } = await register(w, { status: "proposed", riskLevel: "unassessed" });
    const res = await send(w, `${TOOLS}/${tool.id}/reviews`, OWNER, {
      reviewedOn: "2026-03-31",
      decision: "restricted",
      riskLevel: "limited",
      notes: "No customer personal data without the DPA addendum",
    });
    expect(res.status).toBe(201);
    const body = (await json(res)).data;
    expect(body.review.id).toMatch(/^atr_[0-9a-f]{32}$/);
    expect(body.review.reviewerEmail).toBe("owner@acme.example");
    expect(body.applied).toBe(true);
    expect(body.tool.status).toBe("restricted");
    expect(body.tool.riskLevel).toBe("limited");
    expect(body.tool.lastReviewedOn).toBe("2026-03-31");
    expect(body.tool.nextReviewOn).toBe("2027-03-31");

    const detail = await json(await call(w, `${TOOLS}/${tool.id}`, { headers: as(VIEWER) }));
    expect(detail.data.reviews).toHaveLength(1);
    expect(detail.data.tool.status).toBe("restricted");
    expect(auditTypes(w)).toEqual(["tally.tool.created", "tally.tool.reviewed"]);
  });

  it("keeps a back-dated review in the history without rolling the register back", async () => {
    const w = world();
    const { tool } = await register(w);
    await send(w, `${TOOLS}/${tool.id}/reviews`, OWNER, { reviewedOn: "2026-06-01", decision: "approved", riskLevel: "minimal" });
    const late = await json(
      await send(w, `${TOOLS}/${tool.id}/reviews`, OWNER, { reviewedOn: "2026-01-15", decision: "restricted", riskLevel: "high" }),
    );
    expect(late.data.applied).toBe(false);
    expect(late.data.tool.status).toBe("approved");
    expect(late.data.tool.lastReviewedOn).toBe("2026-06-01");
    const detail = await json(await call(w, `${TOOLS}/${tool.id}`, { headers: as(OWNER) }));
    expect(detail.data.reviews.map((r: { reviewedOn: string }) => r.reviewedOn)).toEqual(["2026-06-01", "2026-01-15"]);
  });

  it("flags a review as due once its date has passed, and a retired tool never is", async () => {
    const w = world();
    const { tool } = await register(w, { reviewIntervalMonths: 1 });
    await send(w, `${TOOLS}/${tool.id}/reviews`, OWNER, { reviewedOn: "2020-01-10", decision: "approved", riskLevel: "minimal" });
    const due = await json(await call(w, `${TOOLS}/${tool.id}`, { headers: as(OWNER) }));
    expect(due.data.tool.nextReviewOn).toBe("2020-02-10");
    expect(due.data.tool.reviewDue).toBe(true);
    const list = await json(await call(w, TOOLS, { headers: as(OWNER) }));
    expect(list.data.summary.reviewsDue).toBe(1);

    await send(w, `${TOOLS}/${tool.id}/reviews`, OWNER, { decision: "retired", riskLevel: "minimal" });
    const retired = await json(await call(w, `${TOOLS}/${tool.id}`, { headers: as(OWNER) }));
    expect(retired.data.tool.status).toBe("retired");
    expect(retired.data.tool.reviewDue).toBe(false);
  });

  it("refuses a future date, a prohibited approval, and an unknown decision", async () => {
    const w = world();
    const { tool } = await register(w);
    const path = `${TOOLS}/${tool.id}/reviews`;
    expect((await send(w, path, OWNER, { reviewedOn: "2999-01-01", decision: "approved", riskLevel: "minimal" })).status).toBe(422);
    const prohibited = await send(w, path, OWNER, { decision: "approved", riskLevel: "prohibited" });
    expect(prohibited.status).toBe(422);
    expect((await send(w, path, OWNER, { decision: "proposed", riskLevel: "minimal" })).status).toBe(422);
    const blocked = await json(await send(w, path, OWNER, { decision: "blocked", riskLevel: "prohibited" }));
    expect(blocked.data.tool.status).toBe("blocked");
    expect(blocked.data.tool.riskLevel).toBe("prohibited");
  });
});

describe("tenancy and access", () => {
  it("is invisible to a non-member and read-only to a viewer — 404, never 403", async () => {
    const w = world();
    const { tool } = await register(w);
    expect((await call(w, TOOLS, { headers: as(STRANGER) })).status).toBe(404);
    expect((await call(w, `${TOOLS}/${tool.id}`, { headers: as(STRANGER) })).status).toBe(404);
    expect((await call(w, `${TOOLS}/${tool.id}`, { headers: as(VIEWER) })).status).toBe(200);
    expect((await send(w, TOOLS, VIEWER, { name: "A", purpose: "B", ownerEmail: "c@acme.example" })).status).toBe(404);
    expect((await send(w, `${TOOLS}/${tool.id}`, VIEWER, { notes: "x" }, "PATCH")).status).toBe(404);
    expect(
      (await send(w, `${TOOLS}/${tool.id}/reviews`, VIEWER, { decision: "approved", riskLevel: "minimal" })).status,
    ).toBe(404);
  });

  it("never serves one org's tool under another org's path", async () => {
    const w = world();
    const { tool } = await register(w);
    expect((await call(w, `/v1/organizations/${OTHER_ORG}/ai-tools/${tool.id}`, { headers: as(OWNER) })).status).toBe(404);
  });

  it("answers 401 without an actor, 404 for a malformed id, 405 for DELETE (nothing is deleted)", async () => {
    const w = world();
    const { tool } = await register(w);
    expect((await call(w, TOOLS)).status).toBe(401);
    expect((await call(w, `${TOOLS}/ait_nothex`, { headers: as(OWNER) })).status).toBe(404);
    expect((await call(w, `${TOOLS}/${tool.id}`, { method: "DELETE", headers: as(OWNER) })).status).toBe(405);
  });
});
