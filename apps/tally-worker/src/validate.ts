import {
  AI_ACT_ROLES,
  AI_DATA_CATEGORIES,
  AI_REVIEW_DECISIONS,
  AI_REVIEW_INTERVAL_DEFAULT_MONTHS,
  AI_REVIEW_INTERVAL_MAX_MONTHS,
  AI_RISK_LEVELS,
  AI_TOOL_CATEGORIES,
  AI_TOOL_STATUSES,
  isRiskStatusAllowed,
  type AiActRole,
  type AiDataCategory,
  type AiReviewDecision,
  type AiRiskLevel,
  type AiToolCategory,
  type AiToolStatus,
} from "@saas/contracts/tally";
import type { AiTool, AiToolFields } from "@saas/db/tally";

export type Validation<T> = { valid: true; value: T } | { valid: false; fields: Record<string, string[]> };

// No ':' anywhere: an address is part of a notification idempotency key.
const EMAIL_RE = /^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A real calendar date in YYYY-MM-DD (rejects 2026-02-30). */
export function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

class Collector {
  fields: Record<string, string[]> = {};
  add(field: string, message: string): void {
    (this.fields[field] ??= []).push(message);
  }
  get ok(): boolean {
    return Object.keys(this.fields).length === 0;
  }
}

/** undefined = absent; null = explicitly cleared; string = the trimmed value. */
function text(
  c: Collector,
  body: Record<string, unknown>,
  field: string,
  opts: { required: boolean; max: number },
): string | null | undefined {
  if (!(field in body)) {
    if (opts.required) c.add(field, "Required");
    return undefined;
  }
  const v = body[field];
  if (v === null || v === "") {
    if (opts.required) c.add(field, "Required");
    return null;
  }
  if (typeof v !== "string") {
    c.add(field, "Must be a string");
    return undefined;
  }
  const trimmed = v.trim();
  if (opts.required && trimmed.length === 0) c.add(field, "Required");
  if (trimmed.length > opts.max) c.add(field, `At most ${opts.max} characters`);
  return trimmed.length === 0 ? null : trimmed;
}

function email(c: Collector, body: Record<string, unknown>, field: string, required: boolean): string | null | undefined {
  const v = text(c, body, field, { required, max: 254 });
  if (typeof v === "string" && !EMAIL_RE.test(v)) c.add(field, "Not an email address");
  return typeof v === "string" ? v.toLowerCase() : v;
}

function oneOf<T extends string>(
  c: Collector,
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  required: boolean,
): T | undefined {
  if (!(field in body) || body[field] === undefined) {
    if (required) c.add(field, "Required");
    return undefined;
  }
  const v = body[field];
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    c.add(field, `One of ${allowed.join(", ")}`);
    return undefined;
  }
  return v as T;
}

function httpsUrl(c: Collector, body: Record<string, unknown>, field: string): string | null | undefined {
  const v = text(c, body, field, { required: false, max: 500 });
  if (typeof v !== "string") return v;
  let parsed: URL | null = null;
  try {
    parsed = new URL(v);
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.protocol !== "https:") c.add(field, "An https:// URL");
  return v;
}

function dataCategories(c: Collector, body: Record<string, unknown>): AiDataCategory[] | undefined {
  if (!("dataCategories" in body) || body.dataCategories === undefined) return undefined;
  const v = body.dataCategories;
  if (v === null) return [];
  if (!Array.isArray(v)) {
    c.add("dataCategories", "An array of data categories");
    return undefined;
  }
  const out: AiDataCategory[] = [];
  for (const item of v) {
    if (typeof item !== "string" || !(AI_DATA_CATEGORIES as readonly string[]).includes(item)) {
      c.add("dataCategories", `Each one of ${AI_DATA_CATEGORIES.join(", ")}`);
      return undefined;
    }
    if (out.includes(item as AiDataCategory)) {
      c.add("dataCategories", `"${item}" is listed twice`);
      return undefined;
    }
    out.push(item as AiDataCategory);
  }
  return out.sort();
}

function interval(c: Collector, body: Record<string, unknown>): number | undefined {
  if (!("reviewIntervalMonths" in body) || body.reviewIntervalMonths === undefined) return undefined;
  const v = body.reviewIntervalMonths;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > AI_REVIEW_INTERVAL_MAX_MONTHS) {
    c.add("reviewIntervalMonths", `A whole number of months from 1 to ${AI_REVIEW_INTERVAL_MAX_MONTHS}`);
    return undefined;
  }
  return v;
}

/**
 * Validate a tool body. On create the required fields must be present; on
 * update the body is a patch over `current` and absent fields keep their value.
 * The prohibited-risk rule is checked on the merged result, so a patch that
 * only changes the status cannot leave a prohibited tool approved.
 */
