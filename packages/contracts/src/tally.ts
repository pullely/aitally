/**
 * Aitally (`tally`) bounded context — the AI tool register (AT1): the AI
 * systems a company uses, what for, with which data, at which risk level and
 * who answers for each, plus the dated reviews of them. The organization IS
 * the company; its staff are its members.
 *
 * Aitally records evidence of the measures a deployer takes under Article 4 of
 * Regulation (EU) 2024/1689 (AI literacy). It never states that a company is
 * compliant, and it never classifies a tool for the company.
 */

export const AI_TOOL_CATEGORIES = [
  "general_assistant",
  "coding_assistant",
  "writing_assistant",
  "meeting_assistant",
  "image_media",
  "analytics",
  "embedded_feature",
  "custom_model",
  "other",
] as const;
export type AiToolCategory = (typeof AI_TOOL_CATEGORIES)[number];

export const AI_TOOL_CATEGORY_LABELS: Record<AiToolCategory, string> = {
  general_assistant: "General assistant (chat)",
  coding_assistant: "Coding assistant",
  writing_assistant: "Writing assistant",
  meeting_assistant: "Meeting notes / transcription",
  image_media: "Image, audio or video generation",
  analytics: "Analytics / decision support",
  embedded_feature: "AI feature inside another product",
  custom_model: "Own or fine-tuned model",
  other: "Other",
};

/** The kinds of data that reach a tool. `special_category` is GDPR Art. 9 data. */
export const AI_DATA_CATEGORIES = [
  "public",
  "internal",
  "confidential",
  "customer_personal",
  "employee_personal",
  "special_category",
  "source_code",
  "financial",
] as const;
export type AiDataCategory = (typeof AI_DATA_CATEGORIES)[number];

export const AI_DATA_CATEGORY_LABELS: Record<AiDataCategory, string> = {
  public: "Public information",
  internal: "Internal business information",
  confidential: "Confidential / trade secrets",
  customer_personal: "Customer personal data",
  employee_personal: "Employee personal data",
  special_category: "Special-category personal data (health, biometrics…)",
  source_code: "Source code",
  financial: "Financial data",
};

/** Categories that are personal data: the register summary counts tools touching any of them. */
export const AI_PERSONAL_DATA_CATEGORIES: readonly AiDataCategory[] = [
  "customer_personal",
  "employee_personal",
  "special_category",
];

/**
 * The EU AI Act's risk tiers as the company classifies its own use, plus
 * `unassessed`. `prohibited` (Article 5 practices) may only be held by a tool
 * that is blocked or retired.
 */
export const AI_RISK_LEVELS = ["unassessed", "minimal", "limited", "high", "prohibited"] as const;
export type AiRiskLevel = (typeof AI_RISK_LEVELS)[number];

export const AI_RISK_LEVEL_LABELS: Record<AiRiskLevel, string> = {
  unassessed: "Not yet assessed",
  minimal: "Minimal risk",
  limited: "Limited risk (transparency, Art. 50)",
  high: "High risk (Art. 6)",
  prohibited: "Prohibited practice (Art. 5)",
};

/** Article 3(4) deployer / Article 3(3) provider. Almost every customer is a deployer. */
export const AI_ACT_ROLES = ["deployer", "provider"] as const;
export type AiActRole = (typeof AI_ACT_ROLES)[number];

export const AI_TOOL_STATUSES = ["proposed", "approved", "restricted", "blocked", "retired"] as const;
export type AiToolStatus = (typeof AI_TOOL_STATUSES)[number];

/** What a review can decide. A review never sends a tool back to `proposed`. */
export const AI_REVIEW_DECISIONS = ["approved", "restricted", "blocked", "retired"] as const;
export type AiReviewDecision = (typeof AI_REVIEW_DECISIONS)[number];

/** Statuses that may carry the `prohibited` risk level. */
export const AI_PROHIBITED_ALLOWED_STATUSES: readonly AiToolStatus[] = ["blocked", "retired"];

export const AI_REVIEW_INTERVAL_DEFAULT_MONTHS = 12;
export const AI_REVIEW_INTERVAL_MAX_MONTHS = 24;

