/* eslint-disable @typescript-eslint/no-explicit-any -- test payloads are asserted field by field */
import { createHash } from "node:crypto";
import { route } from "@tally-worker/router";
import { orgPublicId } from "@tally-worker/ids";
import { EMAILS, MEMBER, OWNER, STRANGER, VIEWER, as, json, seedMembership, world, type TestWorld } from "./harness";

const ORG_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG = orgPublicId(ORG_UUID);
const BASE = "https://tally.internal";
const O = `/v1/organizations/${ORG}`;
const PDF = new TextEncoder().encode("%PDF-1.4\n% course\n%%EOF\n");
const sha = (b: Uint8Array | string): string => createHash("sha256").update(b).digest("hex");

function call(w: TestWorld, path: string, init: RequestInit = {}): Promise<Response> {
  return route(new Request(`${BASE}${path}`, init), w.env);
}

function send(w: TestWorld, path: string, who: string, body: unknown, method = "POST"): Promise<Response> {
  return call(w, path, { method, headers: { ...as(who), "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function ok(res: Promise<Response>, status = 200): Promise<Record<string, any>> {
  const r = await res;
  expect(r.status).toBe(status);
  return (await json(r)).data;
}

/**
 * An org with two tools (one retired after a review), a course for the live
 * tool, and three people assigned: the viewer completes, the builder does not.
 */
async function populated(w: TestWorld): Promise<{ live: string; retired: string; courseId: string }> {
  seedMembership(w.db, ORG_UUID);
  const live = (await ok(send(w, `${O}/ai-tools`, OWNER, { name: "ChatGPT Team", purpose: "Drafting, \"quoted\", with commas", ownerEmail: "ops@acme.example", status: "approved", riskLevel: "limited" }), 201)).tool.id;
  const retired = (await ok(send(w, `${O}/ai-tools`, OWNER, { name: "=Old transcriber", purpose: "Meeting notes", ownerEmail: "ops@acme.example" }), 201)).tool.id;
  await ok(send(w, `${O}/ai-tools/${retired}/reviews`, OWNER, { decision: "retired", riskLevel: "limited", notes: "Replaced" }), 201);
  const courseId = (await ok(send(w, `${O}/training/courses`, OWNER, { title: "Using ChatGPT safely", toolId: live, quiz: [{ prompt: "Q", options: ["a", "b"], correct: 1 }] }), 201)).course.id;
  await ok(call(w, `${O}/training/courses/${courseId}/materials`, { method: "POST", headers: { ...as(OWNER), "content-type": "application/pdf" }, body: PDF }), 201);
  await ok(send(w, `${O}/training/courses/${courseId}`, OWNER, { status: "published" }, "PATCH"));
  const { created } = await ok(send(w, `${O}/training/courses/${courseId}/assign`, OWNER, { emails: [EMAILS[VIEWER], EMAILS[MEMBER], "third@acme.example"] }), 201);
  const viewerAssignment = created.find((a: any) => a.assigneeEmail === EMAILS[VIEWER]).id;
  await ok(send(w, `${O}/training/assignments/${viewerAssignment}/complete`, VIEWER, { answers: [1] }));
  return { live, retired, courseId };
}

async function fileBytes(w: TestWorld, packId: string, name: string): Promise<{ bytes: Uint8Array; header: string | null }> {
  const res = await call(w, `${O}/evidence-packs/${packId}/files/${name}`, { headers: as(VIEWER) });
  expect(res.status).toBe(200);
  return { bytes: new Uint8Array(await res.arrayBuffer()), header: res.headers.get("x-content-sha256") };
}

describe("evidence exports", () => {
  it("a per-employee export lists exactly that person's assignments, as JSON and CSV", async () => {
    const w = world();
    await populated(w);
    const viewer = await ok(call(w, `${O}/evidence/employees/${encodeURIComponent(EMAILS[VIEWER]!)}`, { headers: as(OWNER) }));
    expect(viewer.email).toBe(EMAILS[VIEWER]);
    expect(viewer.records).toHaveLength(1);
    expect(viewer.records[0].status).toBe("completed");
    expect(viewer.records[0].materialSha256).toBe(sha(PDF));
    expect(viewer.records.every((r: any) => r.assigneeEmail === EMAILS[VIEWER])).toBe(true);

    const csv = await call(w, `${O}/evidence/employees/${encodeURIComponent(EMAILS[MEMBER]!.toUpperCase())}?format=csv`, { headers: as(VIEWER) });
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const lines = (await csv.text()).trim().split("\r\n");
    expect(lines[0]).toBe("assignment_id,course_id,course_title,tool_id,assignee_email,cycle,assigned_on,due_on,status,completed_at,score_pct,material_version,material_sha256,attempts");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(EMAILS[MEMBER]);
    expect(lines[1]).not.toContain(EMAILS[VIEWER]);

    const nobody = await ok(call(w, `${O}/evidence/employees/nobody%40acme.example`, { headers: as(OWNER) }));
    expect(nobody.records).toEqual([]);
    expect((await call(w, `${O}/evidence/employees/${encodeURIComponent(EMAILS[VIEWER]!)}`, { headers: as(STRANGER) })).status).toBe(404);
  });

  it("a per-tool export carries the tool, its reviews and the training for it", async () => {
    const w = world();
    const { live, retired } = await populated(w);
    const t = await ok(call(w, `${O}/evidence/tools/${live}`, { headers: as(VIEWER) }));
    expect(t.tool.id).toBe(live);
    expect(t.records).toHaveLength(3);
    const r = await ok(call(w, `${O}/evidence/tools/${retired}`, { headers: as(VIEWER) }));
    expect(r.tool.status).toBe("retired");
    expect(r.reviews).toHaveLength(1);
    expect(r.records).toEqual([]);
  });
});

describe("evidence packs", () => {
  it("builds an org pack whose every file matches the digest manifest.json lists, retired tools included", async () => {
    const w = world();
    const { retired } = await populated(w);
    const { pack } = await ok(send(w, `${O}/evidence-packs`, OWNER, { scope: "org" }), 201);
    expect(pack.id).toMatch(/^atx_[0-9a-f]{32}$/);
    expect(pack.files.map((f: any) => f.name)).toEqual(["register.csv", "reviews.csv", "training-records.csv", "summary.pdf", "manifest.json"]);

    const manifestFile = await fileBytes(w, pack.id, "manifest.json");
    expect(sha(manifestFile.bytes)).toBe(pack.manifestSha256);
    const manifest = JSON.parse(new TextDecoder().decode(manifestFile.bytes));
    expect(manifest.pack).toBe(pack.id);
    expect(manifest.organization).toBe(ORG);
    expect(manifest.organizationName).toBe("Acme Ltd");
    expect(manifest.files.map((f: any) => f.name)).toEqual(["register.csv", "reviews.csv", "training-records.csv", "summary.pdf"]);
    for (const f of manifest.files) {
      const got = await fileBytes(w, pack.id, f.name);
      expect(sha(got.bytes)).toBe(f.sha256);
      expect(got.header).toBe(f.sha256);
      expect(got.bytes.byteLength).toBe(f.byteSize);
    }

    const register = new TextDecoder().decode((await fileBytes(w, pack.id, "register.csv")).bytes);
    expect(register).toContain(retired);
    expect(register).toContain("'=Old transcriber"); // a formula-looking cell is neutralised
    expect(register).toContain('"Drafting, ""quoted"", with commas"');
    const reviews = new TextDecoder().decode((await fileBytes(w, pack.id, "reviews.csv")).bytes);
    expect(reviews).toContain(",retired,");
    const training = new TextDecoder().decode((await fileBytes(w, pack.id, "training-records.csv")).bytes).trim().split("\r\n");
    expect(training).toHaveLength(4);
    const pdf = new TextDecoder().decode((await fileBytes(w, pack.id, "summary.pdf")).bytes);
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("3 assignments to 3 people: 1 completed, 2 open");
    expect(pdf).toContain("It is not legal advice");

    const audit = (w.db.prepare("SELECT event_type FROM events_audit_entries WHERE event_type = 'tally.evidence_pack.created'").all() as unknown[]).length;
    expect(audit).toBe(1);
  });

  it("never overwrites: a second pack is a new atx_ under new keys, and the first pack's objects are untouched", async () => {
    const w = world();
    await populated(w);
    const first = (await ok(send(w, `${O}/evidence-packs`, OWNER, { scope: "org" }), 201)).pack;
    const before = new Map([...w.r2.objects].map(([k, v]) => [k, sha(v.bytes)]));
    await ok(send(w, `${O}/ai-tools`, OWNER, { name: "Copilot", purpose: "Code", ownerEmail: "dev@acme.example" }), 201);
    const second = (await ok(send(w, `${O}/evidence-packs`, OWNER, { scope: "org" }), 201)).pack;
    expect(second.id).not.toBe(first.id);
    expect(second.manifestSha256).not.toBe(first.manifestSha256);
    for (const [k, digest] of before) expect(sha(w.r2.objects.get(k)!.bytes)).toBe(digest);
    const firstKeys = [...before.keys()].filter((k) => k.includes("/packs/"));
    expect(firstKeys).toHaveLength(5);
    expect(w.r2.puts.filter((k) => k.includes("/packs/"))).toHaveLength(10);
    expect(new Set(w.r2.puts).size).toBe(w.r2.puts.length); // every put was to a fresh key
    const list = await ok(call(w, `${O}/evidence-packs`, { headers: as(VIEWER) }));
    expect(list.packs.map((p: any) => p.id)).toEqual([second.id, first.id]);
    // There is no route that changes a pack.
    expect((await send(w, `${O}/evidence-packs/${first.id}`, OWNER, { scope: "org" }, "PUT")).status).toBe(405);
    expect((await call(w, `${O}/evidence-packs/${first.id}`, { method: "DELETE", headers: as(OWNER) })).status).toBe(405);
  });

  it("refuses to overwrite an existing object (the conditional put)", async () => {
    const w = world();
    await populated(w);
    const realPut = w.r2.bucket.put.bind(w.r2.bucket);
    // Force a key collision: pretend every key already exists.
    (w.r2.bucket as any).put = async (key: string, value: Uint8Array, opts: any) => {
      w.r2.objects.set(key, { bytes: new Uint8Array([1]), contentType: "x", custom: {} });
      return realPut(key, value, opts);
    };
    expect((await send(w, `${O}/evidence-packs`, OWNER, { scope: "org" })).status).toBe(503);
    expect((w.db.prepare("SELECT COUNT(*) AS n FROM tally_evidence_packs").get() as { n: number }).n).toBe(0);
  });

  it("builds employee and tool packs scoped to their subject; viewers and strangers cannot build", async () => {
    const w = world();
    const { live } = await populated(w);
    const emp = (await ok(send(w, `${O}/evidence-packs`, OWNER, { scope: "employee", subject: EMAILS[MEMBER] }), 201)).pack;
    expect(emp.subject).toBe(EMAILS[MEMBER]);
    const rows = new TextDecoder().decode((await fileBytes(w, emp.id, "training-records.csv")).bytes).trim().split("\r\n");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain(EMAILS[MEMBER]);
    const tool = (await ok(send(w, `${O}/evidence-packs`, OWNER, { scope: "tool", subject: live }), 201)).pack;
    expect(tool.subject).toBe(live);
    const reg = new TextDecoder().decode((await fileBytes(w, tool.id, "register.csv")).bytes).trim().split("\r\n");
    expect(reg).toHaveLength(2);

    expect((await send(w, `${O}/evidence-packs`, OWNER, { scope: "employee" })).status).toBe(422);
    expect((await send(w, `${O}/evidence-packs`, OWNER, { scope: "org", subject: "x" })).status).toBe(422);
    expect((await send(w, `${O}/evidence-packs`, VIEWER, { scope: "org" })).status).toBe(404);
    expect((await send(w, `${O}/evidence-packs`, STRANGER, { scope: "org" })).status).toBe(404);
    expect((await call(w, `${O}/evidence-packs/${tool.id}/files/manifest.json`, { headers: as(STRANGER) })).status).toBe(404);
    expect((await call(w, `${O}/evidence-packs/${tool.id}/files/secrets.txt`, { headers: as(OWNER) })).status).toBe(404);
    expect((await call(w, `${O}/evidence-packs`)).status).toBe(401);
  });
});