export function validateToolBody(body: unknown, current: AiTool | null): Validation<AiToolFields> {
  if (!isObject(body)) return { valid: false, fields: { body: ["Must be a JSON object"] } };
  const c = new Collector();
  const creating = current === null;

  const name = text(c, body, "name", { required: creating, max: 120 });
  if (!creating && name === null) c.add("name", "Required");
  const purpose = text(c, body, "purpose", { required: creating, max: 2000 });
  if (!creating && purpose === null) c.add("purpose", "Required");
  const ownerEmail = email(c, body, "ownerEmail", creating);
  if (!creating && ownerEmail === null) c.add("ownerEmail", "Required");
  const vendor = text(c, body, "vendor", { required: false, max: 120 });
  const websiteUrl = httpsUrl(c, body, "websiteUrl");
  const usersDescription = text(c, body, "usersDescription", { required: false, max: 1000 });
  const notes = text(c, body, "notes", { required: false, max: 10_000 });
  const category = oneOf<AiToolCategory>(c, body, "category", AI_TOOL_CATEGORIES, false);
  const riskLevel = oneOf<AiRiskLevel>(c, body, "riskLevel", AI_RISK_LEVELS, false);
  const actRole = oneOf<AiActRole>(c, body, "actRole", AI_ACT_ROLES, false);
  const status = oneOf<AiToolStatus>(c, body, "status", AI_TOOL_STATUSES, false);
  const categories = dataCategories(c, body);
  const months = interval(c, body);

  if (!c.ok) return { valid: false, fields: c.fields };

  const merged: AiToolFields = {
    name: name ?? current?.name ?? "",
    vendor: vendor === undefined ? (current?.vendor ?? "") : (vendor ?? ""),
    websiteUrl: websiteUrl === undefined ? (current?.websiteUrl ?? null) : websiteUrl,
    category: category ?? current?.category ?? "other",
    purpose: purpose ?? current?.purpose ?? "",
    dataCategories: categories ?? current?.dataCategories ?? [],
    riskLevel: riskLevel ?? current?.riskLevel ?? "unassessed",
    actRole: actRole ?? current?.actRole ?? "deployer",
    status: status ?? current?.status ?? "proposed",
    ownerEmail: ownerEmail ?? current?.ownerEmail ?? "",
    usersDescription: usersDescription === undefined ? (current?.usersDescription ?? "") : (usersDescription ?? ""),
    reviewIntervalMonths: months ?? current?.reviewIntervalMonths ?? AI_REVIEW_INTERVAL_DEFAULT_MONTHS,
    notes: notes === undefined ? (current?.notes ?? "") : (notes ?? ""),
  };
  if (!isRiskStatusAllowed(merged.riskLevel, merged.status)) {
    return {
      valid: false,
      fields: { riskLevel: ["A prohibited practice can only be recorded on a blocked or retired tool"] },
    };
  }
  return { valid: true, value: merged };
}

export interface ReviewFields {
  reviewedOn: string;
  decision: AiReviewDecision;
  riskLevel: AiRiskLevel;
  notes: string;
}

/** Validate a review. `today` is the UTC date: a review is never dated in the future. */
export function validateReviewBody(body: unknown, today: string): Validation<ReviewFields> {
  if (!isObject(body)) return { valid: false, fields: { body: ["Must be a JSON object"] } };
  const c = new Collector();
  const decision = oneOf<AiReviewDecision>(c, body, "decision", AI_REVIEW_DECISIONS, true);
  const riskLevel = oneOf<AiRiskLevel>(c, body, "riskLevel", AI_RISK_LEVELS, true);
  const notes = text(c, body, "notes", { required: false, max: 10_000 });
  const reviewedOnRaw = text(c, body, "reviewedOn", { required: false, max: 10 });
  if (typeof reviewedOnRaw === "string") {
    if (!isCalendarDate(reviewedOnRaw)) c.add("reviewedOn", "A date as YYYY-MM-DD");
    else if (reviewedOnRaw > today) c.add("reviewedOn", "A review cannot be dated in the future");
  }
  if (!c.ok) return { valid: false, fields: c.fields };
  if (!isRiskStatusAllowed(riskLevel!, decision!)) {
    return {
      valid: false,
      fields: { riskLevel: ["A prohibited practice can only be recorded with a blocked or retired decision"] },
    };
  }
  return {
    valid: true,
    value: {
      reviewedOn: typeof reviewedOnRaw === "string" ? reviewedOnRaw : today,
      decision: decision!,
      riskLevel: riskLevel!,
      notes: notes ?? "",
    },
  };
}

export function parseFilter<T extends string>(raw: string | null, allowed: readonly T[]): T | undefined | false {
  if (raw === null || raw === "") return undefined;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : false;
}