export const TALLY_EVENT_TYPES = ["tally.tool.created", "tally.tool.updated", "tally.tool.reviewed"] as const;
export type TallyEventType = (typeof TALLY_EVENT_TYPES)[number];

// ── Wire shapes ─────────────────────────────────────────────

export interface PublicAiTool {
  id: string;
  orgId: string;
  name: string;
  vendor: string;
  websiteUrl: string | null;
  category: AiToolCategory;
  purpose: string;
  dataCategories: AiDataCategory[];
  riskLevel: AiRiskLevel;
  actRole: AiActRole;
  status: AiToolStatus;
  ownerEmail: string;
  usersDescription: string;
  reviewIntervalMonths: number;
  lastReviewedOn: string | null;
  /** YYYY-MM-DD */
  nextReviewOn: string;
  /** nextReviewOn is today or earlier (UTC) and the tool is not retired. Derived, never stored. */
  reviewDue: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicAiToolReview {
  id: string;
  toolId: string;
  reviewedOn: string;
  decision: AiReviewDecision;
  riskLevel: AiRiskLevel;
  reviewerEmail: string | null;
  notes: string;
  createdAt: string;
}

export interface AiRegisterSummary {
  /** Tools not retired. */
  inUse: number;
  total: number;
  byRiskLevel: Record<AiRiskLevel, number>;
  byStatus: Record<AiToolStatus, number>;
  /** Tools not retired whose review is due. */
  reviewsDue: number;
  /** Tools not retired that receive personal data. */
  withPersonalData: number;
}

// ── Requests and responses ───────────────────────────────────

export interface CreateAiToolRequest {
  name: string;
  purpose: string;
  ownerEmail: string;
  vendor?: string;
  websiteUrl?: string | null;
  category?: AiToolCategory;
  dataCategories?: AiDataCategory[];
  riskLevel?: AiRiskLevel;
  actRole?: AiActRole;
  status?: AiToolStatus;
  usersDescription?: string;
  reviewIntervalMonths?: number;
  notes?: string;
}

export type UpdateAiToolRequest = Partial<CreateAiToolRequest>;

export interface AiToolResponse {
  tool: PublicAiTool;
  /** Whether the owner-assigned email was accepted (create, or an owner change). */
  ownerNotified?: boolean;
}

export interface ListAiToolsResponse {
  tools: PublicAiTool[];
  summary: AiRegisterSummary;
}

export interface GetAiToolResponse {
  tool: PublicAiTool;
  reviews: PublicAiToolReview[];
}

export interface CreateAiToolReviewRequest {
  /** YYYY-MM-DD; defaults to today (UTC); never in the future. */
  reviewedOn?: string;
  decision: AiReviewDecision;
  riskLevel: AiRiskLevel;
  notes?: string;
}

export interface AiToolReviewResponse {
  review: PublicAiToolReview;
  tool: PublicAiTool;
  /**
   * Whether the review moved the tool. A review dated before the tool's last
   * one joins the history without rolling the register back.
   */
  applied: boolean;
}

// ── Pure helpers (shared by the worker and the console) ─────

/**
 * Add whole calendar months to a YYYY-MM-DD date, clamping to the last day of
 * the target month (2026-01-31 + 1 month = 2026-02-28).
 */
export function addMonthsToDate(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const monthIndex = m - 1 + months;
  const year = y + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** A review is due when its date is today or past, unless the tool is retired. */
export function isReviewDue(nextReviewOn: string, status: string, today: string): boolean {
  return status !== "retired" && nextReviewOn <= today;
}

/** Whether a (risk level, status) pair is allowed: prohibited only on a blocked or retired tool. */
export function isRiskStatusAllowed(riskLevel: string, status: string): boolean {
  return riskLevel !== "prohibited" || (AI_PROHIBITED_ALLOWED_STATUSES as readonly string[]).includes(status);
}

export function summarizeRegister(
  tools: readonly Pick<PublicAiTool, "riskLevel" | "status" | "reviewDue" | "dataCategories">[],
): AiRegisterSummary {
  const byRiskLevel = Object.fromEntries(AI_RISK_LEVELS.map((r) => [r, 0])) as Record<AiRiskLevel, number>;
  const byStatus = Object.fromEntries(AI_TOOL_STATUSES.map((s) => [s, 0])) as Record<AiToolStatus, number>;
  let inUse = 0;
  let reviewsDue = 0;
  let withPersonalData = 0;
  for (const t of tools) {
    byStatus[t.status] += 1;
    if (t.status === "retired") continue;
    inUse += 1;
    byRiskLevel[t.riskLevel] += 1;
    if (t.reviewDue) reviewsDue += 1;
    if (t.dataCategories.some((c) => AI_PERSONAL_DATA_CATEGORIES.includes(c))) withPersonalData += 1;
  }
  return { inUse, total: tools.length, byRiskLevel, byStatus, reviewsDue, withPersonalData };
}

// ═════════════════════════════════════════════════════════════
// AT2 — training: courses, material, assignments, the reminder ladder
// ═════════════════════════════════════════════════════════════

export const TRAINING_COURSE_STATUSES = ["draft", "published", "archived"] as const;
export type TrainingCourseStatus = (typeof TRAINING_COURSE_STATUSES)[number];

export const TRAINING_ASSIGNMENT_STATUSES = ["open", "completed", "excused"] as const;
export type TrainingAssignmentStatus = (typeof TRAINING_ASSIGNMENT_STATUSES)[number];

/** What a course's material may be: PDF, video, image or Word. */
export const TRAINING_MATERIAL_CONTENT_TYPES = [
  "application/pdf",
  "video/mp4",
  "image/png",
  "image/jpeg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;
export const TRAINING_MATERIAL_MAX_BYTES = 50 * 1024 * 1024;

export const TRAINING_DUE_DAYS_DEFAULT = 30;
export const TRAINING_RECURRENCE_MONTHS_DEFAULT = 12;
export const TRAINING_PASS_MARK_DEFAULT = 80;
export const TRAINING_QUIZ_MAX_QUESTIONS = 50;

/**
 * The reminder ladder. `offset` is days until `due_on` (negative = late).
 * d7/d1/d0 go to the assignee; late3/late7 add the owner of the course's tool;
 * late14 goes to the assignee and the org's owners.
 */
export const TRAINING_REMINDER_RUNGS = [
  { rung: "d7", offset: 7 },
  { rung: "d1", offset: 1 },
  { rung: "d0", offset: 0 },
  { rung: "late3", offset: -3 },
  { rung: "late7", offset: -7 },
  { rung: "late14", offset: -14 },
] as const;
export type TrainingReminderRung = (typeof TRAINING_REMINDER_RUNGS)[number]["rung"];

export const TRAINING_EVENT_TYPES = [
  "tally.course.created",
  "tally.course.updated",
  "tally.course.material_uploaded",
  "tally.assignment.created",
  "tally.assignment.completed",
  "tally.reminder.sent",
] as const;

/** Whole days from `today` to `dueOn` (both YYYY-MM-DD); negative when late. */
export function daysUntil(dueOn: string, today: string): number {
  return Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function addDaysToDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The rung an open assignment is on today: the latest rung whose day has come.
 * A sweep that missed a day still sends the rung that is current, never a
 * stale one, and nothing is sent more than 7 days before the due date.
 */
export function trainingReminderRung(daysRemaining: number): TrainingReminderRung | null {
  let current: TrainingReminderRung | null = null;
  for (const r of TRAINING_REMINDER_RUNGS) if (daysRemaining <= r.offset) current = r.rung;
  return current;
}

export function isEscalationToToolOwner(rung: TrainingReminderRung): boolean {
  return rung === "late3" || rung === "late7";
}

export function isEscalationToOrgOwners(rung: TrainingReminderRung): boolean {
  return rung === "late14";
}

export interface TrainingQuizQuestion {
  prompt: string;
  options: string[];
  /** Index into options. Only a writer of the org sees it on the wire. */
  correct?: number;
}

/** Percentage of questions answered correctly, rounded down. */
export function scoreQuiz(questions: readonly TrainingQuizQuestion[], answers: readonly number[]): number {
  if (questions.length === 0) return 100;
  let right = 0;
  questions.forEach((q, i) => {
    if (answers[i] === q.correct) right += 1;
  });
  return Math.floor((right * 100) / questions.length);
}

export interface PublicTrainingMaterial {
  id: string;
  courseId: string;
  version: number;
  filename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  uploadedAt: string;
}

export interface PublicTrainingCourse {
  id: string;
  orgId: string;
  title: string;
  summary: string;
  /** The tool whose users this course is for; null = everyone. */
  toolId: string | null;
  dueDays: number;
  /** 0 = once; otherwise re-assigned this many months after completion. */
  recurrenceMonths: number;
  /** null = no quiz: completion is a confirmation that the material was read. */
  passMarkPct: number | null;
  quiz: TrainingQuizQuestion[] | null;
  status: TrainingCourseStatus;
  /** The newest material version, or null before the first upload. */
  currentMaterial: PublicTrainingMaterial | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicTrainingAssignment {
  id: string;
  orgId: string;
  courseId: string;
  courseTitle: string;
  assigneeEmail: string;
  cycle: number;
  assignedOn: string;
  dueOn: string;
  status: TrainingAssignmentStatus;
  /** Open, and due_on is before today (UTC). Derived. */
  overdue: boolean;
  completedAt: string | null;
  scorePct: number | null;
  /** The SHA-256 of the material version the assignee completed. */
  materialSha256: string | null;
  materialVersion: number | null;
  attemptCount: number;
  createdAt: string;
}

export interface CreateTrainingCourseRequest {
  title: string;
  summary?: string;
  toolId?: string | null;
  dueDays?: number;
  recurrenceMonths?: number;
  passMarkPct?: number | null;
  quiz?: TrainingQuizQuestion[] | null;
  status?: TrainingCourseStatus;
}

export type UpdateTrainingCourseRequest = Partial<CreateTrainingCourseRequest>;

export interface TrainingCourseResponse {
  course: PublicTrainingCourse;
}

export interface GetTrainingCourseResponse {
  course: PublicTrainingCourse;
  materials: PublicTrainingMaterial[];
  assignments: { total: number; open: number; completed: number; overdue: number };
}

export interface ListTrainingCoursesResponse {
  courses: (PublicTrainingCourse & { assignments: { total: number; open: number; completed: number; overdue: number } })[];
}

export type AssignTrainingRequest =
  | { emails: string[]; dueOn?: string }
  | { everyone: true; dueOn?: string }
  | { toolUsers: true; dueOn?: string };

export interface AssignTrainingResponse {
  created: PublicTrainingAssignment[];
  /** Addresses that already hold an open assignment of this course. */
  skipped: string[];
  notified: number;
}

export interface ListTrainingAssignmentsResponse {
  assignments: PublicTrainingAssignment[];
}

export interface CompleteTrainingRequest {
  /** One option index per quiz question; required when the course has a quiz. */
  answers?: number[];
  /** The x-content-sha256 of the material the assignee opened; when sent it must be the current version's. */
  materialSha256?: string;
}

export interface CompleteTrainingResponse {
  assignment: PublicTrainingAssignment;
  attempt: { scorePct: number; passed: boolean };
}

export interface ToolUsersResponse {
  toolId: string;
  emails: string[];
}

export interface MyTrainingItem extends PublicTrainingAssignment {
  orgName: string;
  orgSlug: string;
  material: PublicTrainingMaterial | null;
  /** The quiz without its answers; null when the course has none. */
  quiz: TrainingQuizQuestion[] | null;
  passMarkPct: number | null;
}

export interface MyTrainingResponse {
  assignments: MyTrainingItem[];
}

export interface TrainingReminderClaim {
  assignmentId: string;
  courseId: string;
  rung: TrainingReminderRung;
  dueOn: string;
  daysRemaining: number;
  recipients: string[];
  /** How many recipients the notifications worker accepted. */
  notified: number;
}

export interface TrainingSweepResponse {
  today: string;
  considered: number;
  claimed: TrainingReminderClaim[];
  /** Rungs already claimed by an earlier sweep (not sent again). */
  alreadySent: number;
  reassigned: PublicTrainingAssignment[];
}

// ═════════════════════════════════════════════════════════════
// AT3 — evidence: per-employee and per-tool exports, immutable packs
// ═════════════════════════════════════════════════════════════

export const EVIDENCE_PACK_SCOPES = ["org", "employee", "tool"] as const;
export type EvidencePackScope = (typeof EVIDENCE_PACK_SCOPES)[number];

/** The files every pack holds, in manifest order (manifest.json itself last). */
export const EVIDENCE_PACK_FILES = ["register.csv", "reviews.csv", "training-records.csv", "summary.pdf", "manifest.json"] as const;
export type EvidencePackFileName = (typeof EVIDENCE_PACK_FILES)[number];

export interface EvidencePackFile {
  name: string;
  contentType: string;
  byteSize: number;
  sha256: string;
}

export interface PublicEvidencePack {
  id: string;
  orgId: string;
  scope: EvidencePackScope;
  /** The employee's email or the tool's ait_ id; null for an org pack. */
  subject: string | null;
  asOf: string;
  /** Every file, manifest.json included. */
  files: EvidencePackFile[];
  /** The SHA-256 of manifest.json, which lists every other file's digest. */
  manifestSha256: string;
  requestedByEmail: string | null;
  createdAt: string;
}

/** manifest.json: what the pack holds, as of when, and each file's digest. */
export interface EvidenceManifest {
  pack: string;
  organization: string;
  organizationName: string;
  scope: EvidencePackScope;
  subject: string | null;
  asOf: string;
  generator: string;
  /** Every file except manifest.json itself. */
  files: EvidencePackFile[];
}

/** One assignment, as the evidence reads it. */
export interface EvidenceTrainingRecord {
  assignmentId: string;
  courseId: string;
  courseTitle: string;
  toolId: string | null;
  assigneeEmail: string;
  cycle: number;
  assignedOn: string;
  dueOn: string;
  status: TrainingAssignmentStatus;
  completedAt: string | null;
  scorePct: number | null;
  materialVersion: number | null;
  materialSha256: string | null;
  attemptCount: number;
}

export interface EmployeeEvidenceResponse {
  email: string;
  asOf: string;
  records: EvidenceTrainingRecord[];
  /** Tools this person is a named user of (ait_ ids). */
  toolIds: string[];
}

export interface ToolEvidenceResponse {
  asOf: string;
  tool: PublicAiTool;
  reviews: PublicAiToolReview[];
  userEmails: string[];
  records: EvidenceTrainingRecord[];
}

export interface CreateEvidencePackRequest {
  scope: EvidencePackScope;
  /** The employee's email (scope employee) or the tool's ait_ id (scope tool). */
  subject?: string;
}

export interface EvidencePackResponse {
  pack: PublicEvidencePack;
}

export interface ListEvidencePacksResponse {
  packs: PublicEvidencePack[];
}

export const TRAINING_RECORD_CSV_COLUMNS = [
  "assignment_id",
  "course_id",
  "course_title",
  "tool_id",
  "assignee_email",
  "cycle",
  "assigned_on",
  "due_on",
  "status",
  "completed_at",
  "score_pct",
  "material_version",
  "material_sha256",
  "attempts",
] as const;

/**
 * RFC 4180 CSV: every field quoted when it holds a comma, quote or line break;
 * CRLF line ends. A text field that a spreadsheet would read as a formula
 * (leading =, +, -, @) is prefixed with an apostrophe, so opening the file
 * never runs anything.
 */
export function toCsv(header: readonly string[], rows: readonly (readonly (string | number | null)[])[]): string {
  const cell = (v: string | number | null): string => {
    if (v === null) return "";
    if (typeof v === "number") return String(v);
    let s = v;
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function trainingRecordRow(r: EvidenceTrainingRecord): (string | number | null)[] {
  return [
    r.assignmentId,
    r.courseId,
    r.courseTitle,
    r.toolId,
    r.assigneeEmail,
    r.cycle,
    r.assignedOn,
    r.dueOn,
    r.status,
    r.completedAt,
    r.scorePct,
    r.materialVersion,
    r.materialSha256,
    r.attemptCount,
  ];
}
