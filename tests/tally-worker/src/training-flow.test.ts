/* eslint-disable @typescript-eslint/no-explicit-any -- test payloads are asserted field by field */
import { createHash } from "node:crypto";
import { addDaysToDate, addMonthsToDate } from "@saas/contracts/tally";
import { route } from "@tally-worker/router";
import { runClock } from "@tally-worker/clock";
import { orgPublicId } from "@tally-worker/ids";
import { EMAILS, MEMBER, OWNER, STRANGER, VIEWER, as, json, seedMembership, world, type TestWorld } from "./harness";

const ORG_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG = orgPublicId(ORG_UUID);
const BASE = "https://tally.internal";
const T = `/v1/organizations/${ORG}/training`;

const today = (): string => new Date().toISOString().slice(0, 10);
const PDF = new TextEncoder().encode("%PDF-1.4\n% Using AI tools safely at Acme — v1\n%%EOF\n");
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

function call(w: TestWorld, path: string, init: RequestInit = {}): Promise<Response> {
  return route(new Request(`${BASE}${path}`, init), w.env);
}

function send(w: TestWorld, path: string, who: string, body: unknown, method = "POST"): Promise<Response> {
  return call(w, path, { method, headers: { ...as(who), "content-type": "application/json" }, body: JSON.stringify(body) });
}

const QUIZ = [
  { prompt: "May customer personal data go into a tool not approved for it?", options: ["Yes", "No"], correct: 1 },
  { prompt: "Who answers for a tool in the register?", options: ["Its owner", "Nobody", "The vendor"], correct: 0 },
];

async function tool(w: TestWorld): Promise<string> {
  const res = await send(w, `/v1/organizations/${ORG}/ai-tools`, OWNER, {
    name: "ChatGPT Team",
    purpose: "Drafting customer emails",
    ownerEmail: "tool.owner@acme.example",
    status: "approved",
    riskLevel: "limited",
  });
  expect(res.status).toBe(201);
  return (await json(res)).data.tool.id;
}

/** A published course with its material, tied to a tool; returns ids. */
async function course(w: TestWorld, overrides: Record<string, unknown> = {}): Promise<{ courseId: string; toolId: string; materialSha: string; materialId: string }> {
  const toolId = await tool(w);
  const created = await send(w, `${T}/courses`, OWNER, { title: "Using ChatGPT safely", toolId, quiz: QUIZ, ...overrides });
  expect(created.status).toBe(201);
  const c = (await json(created)).data.course;
  const up = await call(w, `${T}/courses/${c.id}/materials`, {
    method: "POST",
    headers: { ...as(OWNER), "content-type": "application/pdf", "x-filename": "safe-use.pdf" },
    body: PDF,
  });
  expect(up.status).toBe(201);
  const material = (await json(up)).data.material;
  const pub = await send(w, `${T}/courses/${c.id}`, OWNER, { status: "published" }, "PATCH");
  expect(pub.status).toBe(200);
  return { courseId: c.id, toolId, materialSha: material.sha256, materialId: material.id };
}

async function assign(w: TestWorld, courseId: string, body: unknown): Promise<Record<string, any>> {
  const res = await send(w, `${T}/courses/${courseId}/assign`, OWNER, body);
  expect(res.status).toBe(201);
  return (await json(res)).data;
}

function templateKeys(w: TestWorld): string[] {
  return (w.sent as { templateKey: string }[]).map((m) => m.templateKey);
}

