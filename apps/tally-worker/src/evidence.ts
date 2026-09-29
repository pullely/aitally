import {
  AI_RISK_LEVELS,
  AI_RISK_LEVEL_LABELS,
  TRAINING_RECORD_CSV_COLUMNS,
  isReviewDue,
  toCsv,
  trainingRecordRow,
  type EvidencePackScope,
  type EvidenceTrainingRecord,
  type TrainingAssignmentStatus,
} from "@saas/contracts/tally";
import type { AiTool, AiToolReview, TrainingRecordRow } from "@saas/db/tally";
import { assignmentPublicId, coursePublicId, reviewPublicId, toolPublicId } from "./ids.js";
import { renderPdf, type PdfBlock } from "./pdf.js";

export function toEvidenceRecord(r: TrainingRecordRow): EvidenceTrainingRecord {
  return {
    assignmentId: assignmentPublicId(r.id),
    courseId: coursePublicId(r.courseId),
    courseTitle: r.courseTitle,
    toolId: r.toolId ? toolPublicId(r.toolId) : null,
    assigneeEmail: r.assigneeEmail,
    cycle: r.cycle,
    assignedOn: r.assignedOn,
    dueOn: r.dueOn,
    status: r.status as TrainingAssignmentStatus,
    completedAt: r.completedAt,
    scorePct: r.scorePct,
    materialVersion: r.materialVersion,
    materialSha256: r.materialSha256,
    attemptCount: r.attemptCount,
  };
}

export function trainingRecordsCsv(records: readonly EvidenceTrainingRecord[]): string {
  return toCsv(TRAINING_RECORD_CSV_COLUMNS, records.map(trainingRecordRow));
}

export function registerCsv(tools: readonly AiTool[]): string {
  return toCsv(
    [
      "tool_id",
      "name",
      "vendor",
      "category",
      "purpose",
      "data_categories",
      "risk_level",
      "act_role",
      "status",
      "owner_email",
      "users_description",
      "review_interval_months",
      "last_reviewed_on",
      "next_review_on",
      "created_at",
      "updated_at",
    ],
    tools.map((t) => [
      toolPublicId(t.id),
      t.name,
      t.vendor,
      t.category,
      t.purpose,
      t.dataCategories.join(";"),
      t.riskLevel,
      t.actRole,
      t.status,
      t.ownerEmail,
      t.usersDescription,
      t.reviewIntervalMonths,
      t.lastReviewedOn,
      t.nextReviewOn,
      t.createdAt,
      t.updatedAt,
    ]),
  );
}

export function reviewsCsv(reviews: readonly AiToolReview[], toolNames: ReadonlyMap<string, string>): string {
  return toCsv(
    ["review_id", "tool_id", "tool_name", "reviewed_on", "decision", "risk_level", "reviewer_email", "notes", "recorded_at"],
    reviews.map((r) => [
      reviewPublicId(r.id),
      toolPublicId(r.toolId),
      toolNames.get(r.toolId) ?? "",
      r.reviewedOn,
      r.decision,
      r.riskLevel,
      r.reviewerEmail,
      r.notes,
      r.createdAt,
    ]),
  );
}

export interface SummaryInput {
  orgName: string;
  packId: string;
  scope: EvidencePackScope;
  subjectLabel: string | null;
  asOf: string;
  tools: readonly AiTool[];
  reviews: readonly AiToolReview[];
  records: readonly EvidenceTrainingRecord[];
  files: readonly { name: string; sha256: string; byteSize: number }[];
}

/**
 * summary.pdf: one page of counts and dates — never a verdict. It words the
 * training as a record ("12 of 14 assignments completed") and says what the
 * pack is not: a statement of compliance.
 */
export function summaryPdf(s: SummaryInput): Uint8Array {
  const today = s.asOf.slice(0, 10);
  const inUse = s.tools.filter((t) => t.status !== "retired");
  const byRisk = AI_RISK_LEVELS.map((r) => `${AI_RISK_LEVEL_LABELS[r]}: ${inUse.filter((t) => t.riskLevel === r).length}`).join("   ");
  const completed = s.records.filter((r) => r.status === "completed");
  const open = s.records.filter((r) => r.status === "open");
  const overdue = open.filter((r) => r.dueOn < today);
  const people = new Set(s.records.map((r) => r.assigneeEmail));
  const peopleDone = new Set(completed.map((r) => r.assigneeEmail));
  const lastReview = s.reviews.reduce<string | null>((m, r) => (m === null || r.reviewedOn > m ? r.reviewedOn : m), null);
  const lastCompletion = completed.reduce<string | null>((m, r) => (m === null || (r.completedAt ?? "") > m ? r.completedAt : m), null);
  const scopeLine =
    s.scope === "org" ? "the whole organization" : s.scope === "employee" ? `one employee: ${s.subjectLabel}` : `one AI tool: ${s.subjectLabel}`;

  const blocks: PdfBlock[] = [
    { text: "AI literacy evidence pack", bold: true, size: 18, after: 4 },
    { text: s.orgName, size: 13, after: 2 },
    { text: `Pack ${s.packId} · scope: ${scopeLine} · as of ${s.asOf}`, size: 9, after: 10 },
    { text: "", rule: true },
    { text: "The AI tool register", bold: true, size: 12, after: 4 },
    {
      text: `${s.tools.length} tools recorded, ${inUse.length} in use and ${s.tools.length - inUse.length} retired. ${inUse.filter((t) => isReviewDue(t.nextReviewOn, t.status, today)).length} reviews due.`,
    },
    { text: `Risk levels of the tools in use — ${byRisk}`, size: 10 },
    { text: `${s.reviews.length} dated reviews recorded${lastReview ? `, the latest on ${lastReview}` : ""}.`, after: 12 },
    { text: "The training record", bold: true, size: 12, after: 4 },
    {
      text: `${s.records.length} assignments to ${people.size} people: ${completed.length} completed, ${open.length} open (${overdue.length} past their due date)${
        s.records.some((r) => r.status === "excused") ? `, ${s.records.filter((r) => r.status === "excused").length} excused` : ""
      }.`,
    },
    {
      text: `${peopleDone.size} of ${people.size} people have completed at least one assignment${lastCompletion ? `; the latest completion was on ${lastCompletion.slice(0, 10)}` : ""}.`,
    },
    {
      text: "Every completion records the time, the quiz score where there is one, and the SHA-256 of the version of the material the person took.",
      size: 10,
      after: 12,
    },
    { text: "Files in this pack", bold: true, size: 12, after: 4 },
    ...s.files.map((f) => ({ text: `${f.name} (${f.byteSize} bytes) SHA-256 ${f.sha256}`, size: 8, after: 2 })),
    { text: "manifest.json lists the SHA-256 of every file, this one included.", size: 8, after: 12 },
    { text: "", rule: true },
    {
      text: "This pack records measures the organization took and when. It is not legal advice and not a statement of compliance with Regulation (EU) 2024/1689 or any other law.",
      size: 8,
    },
  ];
  return renderPdf(blocks, { title: `AI literacy evidence — ${s.orgName} — ${today}` });
}

