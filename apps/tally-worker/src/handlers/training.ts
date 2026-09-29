import {
  TRAINING_ASSIGNMENT_STATUSES,
  TRAINING_MATERIAL_CONTENT_TYPES,
  TRAINING_MATERIAL_MAX_BYTES,
  addDaysToDate,
  scoreQuiz,
  type MyTrainingItem,
} from "@saas/contracts/tally";
import type { TrainingCourse, TrainingMaterial } from "@saas/db/tally";
import type { Env } from "../env.js";
import type { ActorContext } from "../router.js";
import { allowed } from "../authz.js";
import { recordAudit } from "../audit.js";
import { runClock } from "../clock.js";
import { nowIso, openDb, todayUtc } from "../context.js";
import { sha256Hex } from "../digest.js";
import { errorResponse, notFound, successResponse, unavailable, validationError } from "../http.js";
import {
  actorSubjectUuid,
  assignmentPublicId,
  coursePublicId,
  materialPublicId,
  parseCoursePublicId,
  subjectIdForms,
  toolPublicId,
} from "../ids.js";
import { sendTrainingAssigned } from "../notify-training.js";
import { presentQuiz, toPublicAssignment, toPublicCourse, toPublicMaterial } from "../present-training.js";
import { parseFilter } from "../validate.js";
import {
  parseEmailList,
  sanitizeFilename,
  validateAssignBody,
  validateCompleteBody,
  validateCourseBody,
} from "../validate-training.js";