describe("training courses and material", () => {
  it("stores material in R2 with its SHA-256 and serves the same bytes back", async () => {
    const w = world();
    const { courseId, materialSha, materialId } = await course(w);
    expect(materialSha).toBe(sha(PDF));
    expect(w.r2.puts).toHaveLength(1);
    expect(w.r2.puts[0]).toMatch(new RegExp(`^orgs/${ORG_UUID}/courses/[0-9a-f-]{36}/materials/[0-9a-f-]{36}$`));

    const got = await call(w, `${T}/courses/${courseId}/materials/${materialId}`, { headers: as(VIEWER) });
    expect(got.status).toBe(200);
    expect(got.headers.get("x-content-sha256")).toBe(sha(PDF));
    const bytes = new Uint8Array(await got.arrayBuffer());
    expect(sha(bytes)).toBe(sha(PDF));

    // A second upload is version 2 under a new key; version 1 is untouched.
    const v2 = new TextEncoder().encode("%PDF-1.4\n% v2\n%%EOF\n");
    const up2 = await call(w, `${T}/courses/${courseId}/materials`, {
      method: "POST",
      headers: { ...as(MEMBER), "content-type": "application/pdf" },
      body: v2,
    });
    expect((await json(up2)).data.material.version).toBe(2);
    expect(w.r2.puts).toHaveLength(2);
    const detail = (await json(await call(w, `${T}/courses/${courseId}`, { headers: as(OWNER) }))).data;
    expect(detail.course.currentMaterial.sha256).toBe(sha(v2));
    expect(detail.materials.map((m: any) => m.version)).toEqual([2, 1]);
  });

  it("refuses the wrong content type, hides the quiz answers from readers, and keeps viewers and strangers out", async () => {
    const w = world();
    const { courseId } = await course(w);
    const txt = await call(w, `${T}/courses/${courseId}/materials`, {
      method: "POST",
      headers: { ...as(OWNER), "content-type": "text/plain" },
      body: "hello",
    });
    expect(txt.status).toBe(415);

    const asViewer = (await json(await call(w, `${T}/courses/${courseId}`, { headers: as(VIEWER) }))).data.course;
    expect(asViewer.quiz[0]).not.toHaveProperty("correct");
    const asOwner = (await json(await call(w, `${T}/courses/${courseId}`, { headers: as(OWNER) }))).data.course;
    expect(asOwner.quiz[0].correct).toBe(1);

    expect((await send(w, `${T}/courses`, VIEWER, { title: "x" })).status).toBe(404);
    expect((await call(w, `${T}/courses`, { headers: as(STRANGER) })).status).toBe(404);
    expect((await call(w, `${T}/courses/${courseId}`, { headers: as(STRANGER) })).status).toBe(404);
    expect((await call(w, `${T}/courses`)).status).toBe(401);
  });

  it("will not assign a draft course, or a course with no material", async () => {
    const w = world();
    const created = await send(w, `${T}/courses`, OWNER, { title: "Draft" });
    const id = (await json(created)).data.course.id;
    expect((await send(w, `${T}/courses/${id}/assign`, OWNER, { emails: ["a@acme.example"] })).status).toBe(409);
    await send(w, `${T}/courses/${id}`, OWNER, { status: "published" }, "PATCH");
    expect((await send(w, `${T}/courses/${id}/assign`, OWNER, { emails: ["a@acme.example"] })).status).toBe(409);
  });
});

