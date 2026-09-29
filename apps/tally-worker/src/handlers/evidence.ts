import {
  EVIDENCE_PACK_SCOPES,
  type EmployeeEvidenceResponse,
  type EvidenceManifest,
  type EvidencePackScope,
  type PublicEvidencePack,
  type ToolEvidenceResponse,
} from "@saas/contracts/tally";
import type { AiTool, EvidenceFileRow, EvidencePack, TrainingRecordRow } from "@saas/db/tally";
import type { Env } from "../env.js";
import type { ActorContext } from "../router.js";
import { allowed } from "../authz.js";
import { recordAudit } from "../audit.js";
import { nowIso, openDb, todayUtc } from "../context.js";
import { sha256Hex } from "../digest.js";
import { registerCsv, reviewsCsv, summaryPdf, toEvidenceRecord, trainingRecordsCsv } from "../evidence.js";
import { errorResponse, notFound, successResponse, unavailable, validationError } from "../http.js";
import { actorSubjectUuid, orgPublicId, packPublicId, parseToolPublicId, toolPublicId } from "../ids.js";
import { toPublicReview, toPublicTool } from "../present.js";
import { EMAIL_RE, isObject } from "../validate.js";

const CSV = "text/csv; charset=utf-8";

function csvResponse(body: string, filename: string, requestId: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": CSV,
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
      "x-request-id": requestId,
    },
  });
}

function parseFormat(request: Request): "json" | "csv" | null {
  const f = new URL(request.url).searchParams.get("format") ?? "json";
  return f === "json" || f === "csv" ? f : null;
}

export function toPublicPack(p: EvidencePack): PublicEvidencePack {
  return {
    id: packPublicId(p.id),
    orgId: orgPublicId(p.orgId),
    scope: p.scope as EvidencePackScope,
    subject: p.scope === "tool" && p.subject ? toolPublicId(p.subject) : p.subject,
    asOf: p.asOf,
    files: p.files.map((f) => ({ name: f.name, contentType: f.contentType, byteSize: f.byteSize, sha256: f.sha256 })),
    manifestSha256: p.manifestSha256,
    requestedByEmail: p.requestedByEmail,
    createdAt: p.createdAt,
  };
}

// ── per-employee and per-tool exports ───────────────────────

