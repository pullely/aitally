import {
  TRAINING_COURSE_STATUSES,
  TRAINING_DUE_DAYS_DEFAULT,
  TRAINING_PASS_MARK_DEFAULT,
  TRAINING_QUIZ_MAX_QUESTIONS,
  TRAINING_RECURRENCE_MONTHS_DEFAULT,
  type TrainingCourseStatus,
} from "@saas/contracts/tally";
import type { QuizQuestionRow, TrainingCourse, TrainingCourseFields } from "@saas/db/tally";
import { parseToolPublicId } from "./ids.js";
import { Collector, EMAIL_RE, isCalendarDate, isObject, oneOf, text, type Validation } from "./validate.js";

const SHA256_RE = /^[0-9a-f]{64}$/;
export const MAX_ASSIGN_EMAILS = 500;

function integer(
  c: Collector,
  body: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): number | null | undefined {
  if (!(field in body) || body[field] === undefined) return undefined;
  const v = body[field];
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    c.add(field, `A whole number from ${min} to ${max}`);
    return undefined;
  }
  return v;
}

function quiz(c: Collector, body: Record<string, unknown>): QuizQuestionRow[] | null | undefined {
  if (!("quiz" in body) || body.quiz === undefined) return undefined;
  const v = body.quiz;
  if (v === null) return null;
  if (!Array.isArray(v) || v.length === 0 || v.length > TRAINING_QUIZ_MAX_QUESTIONS) {
    c.add("quiz", `An array of 1 to ${TRAINING_QUIZ_MAX_QUESTIONS} questions, or null for no quiz`);
    return undefined;
  }
  const out: QuizQuestionRow[] = [];
  for (const [i, q] of v.entries()) {
    const prompt = isObject(q) && typeof q.prompt === "string" ? q.prompt.trim() : "";
    const options = isObject(q) && Array.isArray(q.options) ? q.options : null;
    const correct = isObject(q) ? q.correct : undefined;
    if (!prompt || prompt.length > 1000) {
      c.add("quiz", `Question ${i + 1}: a prompt of 1 to 1000 characters`);
      return undefined;
    }
    if (
      !options ||
      options.length < 2 ||
      options.length > 8 ||
      options.some((o) => typeof o !== "string" || !o.trim() || o.length > 500)
    ) {
      c.add("quiz", `Question ${i + 1}: 2 to 8 non-empty options`);
      return undefined;
    }
    if (typeof correct !== "number" || !Number.isInteger(correct) || correct < 0 || correct >= options.length) {
      c.add("quiz", `Question ${i + 1}: correct is the index of one option`);
      return undefined;
    }
    out.push({ prompt, options: (options as string[]).map((o) => o.trim()), correct });
  }
  return out;
}

/**
 * Validate a course body: on create required fields must be present; on update
 * it is a patch over `current`. A quiz and a pass mark come together: a quiz
 * without a pass mark gets the default, and removing the quiz removes the mark.
 * `toolId` is returned as a UUID (the caller checks the tool exists in the org).
 */
export function validateCourseBody(body: unknown, current: TrainingCourse | null): Validation<TrainingCourseFields> {
  if (!isObject(body)) return { valid: false, fields: { body: ["Must be a JSON object"] } };
  const c = new Collector();
  const creating = current === null;
  const title = text(c, body, "title", { required: creating, max: 200 });
  if (!creating && title === null) c.add("title", "Required");
  const summary = text(c, body, "summary", { required: false, max: 5000 });
  const dueDays = integer(c, body, "dueDays", 1, 365);
  if (dueDays === null) c.add("dueDays", "Required");
  const recurrenceMonths = integer(c, body, "recurrenceMonths", 0, 36);
  if (recurrenceMonths === null) c.add("recurrenceMonths", "Required");
  const passMarkPct = integer(c, body, "passMarkPct", 1, 100);
  const questions = quiz(c, body);
  const status = oneOf<TrainingCourseStatus>(c, body, "status", TRAINING_COURSE_STATUSES, false);

  let toolId: string | null | undefined;
  if ("toolId" in body && body.toolId !== undefined) {
    if (body.toolId === null || body.toolId === "") toolId = null;
    else if (typeof body.toolId !== "string" || !(toolId = parseToolPublicId(body.toolId))) {
      c.add("toolId", "An ait_ tool id, or null for everyone");
    }
  }
  if (!c.ok) return { valid: false, fields: c.fields };

  const mergedQuiz = questions === undefined ? (current?.quiz ?? null) : questions;
  let mergedPass: number | null =
    passMarkPct === undefined ? (current?.passMarkPct ?? null) : passMarkPct;
  if (mergedQuiz === null) mergedPass = null;
  else if (mergedPass === null) mergedPass = TRAINING_PASS_MARK_DEFAULT;

  return {
    valid: true,
    value: {
      title: title ?? current?.title ?? "",
      summary: summary === undefined ? (current?.summary ?? "") : (summary ?? ""),
      toolId: toolId === undefined ? (current?.toolId ?? null) : toolId,
      dueDays: dueDays ?? current?.dueDays ?? TRAINING_DUE_DAYS_DEFAULT,
      recurrenceMonths: recurrenceMonths ?? current?.recurrenceMonths ?? TRAINING_RECURRENCE_MONTHS_DEFAULT,
      passMarkPct: mergedPass,
      quiz: mergedQuiz,
      status: status ?? current?.status ?? "draft",
    },
  };
}

