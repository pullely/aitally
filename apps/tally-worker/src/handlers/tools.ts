import { AI_RISK_LEVELS, AI_TOOL_STATUSES, addMonthsToDate, summarizeRegister } from "@saas/contracts/tally";
import type { Env } from "../env.js";
import type { ActorContext } from "../router.js";
import { allowed } from "../authz.js";
import { recordAudit } from "../audit.js";
import { nowIso, openDb, todayUtc } from "../context.js";
import { notFound, successResponse, unavailable, validationError } from "../http.js";
import { actorSubjectUuid, toolPublicId } from "../ids.js";
import { sendOwnerAssigned } from "../notify.js";
import { toPublicReview, toPublicTool } from "../present.js";
import { parseFilter, validateReviewBody, validateToolBody } from "../validate.js";

async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

export async function handleListTools(
  request: Request,
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const status = parseFilter(params.get("status"), AI_TOOL_STATUSES);
  if (status === false) return validationError(requestId, { status: [`One of ${AI_TOOL_STATUSES.join(", ")}`] });
  const riskLevel = parseFilter(params.get("riskLevel"), AI_RISK_LEVELS);
  if (riskLevel === false) return validationError(requestId, { riskLevel: [`One of ${AI_RISK_LEVELS.join(", ")}`] });
  if (!(await allowed(env, actor, orgId, "tally.read", requestId))) return notFound(requestId);

  const db = openDb(env);
  if (!db) return unavailable(requestId);
  const today = todayUtc();
  try {
    // The summary always covers the whole register; the filter narrows the list only.
    const all = (await db.tally.listTools(orgId)).map((t) => toPublicTool(t, today));
    const tools = all.filter((t) => (!status || t.status === status) && (!riskLevel || t.riskLevel === riskLevel));
    return successResponse({ tools, summary: summarizeRegister(all) }, requestId);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

export async function handleCreateTool(
  request: Request,
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
): Promise<Response> {
  const parsed = await readJson(request);
  if (!parsed.ok) return validationError(requestId, { body: ["Invalid JSON"] });
  const validation = validateToolBody(parsed.body, null);
  if (!validation.valid) return validationError(requestId, validation.fields);
  if (!(await allowed(env, actor, orgId, "tally.write", requestId))) return notFound(requestId);

  const db = openDb(env);
  if (!db) return unavailable(requestId);
  const now = nowIso();
  try {
    const tool = await db.tally.createTool({
      id: crypto.randomUUID(),
      orgId,
      ...validation.value,
      nextReviewOn: addMonthsToDate(todayUtc(now), validation.value.reviewIntervalMonths),
      createdBy: actorSubjectUuid(actor.subjectId),
      now,
    });
    await recordAudit(db.executor, {
      type: "tally.tool.created",
      orgId,
      actor: { type: actor.subjectType, id: actor.subjectId },
      requestId,
      subjectKind: "ai_tool",
      subjectId: tool.id,
      subjectName: tool.name,
      description: `Registered the AI tool "${tool.name}" (owner ${tool.ownerEmail}, ${tool.riskLevel} risk, ${tool.status})`,
      payload: {
        toolId: toolPublicId(tool.id),
        category: tool.category,
        dataCategories: tool.dataCategories,
        riskLevel: tool.riskLevel,
        status: tool.status,
        ownerEmail: tool.ownerEmail,
        nextReviewOn: tool.nextReviewOn,
      },
      occurredAt: now,
    });
    const ownerNotified = await sendOwnerAssigned(env, requestId, actor, tool);
    return successResponse({ tool: toPublicTool(tool, todayUtc(now)), ownerNotified }, requestId, 201);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

export async function handleGetTool(
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
  toolId: string,
): Promise<Response> {
  if (!(await allowed(env, actor, orgId, "tally.read", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  try {
    const tool = await db.tally.getTool(orgId, toolId);
    if (!tool) return notFound(requestId);
    const reviews = await db.tally.listReviews(orgId, toolId);
    return successResponse({ tool: toPublicTool(tool, todayUtc()), reviews: reviews.map(toPublicReview) }, requestId);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

export async function handleUpdateTool(
  request: Request,
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
  toolId: string,
): Promise<Response> {
  const parsed = await readJson(request);
  if (!parsed.ok) return validationError(requestId, { body: ["Invalid JSON"] });
  if (!(await allowed(env, actor, orgId, "tally.write", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  const now = nowIso();
  try {
    const current = await db.tally.getTool(orgId, toolId);
    if (!current) return notFound(requestId);
    const validation = validateToolBody(parsed.body, current);
    if (!validation.valid) return validationError(requestId, validation.fields);
    const fields = validation.value;
    // A changed interval re-derives the next review from the last one (or the
    // day the tool was registered); otherwise the date stands.
    const nextReviewOn =
      fields.reviewIntervalMonths === current.reviewIntervalMonths
        ? current.nextReviewOn
        : addMonthsToDate(current.lastReviewedOn ?? current.createdAt.slice(0, 10), fields.reviewIntervalMonths);
    const tool = await db.tally.updateTool(orgId, toolId, { ...fields, nextReviewOn, now });
    if (!tool) return notFound(requestId);

    const changed = (Object.keys(fields) as (keyof typeof fields)[]).filter(
      (k) => JSON.stringify(fields[k]) !== JSON.stringify(current[k]),
    );
    await recordAudit(db.executor, {
      type: "tally.tool.updated",
      orgId,
      actor: { type: actor.subjectType, id: actor.subjectId },
      requestId,
      subjectKind: "ai_tool",
      subjectId: tool.id,
      subjectName: tool.name,
      description: `Updated the AI tool "${tool.name}"${changed.length ? ` (${changed.join(", ")})` : ""}`,
      payload: {
        toolId: toolPublicId(tool.id),
        changed,
        from: { status: current.status, riskLevel: current.riskLevel, ownerEmail: current.ownerEmail },
        to: { status: tool.status, riskLevel: tool.riskLevel, ownerEmail: tool.ownerEmail },
      },
      occurredAt: now,
    });
    const ownerNotified = tool.ownerEmail !== current.ownerEmail ? await sendOwnerAssigned(env, requestId, actor, tool) : false;
    return successResponse({ tool: toPublicTool(tool, todayUtc(now)), ownerNotified }, requestId);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

export async function handleCreateReview(
  request: Request,
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
  toolId: string,
): Promise<Response> {
  const parsed = await readJson(request);
  if (!parsed.ok) return validationError(requestId, { body: ["Invalid JSON"] });
  const now = nowIso();
  const validation = validateReviewBody(parsed.body, todayUtc(now));
  if (!validation.valid) return validationError(requestId, validation.fields);
  if (!(await allowed(env, actor, orgId, "tally.write", requestId))) return notFound(requestId);

  const db = openDb(env);
  if (!db) return unavailable(requestId);
  try {
    const current = await db.tally.getTool(orgId, toolId);
    if (!current) return notFound(requestId);
    const r = validation.value;
    const review = await db.tally.createReview({
      id: crypto.randomUUID(),
      orgId,
      toolId,
      reviewedOn: r.reviewedOn,
      decision: r.decision,
      riskLevel: r.riskLevel,
      reviewerEmail: actor.email,
      notes: r.notes,
      createdBy: actorSubjectUuid(actor.subjectId),
      createdAt: now,
    });
    // Applied only when this review is not older than the tool's last one: a
    // back-dated review joins the history without rolling the register back.
    const applied = await db.tally.applyReview(orgId, toolId, {
      reviewedOn: r.reviewedOn,
      decision: r.decision,
      riskLevel: r.riskLevel,
      nextReviewOn: addMonthsToDate(r.reviewedOn, current.reviewIntervalMonths),
      now,
    });
    const tool = applied ?? current;
    await recordAudit(db.executor, {
      type: "tally.tool.reviewed",
      orgId,
      actor: { type: actor.subjectType, id: actor.subjectId },
      requestId,
      subjectKind: "ai_tool",
      subjectId: tool.id,
      subjectName: tool.name,
      description: `Reviewed the AI tool "${tool.name}" on ${r.reviewedOn}: ${r.decision}, ${r.riskLevel} risk`,
      payload: {
        toolId: toolPublicId(tool.id),
        reviewedOn: r.reviewedOn,
        decision: r.decision,
        riskLevel: r.riskLevel,
        applied: applied !== null,
        nextReviewOn: tool.nextReviewOn,
        from: { status: current.status, riskLevel: current.riskLevel },
      },
      occurredAt: now,
    });
    return successResponse(
      { review: toPublicReview(review), tool: toPublicTool(tool, todayUtc(now)), applied: applied !== null },
      requestId,
      201,
    );
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}