/** GET /v1/organizations/{org}/evidence/employees/{email}?format=json|csv — exactly that person's training record. */
export async function handleEmployeeEvidence(
  request: Request,
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
  rawEmail: string,
): Promise<Response> {
  const format = parseFormat(request);
  if (!format) return validationError(requestId, { format: ["json or csv"] });
  let email: string;
  try {
    email = decodeURIComponent(rawEmail).trim().toLowerCase();
  } catch {
    return validationError(requestId, { email: ["Not an email address"] });
  }
  if (!EMAIL_RE.test(email) || email.length > 254) return validationError(requestId, { email: ["Not an email address"] });
  if (!(await allowed(env, actor, orgId, "tally.read", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  try {
    const records = (await db.evidence.listTrainingRecords(orgId, { email })).map(toEvidenceRecord);
    if (format === "csv") return csvResponse(trainingRecordsCsv(records), `training-records-${email.replace(/[^a-z0-9.@_-]/g, "_")}.csv`, requestId);
    const toolIds = (await db.evidence.listToolIdsForUser(orgId, email)).map(toolPublicId);
    const body: EmployeeEvidenceResponse = { email, asOf: nowIso(), records, toolIds };
    return successResponse(body, requestId);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

/** GET /v1/organizations/{org}/evidence/tools/{ait}?format=json|csv — the tool, its reviews, its users and the training for it. */
export async function handleToolEvidence(
  request: Request,
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
  toolId: string,
): Promise<Response> {
  const format = parseFormat(request);
  if (!format) return validationError(requestId, { format: ["json or csv"] });
  if (!(await allowed(env, actor, orgId, "tally.read", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  try {
    const tool = await db.tally.getTool(orgId, toolId);
    if (!tool) return notFound(requestId);
    const records = (await db.evidence.listTrainingRecords(orgId, { toolId })).map(toEvidenceRecord);
    if (format === "csv") return csvResponse(trainingRecordsCsv(records), `training-records-${toolPublicId(toolId)}.csv`, requestId);
    const reviews = await db.tally.listReviews(orgId, toolId);
    const body: ToolEvidenceResponse = {
      asOf: nowIso(),
      tool: toPublicTool(tool, todayUtc()),
      reviews: reviews.map(toPublicReview),
      userEmails: await db.training.listToolUsers(orgId, toolId),
      records,
    };
    return successResponse(body, requestId);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

// ── evidence packs ──────────────────────────────────────────

type PackTarget = { scope: "org"; subject: null } | { scope: "employee"; subject: string } | { scope: "tool"; subject: string };

function parsePackBody(body: unknown): { ok: true; value: PackTarget } | { ok: false; fields: Record<string, string[]> } {
  if (!isObject(body)) return { ok: false, fields: { body: ["Must be a JSON object"] } };
  const scope = body.scope;
  if (typeof scope !== "string" || !(EVIDENCE_PACK_SCOPES as readonly string[]).includes(scope)) {
    return { ok: false, fields: { scope: [`One of ${EVIDENCE_PACK_SCOPES.join(", ")}`] } };
  }
  const subject = body.subject;
  if (scope === "org") {
    if (subject !== undefined && subject !== null) return { ok: false, fields: { subject: ["An org pack has no subject"] } };
    return { ok: true, value: { scope, subject: null } };
  }
  if (typeof subject !== "string") return { ok: false, fields: { subject: ["Required"] } };
  if (scope === "employee") {
    const email = subject.trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) return { ok: false, fields: { subject: ["The employee's email address"] } };
    return { ok: true, value: { scope, subject: email } };
  }
  const tool = parseToolPublicId(subject);
  if (!tool) return { ok: false, fields: { subject: ["The tool's ait_ id"] } };
  return { ok: true, value: { scope: "tool", subject: tool } };
}

const enc = new TextEncoder();

/**
 * POST /v1/organizations/{org}/evidence-packs — build a pack and store it in R2
 * under orgs/{org}/packs/{pack}/: register.csv, reviews.csv,
 * training-records.csv, summary.pdf and manifest.json (every other file's
 * SHA-256). Each object is put only if absent (If-None-Match: *), under a key
 * no earlier pack used, so no pack is ever overwritten; asking again makes a
 * new pack. Writers only.
 */
export async function handleCreatePack(
  request: Request,
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return validationError(requestId, { body: ["Invalid JSON"] });
  }
  const parsed = parsePackBody(body);
  if (!parsed.ok) return validationError(requestId, parsed.fields);
  const target = parsed.value;
  if (!(await allowed(env, actor, orgId, "tally.write", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db || !env.TALLY_CONTENT) {
    await db?.dispose();
    return unavailable(requestId);
  }
  const bucket = env.TALLY_CONTENT;
  try {
    const allTools = await db.tally.listTools(orgId);
    const allReviews = await db.evidence.listOrgReviews(orgId);
    let tools: AiTool[];
    let records: TrainingRecordRow[];
    let subjectLabel: string | null = null;
    if (target.scope === "org") {
      tools = allTools;
      records = await db.evidence.listTrainingRecords(orgId);
    } else if (target.scope === "tool") {
      const tool = allTools.find((t) => t.id === target.subject);
      if (!tool) return validationError(requestId, { subject: ["No such tool in this organization"] });
      tools = [tool];
      subjectLabel = `${tool.name} (${toolPublicId(tool.id)})`;
      records = await db.evidence.listTrainingRecords(orgId, { toolId: tool.id });
    } else {
      records = await db.evidence.listTrainingRecords(orgId, { email: target.subject });
      const ids = new Set<string>([
        ...records.map((r) => r.toolId).filter((id): id is string => id !== null),
        ...(await db.evidence.listToolIdsForUser(orgId, target.subject)),
      ]);
      tools = allTools.filter((t) => ids.has(t.id));
      subjectLabel = target.subject;
    }
    const toolIds = new Set(tools.map((t) => t.id));
    const reviews = allReviews.filter((r) => toolIds.has(r.toolId));
    const evidenceRecords = records.map(toEvidenceRecord);
    const toolNames = new Map(allTools.map((t) => [t.id, t.name]));

    const packId = crypto.randomUUID();
    const asOf = nowIso();
    const prefix = `orgs/${orgId}/packs/${packId}/`;
    const orgName = (await db.evidence.orgName(orgId)) ?? orgPublicId(orgId);

    const staged: { name: string; contentType: string; bytes: Uint8Array }[] = [
      { name: "register.csv", contentType: CSV, bytes: enc.encode(registerCsv(tools)) },
      { name: "reviews.csv", contentType: CSV, bytes: enc.encode(reviewsCsv(reviews, toolNames)) },
      { name: "training-records.csv", contentType: CSV, bytes: enc.encode(trainingRecordsCsv(evidenceRecords)) },
    ];
    const digests = await Promise.all(staged.map(async (f) => ({ name: f.name, byteSize: f.bytes.byteLength, sha256: await sha256Hex(f.bytes) })));
    const pdf = summaryPdf({
      orgName,
      packId: packPublicId(packId),
      scope: target.scope,
      subjectLabel,
      asOf,
      tools,
      reviews,
      records: evidenceRecords,
      files: digests,
    });
    staged.push({ name: "summary.pdf", contentType: "application/pdf", bytes: pdf });

    const files: EvidenceFileRow[] = [];
    for (const f of staged) {
      files.push({ name: f.name, contentType: f.contentType, byteSize: f.bytes.byteLength, sha256: await sha256Hex(f.bytes), objectKey: prefix + f.name });
    }
    const manifest: EvidenceManifest = {
      pack: packPublicId(packId),
      organization: orgPublicId(orgId),
      organizationName: orgName,
      scope: target.scope,
      subject: target.scope === "tool" ? toolPublicId(target.subject) : target.subject,
      asOf,
      generator: "Aitally",
      files: files.map((f) => ({ name: f.name, contentType: f.contentType, byteSize: f.byteSize, sha256: f.sha256 })),
    };
    const manifestBytes = enc.encode(`${JSON.stringify(manifest, null, 2)}\n`);
    const manifestSha256 = await sha256Hex(manifestBytes);
    staged.push({ name: "manifest.json", contentType: "application/json", bytes: manifestBytes });
    files.push({ name: "manifest.json", contentType: "application/json", byteSize: manifestBytes.byteLength, sha256: manifestSha256, objectKey: `${prefix}manifest.json` });

    for (const [i, f] of staged.entries()) {
      const put = await bucket.put(files[i]!.objectKey, f.bytes, {
        sha256: files[i]!.sha256,
        onlyIf: new Headers({ "if-none-match": "*" }),
        httpMetadata: { contentType: f.contentType },
        customMetadata: { sha256: files[i]!.sha256, pack: packPublicId(packId) },
      });
      // put() answers null when the precondition fails: the key exists. A pack is never overwritten.
      if (put === null) throw new Error(`evidence pack object already exists: ${files[i]!.objectKey}`);
    }

    const pack = await db.evidence.createPack({
      id: packId,
      orgId,
      scope: target.scope,
      subject: target.subject,
      asOf,
      files,
      manifestSha256,
      requestedBy: actorSubjectUuid(actor.subjectId),
      requestedByEmail: actor.email,
      createdAt: asOf,
    });
    await recordAudit(db.executor, {
      type: "tally.evidence_pack.created",
      orgId,
      actor: { type: actor.subjectType, id: actor.subjectId },
      requestId,
      subjectKind: "evidence_pack",
      subjectId: pack.id,
      subjectName: `Evidence pack (${target.scope}${subjectLabel ? `: ${subjectLabel}` : ""})`,
      description: `Built an evidence pack for ${target.scope === "org" ? "the organization" : subjectLabel} as of ${asOf}: ${tools.length} tools, ${reviews.length} reviews, ${records.length} training records (manifest SHA-256 ${manifestSha256})`,
      payload: {
        packId: packPublicId(pack.id),
        scope: target.scope,
        subject: manifest.subject,
        asOf,
        manifestSha256,
        files: manifest.files.map((f) => ({ name: f.name, sha256: f.sha256 })),
      },
      occurredAt: asOf,
    });
    return successResponse({ pack: toPublicPack(pack) }, requestId, 201);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

export async function handleListPacks(env: Env, requestId: string, actor: ActorContext, orgId: string): Promise<Response> {
  if (!(await allowed(env, actor, orgId, "tally.read", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  try {
    return successResponse({ packs: (await db.evidence.listPacks(orgId)).map(toPublicPack) }, requestId);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

export async function handleGetPack(env: Env, requestId: string, actor: ActorContext, orgId: string, packId: string): Promise<Response> {
  if (!(await allowed(env, actor, orgId, "tally.read", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  try {
    const pack = await db.evidence.getPack(orgId, packId);
    return pack ? successResponse({ pack: toPublicPack(pack) }, requestId) : notFound(requestId);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

/** GET …/evidence-packs/{atx}/files/{name} — one file of a pack, from R2, with the SHA-256 recorded when it was built. */
export async function handleGetPackFile(
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
  packId: string,
  name: string,
): Promise<Response> {
  if (!(await allowed(env, actor, orgId, "tally.read", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db || !env.TALLY_CONTENT) {
    await db?.dispose();
    return unavailable(requestId);
  }
  try {
    const pack = await db.evidence.getPack(orgId, packId);
    const file = pack?.files.find((f) => f.name === name);
    if (!pack || !file) return notFound(requestId);
    const object = await env.TALLY_CONTENT.get(file.objectKey);
    if (!object) return errorResponse("internal_error", "The stored file is missing", 500, requestId);
    return new Response(object.body, {
      status: 200,
      headers: {
        "content-type": file.contentType,
        "content-length": String(file.byteSize),
        "content-disposition": `attachment; filename="${packPublicId(pack.id)}-${file.name}"`,
        "x-content-sha256": file.sha256,
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}