export type AssignTarget =
  | { kind: "emails"; emails: string[]; dueOn: string | null }
  | { kind: "everyone"; dueOn: string | null }
  | { kind: "toolUsers"; dueOn: string | null };

/**
 * `{ emails }`, `{ everyone: true }` or `{ toolUsers: true }` — exactly one —
 * with an optional `dueOn`. A due date may lie in the past (recording
 * training that was already due) but no more than 60 days, and at most a year
 * ahead.
 */
export function validateAssignBody(body: unknown, today: string): Validation<AssignTarget> {
  if (!isObject(body)) return { valid: false, fields: { body: ["Must be a JSON object"] } };
  const c = new Collector();
  let dueOn: string | null = null;
  if ("dueOn" in body && body.dueOn !== undefined && body.dueOn !== null) {
    const d = body.dueOn;
    if (typeof d !== "string" || !isCalendarDate(d)) c.add("dueOn", "A date as YYYY-MM-DD");
    else {
      const from = new Date(Date.parse(`${today}T00:00:00Z`) - 60 * 86_400_000).toISOString().slice(0, 10);
      const through = new Date(Date.parse(`${today}T00:00:00Z`) + 366 * 86_400_000).toISOString().slice(0, 10);
      if (d < from || d > through) c.add("dueOn", "Within 60 days before and a year after today");
      else dueOn = d;
    }
  }
  const modes = ["emails", "everyone", "toolUsers"].filter((k) => k in body && body[k] !== undefined && body[k] !== false);
  if (modes.length !== 1) c.add("body", "Exactly one of emails, everyone or toolUsers");
  if (!c.ok) return { valid: false, fields: c.fields };

  if (modes[0] === "everyone") {
    if (body.everyone !== true) return { valid: false, fields: { everyone: ["Must be true"] } };
    return { valid: true, value: { kind: "everyone", dueOn } };
  }
  if (modes[0] === "toolUsers") {
    if (body.toolUsers !== true) return { valid: false, fields: { toolUsers: ["Must be true"] } };
    return { valid: true, value: { kind: "toolUsers", dueOn } };
  }
  const list = parseEmailList(body.emails, "emails");
  if (!list.valid) return list;
  if (list.value.length === 0) return { valid: false, fields: { emails: ["At least one address"] } };
  return { valid: true, value: { kind: "emails", emails: list.value, dueOn } };
}

/** A list of addresses: lower-cased, de-duplicated, at most MAX_ASSIGN_EMAILS. */
export function parseEmailList(v: unknown, field: string): Validation<string[]> {
  if (!Array.isArray(v) || v.length > MAX_ASSIGN_EMAILS) {
    return { valid: false, fields: { [field]: [`An array of at most ${MAX_ASSIGN_EMAILS} email addresses`] } };
  }
  const out: string[] = [];
  for (const item of v) {
    const e = typeof item === "string" ? item.trim().toLowerCase() : "";
    if (!e || e.length > 254 || !EMAIL_RE.test(e)) {
      return { valid: false, fields: { [field]: [`Not an email address: ${String(item).slice(0, 80)}`] } };
    }
    if (!out.includes(e)) out.push(e);
  }
  return { valid: true, value: out };
}

export interface CompleteFields {
  answers: number[] | null;
  materialSha256: string | null;
}

export function validateCompleteBody(body: unknown): Validation<CompleteFields> {
  if (body === null || body === undefined) return { valid: true, value: { answers: null, materialSha256: null } };
  if (!isObject(body)) return { valid: false, fields: { body: ["Must be a JSON object"] } };
  const c = new Collector();
  let answers: number[] | null = null;
  if ("answers" in body && body.answers !== undefined && body.answers !== null) {
    const a = body.answers;
    if (!Array.isArray(a) || a.length > TRAINING_QUIZ_MAX_QUESTIONS || a.some((x) => typeof x !== "number" || !Number.isInteger(x) || x < 0)) {
      c.add("answers", "An array of option indexes, one per question");
    } else answers = a as number[];
  }
  let materialSha256: string | null = null;
  if ("materialSha256" in body && body.materialSha256 !== undefined && body.materialSha256 !== null) {
    const m = body.materialSha256;
    if (typeof m !== "string" || !SHA256_RE.test(m.toLowerCase())) c.add("materialSha256", "A SHA-256 as 64 hex digits");
    else materialSha256 = m.toLowerCase();
  }
  if (!c.ok) return { valid: false, fields: c.fields };
  return { valid: true, value: { answers, materialSha256 } };
}

/** A safe download name: no path, no quotes or control characters, at most 200 characters. */
export function sanitizeFilename(raw: string | null): string {
  const base = (raw ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|*?:;]/g, "").trim().slice(0, 200);
  return cleaned || "material";
}