describe("assignments and completion", () => {
  it("assigns by email once per open cycle and emails each assignee", async () => {
    const w = world();
    const { courseId } = await course(w);
    const first = await assign(w, courseId, { emails: [EMAILS[VIEWER], "New.Starter@Acme.example"] });
    expect(first.created).toHaveLength(2);
    expect(first.created[0].id).toMatch(/^ata_[0-9a-f]{32}$/);
    expect(first.created[0].dueOn).toBe(addDaysToDate(today(), 30));
    expect(first.created.map((a: any) => a.assigneeEmail)).toContain("new.starter@acme.example");
    expect(first.notified).toBe(2);
    expect(templateKeys(w).filter((k) => k === "tally.training.assigned")).toHaveLength(2);

    const again = await assign(w, courseId, { emails: [EMAILS[VIEWER]] });
    expect(again.created).toHaveLength(0);
    expect(again.skipped).toEqual([EMAILS[VIEWER]]);
  });

  it("lets only the assignee complete, records score, time and the material hash, and never rewrites it", async () => {
    const w = world();
    seedMembership(w.db, ORG_UUID);
    const { courseId, materialSha } = await course(w);
    const { created } = await assign(w, courseId, { emails: [EMAILS[VIEWER]] });
    const ata = created[0].id;
    const complete = `${T}/assignments/${ata}/complete`;

    // Not the assignee: the owner, a builder and a stranger all get 404.
    for (const who of [OWNER, MEMBER, STRANGER]) {
      expect((await send(w, complete, who, { answers: [1, 0] })).status).toBe(404);
    }
    // Wrong material hash: the assignee opened an old version.
    expect((await send(w, complete, VIEWER, { answers: [1, 0], materialSha256: "0".repeat(64) })).status).toBe(409);
    // A failed attempt is recorded; the assignment stays open.
    const fail = await json(await send(w, complete, VIEWER, { answers: [0, 0] }));
    expect(fail.data.attempt).toEqual({ scorePct: 50, passed: false });
    expect(fail.data.assignment.status).toBe("open");
    expect(fail.data.assignment.attemptCount).toBe(1);
    // A pass completes it.
    const pass = await json(await send(w, complete, VIEWER, { answers: [1, 0], materialSha256: materialSha }));
    expect(pass.data.attempt).toEqual({ scorePct: 100, passed: true });
    const a = pass.data.assignment;
    expect(a.status).toBe("completed");
    expect(a.scorePct).toBe(100);
    expect(a.materialSha256).toBe(sha(PDF));
    expect(a.materialVersion).toBe(1);
    expect(a.attemptCount).toBe(2);
    expect(a.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Written once.
    expect((await send(w, complete, VIEWER, { answers: [1, 0] })).status).toBe(409);
    const attempts = w.db.prepare("SELECT score_pct, passed FROM tally_quiz_attempts ORDER BY attempted_at, rowid").all();
    expect(attempts).toEqual([
      { score_pct: 50, passed: 0 },
      { score_pct: 100, passed: 1 },
    ]);
    const audit = (w.db.prepare("SELECT event_type FROM events_audit_entries").all() as { event_type: string }[]).map((r) => r.event_type);
    expect(audit).toEqual(
      expect.arrayContaining(["tally.course.created", "tally.course.material_uploaded", "tally.assignment.created", "tally.assignment.completed"]),
    );
  });

  it("completes a course without a quiz on confirmation", async () => {
    const w = world();
    const { courseId } = await course(w, { quiz: null });
    const { created } = await assign(w, courseId, { emails: [EMAILS[MEMBER]] });
    const res = await json(await send(w, `${T}/assignments/${created[0].id}/complete`, MEMBER, {}));
    expect(res.data.assignment.status).toBe("completed");
    expect(res.data.assignment.scorePct).toBeNull();
  });

  it("assigns everyone and the users of a tool, resolving membership's usr_ subject ids (trap 39)", async () => {
    const w = world();
    seedMembership(w.db, ORG_UUID, "public");
    const { courseId, toolId } = await course(w);
    const everyone = await assign(w, courseId, { everyone: true });
    expect(everyone.created.map((a: any) => a.assigneeEmail).sort()).toEqual(
      [EMAILS[OWNER], EMAILS[MEMBER], EMAILS[VIEWER]].sort(),
    );

    const w2 = world();
    const c2 = await course(w2);
    const users = await send(w2, `/v1/organizations/${ORG}/ai-tools/${c2.toolId}/users`, OWNER, { emails: ["b@acme.example", "A@acme.example"] }, "PUT");
    expect((await json(users)).data.emails).toEqual(["a@acme.example", "b@acme.example"]);
    const byTool = await assign(w2, c2.courseId, { toolUsers: true });
    expect(byTool.created.map((a: any) => a.assigneeEmail).sort()).toEqual(["a@acme.example", "b@acme.example"]);
    expect(toolId).toMatch(/^ait_/);
  });

  it("GET /v1/me/training returns only the caller's assignments, in orgs they belong to", async () => {
    const w = world();
    seedMembership(w.db, ORG_UUID, "public");
    const { courseId } = await course(w);
    await assign(w, courseId, { emails: [EMAILS[VIEWER], EMAILS[MEMBER]] });
    const mine = (await json(await call(w, "/v1/me/training", { headers: as(VIEWER) }))).data.assignments;
    expect(mine).toHaveLength(1);
    expect(mine[0].assigneeEmail).toBe(EMAILS[VIEWER]);
    expect(mine[0].orgName).toBe("Acme Ltd");
    expect(mine[0].material.sha256).toBe(sha(PDF));
    expect(mine[0].quiz[0]).not.toHaveProperty("correct");
    // Assigned by address, but not a member of the org: nothing.
    await assign(w, courseId, { emails: [EMAILS[STRANGER]] });
    expect((await json(await call(w, "/v1/me/training", { headers: as(STRANGER) }))).data.assignments).toEqual([]);
    expect((await call(w, "/v1/me/training")).status).toBe(401);
  });
});

describe("the training clock", () => {
  const LADDER: [number, string][] = [
    [7, "d7"],
    [1, "d1"],
    [0, "d0"],
    [-3, "late3"],
    [-7, "late7"],
    [-14, "late14"],
  ];

  it("sends each rung once across two ticks on the same day, escalating late rungs", async () => {
    const w = world();
    seedMembership(w.db, ORG_UUID, "public");
    const { courseId } = await course(w);
    const byEmail = new Map<string, number>();
    for (const [offset] of LADDER) {
      const email = `due${offset}@acme.example`;
      byEmail.set(email, offset);
      await assign(w, courseId, { emails: [email], dueOn: addDaysToDate(today(), offset) });
    }
    await assign(w, courseId, { emails: ["later@acme.example"], dueOn: addDaysToDate(today(), 20) });
    w.sent.length = 0;

    const now = new Date();
    const first = await runClock(w.env, now);
    expect(first.considered).toBe(6);
    expect(first.claimed).toHaveLength(6);
    const rungs = Object.fromEntries(first.claimed.map((c) => [c.rung, c]));
    for (const [, rung] of LADDER) expect(rungs[rung]).toBeDefined();
    expect(rungs.d7!.recipients).toEqual(["due7@acme.example"]);
    expect(rungs.late3!.recipients).toEqual(["due-3@acme.example", "tool.owner@acme.example"]);
    expect(rungs.late7!.recipients).toEqual(["due-7@acme.example", "tool.owner@acme.example"]);
    // late14 reaches the org owner, found through membership's usr_ id (trap 39).
    expect(rungs.late14!.recipients).toEqual(["due-14@acme.example", EMAILS[OWNER]]);
    for (const c of first.claimed) expect(c.notified).toBe(c.recipients.length);
    const reminders = (w.sent as { templateKey: string }[]).filter((m) => m.templateKey === "tally.training.reminder");
    expect(reminders).toHaveLength(9);

    const second = await runClock(w.env, now);
    expect(second.claimed).toHaveLength(0);
    expect(second.alreadySent).toBe(6);
    expect((w.sent as { templateKey: string }[]).filter((m) => m.templateKey === "tally.training.reminder")).toHaveLength(9);
    expect((w.db.prepare("SELECT COUNT(*) AS n FROM tally_reminders").get() as { n: number }).n).toBe(6);
  });

  it("the org sweep route runs the same clock for writers only", async () => {
    const w = world();
    const { courseId } = await course(w);
    await assign(w, courseId, { emails: ["x@acme.example"], dueOn: today() });
    expect((await send(w, `${T}/sweep`, VIEWER, {})).status).toBe(404);
    const r1 = (await json(await send(w, `${T}/sweep`, OWNER, {}))).data;
    expect(r1.claimed.map((c: any) => c.rung)).toEqual(["d0"]);
    const r2 = (await json(await send(w, `${T}/sweep`, OWNER, {}))).data;
    expect(r2.claimed).toEqual([]);
    expect(r2.alreadySent).toBe(1);
  });

  it("re-assigns a completion recurrence_months old exactly once", async () => {
    const w = world();
    const { courseId } = await course(w);
    const { created } = await assign(w, courseId, { emails: [EMAILS[VIEWER]] });
    await send(w, `${T}/assignments/${created[0].id}/complete`, VIEWER, { answers: [1, 0] });

    const early = await runClock(w.env, new Date(`${addMonthsToDate(today(), 11)}T07:00:00Z`));
    expect(early.reassigned).toHaveLength(0);
    const anniversary = new Date(`${addMonthsToDate(today(), 12)}T07:00:00Z`);
    const tick1 = await runClock(w.env, anniversary);
    expect(tick1.reassigned).toHaveLength(1);
    expect(tick1.reassigned[0]!.cycle).toBe(2);
    expect(tick1.reassigned[0]!.dueOn).toBe(addDaysToDate(anniversary.toISOString().slice(0, 10), 30));
    const tick2 = await runClock(w.env, anniversary);
    expect(tick2.reassigned).toHaveLength(0);
    const rows = w.db.prepare("SELECT cycle, status FROM tally_assignments ORDER BY cycle").all();
    expect(rows).toEqual([
      { cycle: 1, status: "completed" },
      { cycle: 2, status: "open" },
    ]);
  });

  it("does not re-assign a course that recurs never (0 months)", async () => {
    const w = world();
    const { courseId } = await course(w, { recurrenceMonths: 0 });
    const { created } = await assign(w, courseId, { emails: [EMAILS[VIEWER]] });
    await send(w, `${T}/assignments/${created[0].id}/complete`, VIEWER, { answers: [1, 0] });
    const later = await runClock(w.env, new Date(`${addMonthsToDate(today(), 30)}T07:00:00Z`));
    expect(later.reassigned).toHaveLength(0);
  });
});