async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    const raw = await request.text();
    return { ok: true, body: raw.trim() === "" ? null : JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

function conflict(requestId: string, message: string): Response {
  return errorResponse("conflict", message, 409, requestId);
}

function actorAudit(actor: ActorContext): { type: string; id: string } {
  return { type: actor.subjectType, id: actor.subjectId };
}

// ── courses ─────────────────────────────────────────────────

export async function handleListCourses(env: Env, requestId: string, actor: ActorContext, orgId: string): Promise<Response> {
  if (!(await allowed(env, actor, orgId, "tally.read", requestId))) return notFound(requestId);
  const writer = await allowed(env, actor, orgId, "tally.write", requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  const today = todayUtc();
  try {
    const [courses, current, counts] = await Promise.all([
      db.training.listCourses(orgId),
      db.training.currentMaterials(orgId),
      db.training.assignmentCounts(orgId, today),
    ]);
    return successResponse(
      {
        courses: courses.map((c) => ({
          ...toPublicCourse(c, current.get(c.id) ?? null, writer),
          assignments: counts.get(c.id) ?? { total: 0, open: 0, completed: 0, overdue: 0 },
        })),
      },
      requestId,
    );
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

export async function handleCreateCourse(
  request: Request,
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
): Promise<Response> {
  const parsed = await readJson(request);
  if (!parsed.ok) return validationError(requestId, { body: ["Invalid JSON"] });
  const validation = validateCourseBody(parsed.body, null);
  if (!validation.valid) return validationError(requestId, validation.fields);
  if (!(await allowed(env, actor, orgId, "tally.write", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  const now = nowIso();
  try {
    const fields = validation.value;
    if (fields.toolId && !(await db.tally.getTool(orgId, fields.toolId))) {
      return validationError(requestId, { toolId: ["No such tool in this organization"] });
    }
    const course = await db.training.createCourse({
      id: crypto.randomUUID(),
      orgId,
      ...fields,
      createdBy: actorSubjectUuid(actor.subjectId),
      now,
    });
    await recordAudit(db.executor, {
      type: "tally.course.created",
      orgId,
      actor: actorAudit(actor),
      requestId,
      subjectKind: "training_course",
      subjectId: course.id,
      subjectName: course.title,
      description: `Created the training course "${course.title}" (${course.status}${course.quiz ? `, quiz of ${course.quiz.length}, pass mark ${course.passMarkPct}%` : ", no quiz"})`,
      payload: {
        courseId: coursePublicId(course.id),
        toolId: course.toolId ? toolPublicId(course.toolId) : null,
        status: course.status,
        dueDays: course.dueDays,
        recurrenceMonths: course.recurrenceMonths,
        passMarkPct: course.passMarkPct,
        questions: course.quiz?.length ?? 0,
      },
      occurredAt: now,
    });
    return successResponse({ course: toPublicCourse(course, null, true) }, requestId, 201);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

export async function handleGetCourse(
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
  courseId: string,
): Promise<Response> {
  if (!(await allowed(env, actor, orgId, "tally.read", requestId))) return notFound(requestId);
  const writer = await allowed(env, actor, orgId, "tally.write", requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  const today = todayUtc();
  try {
    const course = await db.training.getCourse(orgId, courseId);
    if (!course) return notFound(requestId);
    const materials = await db.training.listMaterials(orgId, courseId);
    const counts = (await db.training.assignmentCounts(orgId, today)).get(courseId) ?? { total: 0, open: 0, completed: 0, overdue: 0 };
    return successResponse(
      {
        course: toPublicCourse(course, materials[0] ?? null, writer),
        materials: materials.map(toPublicMaterial),
        assignments: counts,
      },
      requestId,
    );
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

export async function handleUpdateCourse(
  request: Request,
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
  courseId: string,
): Promise<Response> {
  const parsed = await readJson(request);
  if (!parsed.ok) return validationError(requestId, { body: ["Invalid JSON"] });
  if (!(await allowed(env, actor, orgId, "tally.write", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  const now = nowIso();
  try {
    const current = await db.training.getCourse(orgId, courseId);
    if (!current) return notFound(requestId);
    const validation = validateCourseBody(parsed.body, current);
    if (!validation.valid) return validationError(requestId, validation.fields);
    const fields = validation.value;
    if (fields.toolId && fields.toolId !== current.toolId && !(await db.tally.getTool(orgId, fields.toolId))) {
      return validationError(requestId, { toolId: ["No such tool in this organization"] });
    }
    const course = await db.training.updateCourse(orgId, courseId, fields, now);
    if (!course) return notFound(requestId);
    const changed = (Object.keys(fields) as (keyof typeof fields)[]).filter(
      (k) => JSON.stringify(fields[k]) !== JSON.stringify(current[k]),
    );
    await recordAudit(db.executor, {
      type: "tally.course.updated",
      orgId,
      actor: actorAudit(actor),
      requestId,
      subjectKind: "training_course",
      subjectId: course.id,
      subjectName: course.title,
      description: `Updated the training course "${course.title}"${changed.length ? ` (${changed.join(", ")})` : ""}`,
      payload: { courseId: coursePublicId(course.id), changed, from: { status: current.status }, to: { status: course.status } },
      occurredAt: now,
    });
    const materials = await db.training.listMaterials(orgId, courseId);
    return successResponse({ course: toPublicCourse(course, materials[0] ?? null, true) }, requestId);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

// ── material (R2) ───────────────────────────────────────────

function tooLarge(requestId: string): Response {
  return errorResponse("validation_failed", "Course material is limited to 50 MB", 413, requestId);
}

/**
 * Store a new version of a course's material. The body is the file; the worker
 * hashes it, puts it in R2 under a key no other upload can reuse (R2 checks
 * the SHA-256 on the way in), then records the version. Versions are
 * immutable; the newest is current.
 */
export async function handleUploadMaterial(
  request: Request,
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
  courseId: string,
): Promise<Response> {
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!(TRAINING_MATERIAL_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    return errorResponse(
      "unsupported",
      `Upload a PDF, MP4, PNG, JPEG or Word document (got ${contentType || "no content type"})`,
      415,
      requestId,
    );
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > TRAINING_MATERIAL_MAX_BYTES) return tooLarge(requestId);
  if (!(await allowed(env, actor, orgId, "tally.write", requestId))) return notFound(requestId);

  const db = openDb(env);
  if (!db || !env.TALLY_CONTENT) {
    await db?.dispose();
    return unavailable(requestId);
  }
  try {
    const course = await db.training.getCourse(orgId, courseId);
    if (!course) return notFound(requestId);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0) return validationError(requestId, { body: ["The file is empty"] });
    if (bytes.byteLength > TRAINING_MATERIAL_MAX_BYTES) return tooLarge(requestId);

    const sha256 = await sha256Hex(bytes);
    const materialId = crypto.randomUUID();
    const objectKey = `orgs/${orgId}/courses/${courseId}/materials/${materialId}`;
    const filename = sanitizeFilename(request.headers.get("x-filename") ?? new URL(request.url).searchParams.get("filename"));
    await env.TALLY_CONTENT.put(objectKey, bytes, {
      sha256,
      httpMetadata: { contentType },
      customMetadata: { sha256, courseId: coursePublicId(courseId), filename },
    });
    const now = nowIso();
    const material = await db.training.createMaterial({
      id: materialId,
      orgId,
      courseId,
      objectKey,
      filename,
      contentType,
      byteSize: bytes.byteLength,
      sha256,
      uploadedBy: actorSubjectUuid(actor.subjectId),
      uploadedAt: now,
    });
    await recordAudit(db.executor, {
      type: "tally.course.material_uploaded",
      orgId,
      actor: actorAudit(actor),
      requestId,
      subjectKind: "training_course",
      subjectId: course.id,
      subjectName: course.title,
      description: `Uploaded version ${material.version} of the material for "${course.title}": ${filename} (${bytes.byteLength} bytes, SHA-256 ${sha256})`,
      payload: {
        courseId: coursePublicId(course.id),
        materialId: materialPublicId(material.id),
        version: material.version,
        byteSize: material.byteSize,
        sha256,
      },
      occurredAt: now,
    });
    return successResponse({ material: toPublicMaterial(material) }, requestId, 201);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

/** Stream one material version out of R2, with its SHA-256, to any member of the org. */
export async function handleGetMaterial(
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
  courseId: string,
  materialId: string,
): Promise<Response> {
  if (!(await allowed(env, actor, orgId, "tally.read", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db || !env.TALLY_CONTENT) {
    await db?.dispose();
    return unavailable(requestId);
  }
  try {
    const m = await db.training.getMaterial(orgId, courseId, materialId);
    if (!m) return notFound(requestId);
    const object = await env.TALLY_CONTENT.get(m.objectKey);
    if (!object) return notFound(requestId);
    return new Response(object.body, {
      status: 200,
      headers: {
        "content-type": m.contentType,
        "content-length": String(m.byteSize),
        "content-disposition": `inline; filename="${m.filename}"`,
        "x-content-sha256": m.sha256,
        "x-material-version": String(m.version),
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

// ── the named users of a tool ───────────────────────────────

export async function handleGetToolUsers(env: Env, requestId: string, actor: ActorContext, orgId: string, toolId: string): Promise<Response> {
  if (!(await allowed(env, actor, orgId, "tally.read", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  try {
    if (!(await db.tally.getTool(orgId, toolId))) return notFound(requestId);
    return successResponse({ toolId: toolPublicId(toolId), emails: await db.training.listToolUsers(orgId, toolId) }, requestId);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

export async function handlePutToolUsers(
  request: Request,
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
  toolId: string,
): Promise<Response> {
  const parsed = await readJson(request);
  if (!parsed.ok) return validationError(requestId, { body: ["Invalid JSON"] });
  const body = parsed.body as { emails?: unknown } | null;
  const list = parseEmailList(body?.emails, "emails");
  if (!list.valid) return validationError(requestId, list.fields);
  if (!(await allowed(env, actor, orgId, "tally.write", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  try {
    if (!(await db.tally.getTool(orgId, toolId))) return notFound(requestId);
    const emails = await db.training.setToolUsers(orgId, toolId, list.value, nowIso());
    return successResponse({ toolId: toolPublicId(toolId), emails }, requestId);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

// ── assignments ─────────────────────────────────────────────

export async function handleAssign(
  request: Request,
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
  courseId: string,
): Promise<Response> {
  const parsed = await readJson(request);
  if (!parsed.ok) return validationError(requestId, { body: ["Invalid JSON"] });
  const now = nowIso();
  const today = todayUtc(now);
  const validation = validateAssignBody(parsed.body, today);
  if (!validation.valid) return validationError(requestId, validation.fields);
  if (!(await allowed(env, actor, orgId, "tally.write", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  try {
    const course = await db.training.getCourse(orgId, courseId);
    if (!course) return notFound(requestId);
    if (course.status !== "published") return conflict(requestId, "Publish the course before assigning it");
    const materials = await db.training.listMaterials(orgId, courseId);
    if (materials.length === 0) return conflict(requestId, "Upload the course material before assigning it");

    const target = validation.value;
    let emails: string[];
    if (target.kind === "emails") emails = target.emails;
    else if (target.kind === "everyone") emails = await db.training.listMemberEmails(orgId);
    else {
      if (!course.toolId) return validationError(requestId, { toolUsers: ["This course is not tied to a tool"] });
      emails = await db.training.listToolUsers(orgId, course.toolId);
    }
    const dueOn = target.dueOn ?? addDaysToDate(today, course.dueDays);

    const created = [];
    const skipped: string[] = [];
    let notified = 0;
    for (const address of emails) {
      const a = await db.training.createAssignment({
        id: crypto.randomUUID(),
        orgId,
        courseId,
        assigneeEmail: address,
        assignedOn: today,
        dueOn,
        assignedBy: actorSubjectUuid(actor.subjectId),
        now,
      });
      if (!a) {
        skipped.push(address);
        continue;
      }
      created.push(a);
      const ok = await sendTrainingAssigned(env, requestId, actor, {
        orgId,
        assignmentId: a.id,
        cycle: a.cycle,
        courseTitle: a.courseTitle,
        dueOn: a.dueOn,
        address,
      });
      if (ok) notified += 1;
    }
    if (created.length > 0) {
      await recordAudit(db.executor, {
        type: "tally.assignment.created",
        orgId,
        actor: actorAudit(actor),
        requestId,
        subjectKind: "training_course",
        subjectId: course.id,
        subjectName: course.title,
        description: `Assigned "${course.title}" to ${created.length} ${created.length === 1 ? "person" : "people"} (${target.kind}), due ${dueOn}`,
        payload: {
          courseId: coursePublicId(course.id),
          target: target.kind,
          dueOn,
          count: created.length,
          assignmentIds: created.slice(0, 100).map((a) => assignmentPublicId(a.id)),
          assignees: created.slice(0, 100).map((a) => a.assigneeEmail),
        },
        occurredAt: now,
      });
    }
    return successResponse({ created: created.map((a) => toPublicAssignment(a, today)), skipped, notified }, requestId, 201);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

export async function handleListAssignments(
  request: Request,
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const status = parseFilter(params.get("status"), TRAINING_ASSIGNMENT_STATUSES);
  if (status === false) return validationError(requestId, { status: [`One of ${TRAINING_ASSIGNMENT_STATUSES.join(", ")}`] });
  const rawCourse = params.get("courseId");
  const courseId = rawCourse ? parseCoursePublicId(rawCourse) : undefined;
  if (courseId === null) return validationError(requestId, { courseId: ["An atc_ course id"] });
  const email = params.get("email")?.trim().toLowerCase() || undefined;
  if (!(await allowed(env, actor, orgId, "tally.read", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  const today = todayUtc();
  try {
    const rows = await db.training.listAssignments(orgId, { status, email, courseId });
    return successResponse({ assignments: rows.map((a) => toPublicAssignment(a, today)) }, requestId);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

/**
 * Complete an assignment: only the assignee — the signed-in address api-edge
 * resolved must be the assignment's address — and only while it is open.
 * Anyone else gets 404, exactly as a non-member does. With a quiz, the
 * answers are scored and every attempt recorded; the assignment completes on
 * a pass. The completion stores the time, the score and the SHA-256 of the
 * material version that is current, and is never rewritten.
 */
export async function handleCompleteAssignment(
  request: Request,
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
  assignmentId: string,
): Promise<Response> {
  const parsed = await readJson(request);
  if (!parsed.ok) return validationError(requestId, { body: ["Invalid JSON"] });
  const validation = validateCompleteBody(parsed.body);
  if (!validation.valid) return validationError(requestId, validation.fields);
  if (!actor.email) return notFound(requestId);
  if (!(await allowed(env, actor, orgId, "tally.read", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  const now = nowIso();
  const today = todayUtc(now);
  try {
    const assignment = await db.training.getAssignment(orgId, assignmentId);
    if (!assignment || assignment.assigneeEmail !== actor.email) return notFound(requestId);
    if (assignment.status !== "open") return conflict(requestId, `This assignment is already ${assignment.status}`);
    const course = await db.training.getCourse(orgId, assignment.courseId);
    if (!course) return notFound(requestId);
    const material = (await db.training.listMaterials(orgId, course.id))[0];
    if (!material) return conflict(requestId, "The course has no material yet");
    const { answers, materialSha256 } = validation.value;
    if (materialSha256 && materialSha256 !== material.sha256) {
      return conflict(requestId, "The course material has changed since you opened it: open the current version");
    }

    let scorePct: number | null = null;
    let passed = true;
    if (course.quiz) {
      if (!answers || answers.length !== course.quiz.length) {
        return validationError(requestId, { answers: [`One answer per question (${course.quiz.length})`] });
      }
      scorePct = scoreQuiz(course.quiz, answers);
      passed = scorePct >= (course.passMarkPct ?? 0);
      await db.training.recordAttempt({
        id: crypto.randomUUID(),
        orgId,
        assignmentId,
        answers,
        scorePct,
        passed,
        materialSha256: material.sha256,
        attemptedAt: now,
      });
    }
    if (!passed) {
      const after = (await db.training.getAssignment(orgId, assignmentId)) ?? assignment;
      return successResponse({ assignment: toPublicAssignment(after, today), attempt: { scorePct, passed } }, requestId);
    }

    const done = await db.training.completeAssignment(orgId, assignmentId, {
      completedAt: now,
      scorePct,
      materialId: material.id,
      materialSha256: material.sha256,
    });
    if (!done) return conflict(requestId, "This assignment is no longer open");
    await recordAudit(db.executor, {
      type: "tally.assignment.completed",
      orgId,
      actor: actorAudit(actor),
      requestId,
      subjectKind: "training_assignment",
      subjectId: done.id,
      subjectName: course.title,
      description: `${done.assigneeEmail} completed "${course.title}" (cycle ${done.cycle})${scorePct === null ? "" : ` with ${scorePct}%`} on material version ${material.version} (SHA-256 ${material.sha256})`,
      payload: {
        assignmentId: assignmentPublicId(done.id),
        courseId: coursePublicId(course.id),
        cycle: done.cycle,
        scorePct,
        materialId: materialPublicId(material.id),
        materialVersion: material.version,
        materialSha256: material.sha256,
        attempts: done.attemptCount,
      },
      occurredAt: now,
    });
    return successResponse({ assignment: toPublicAssignment(done, today), attempt: { scorePct: scorePct ?? 100, passed: true } }, requestId);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

/**
 * GET /v1/me/training — the caller's own assignments in every org they are an
 * active member of, each with the current material and the quiz (without
 * its answers). Not org-scoped: the address is the one api-edge resolved.
 */
export async function handleMyTraining(env: Env, requestId: string, actor: ActorContext): Promise<Response> {
  if (!actor.email) return successResponse({ assignments: [] }, requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  const today = todayUtc();
  try {
    const rows = await db.training.listMyAssignments(actor.email, subjectIdForms(actor.subjectId));
    const courses = new Map<string, { course: TrainingCourse | null; material: TrainingMaterial | null }>();
    const items: MyTrainingItem[] = [];
    for (const a of rows) {
      let entry = courses.get(a.courseId);
      if (!entry) {
        const course = await db.training.getCourse(a.orgId, a.courseId);
        const material = course ? ((await db.training.listMaterials(a.orgId, a.courseId))[0] ?? null) : null;
        entry = { course, material };
        courses.set(a.courseId, entry);
      }
      items.push({
        ...toPublicAssignment(a, today),
        orgName: a.orgName,
        orgSlug: a.orgSlug,
        material: entry.material ? toPublicMaterial(entry.material) : null,
        quiz: presentQuiz(entry.course?.quiz ?? null, false),
        passMarkPct: entry.course?.passMarkPct ?? null,
      });
    }
    return successResponse({ assignments: items }, requestId);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

/**
 * POST /v1/organizations/{org}/training/sweep — run today's training clock for
 * this org now, exactly as the 07:00 UTC cron does. Safe to repeat: each rung
 * is claimed once, so a second run the same day sends nothing. Writers only.
 */
export async function handleRunSweep(env: Env, requestId: string, actor: ActorContext, orgId: string): Promise<Response> {
  if (!(await allowed(env, actor, orgId, "tally.write", requestId))) return notFound(requestId);
  if (!env.PLATFORM_DB) return unavailable(requestId);
  try {
    return successResponse(await runClock(env, new Date(), { orgId, requestId }), requestId);
  } catch {
    return unavailable(requestId);
  }
}
