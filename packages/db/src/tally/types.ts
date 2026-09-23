// Aitally (tally) bounded context — row shapes and repository seam.
//
// Timestamps are ISO-8601 strings and dates are YYYY-MM-DD strings end to end:
// D1 stores TEXT, the wire carries strings, and a string comparison of two
// such dates is a date comparison.

export interface AiTool {
  id: string;
  orgId: string;
  name: string;
  vendor: string;
  websiteUrl: string | null;
  category: string;
  purpose: string;
  /** Sorted, de-duplicated data categories; [] when none recorded. */
  dataCategories: string[];
  riskLevel: string;
  actRole: string;
  status: string;
  ownerEmail: string;
  usersDescription: string;
  reviewIntervalMonths: number;
  lastReviewedOn: string | null;
  nextReviewOn: string;
  notes: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The fields a create or an edit sets. Review bookkeeping is not among them. */
export interface AiToolFields {
  name: string;
  vendor: string;
  websiteUrl: string | null;
  category: string;
  purpose: string;
  dataCategories: string[];
  riskLevel: string;
  actRole: string;
  status: string;
  ownerEmail: string;
  usersDescription: string;
  reviewIntervalMonths: number;
  notes: string;
}

export interface CreateAiToolInput extends AiToolFields {
  id: string;
  orgId: string;
  nextReviewOn: string;
  createdBy: string | null;
  now: string;
}

export interface UpdateAiToolInput extends AiToolFields {
  /** Recomputed by the caller when the interval changes. */
  nextReviewOn: string;
  now: string;
}

export interface AiToolReview {
  id: string;
  orgId: string;
  toolId: string;
  reviewedOn: string;
  decision: string;
  riskLevel: string;
  reviewerEmail: string | null;
  notes: string;
  createdBy: string | null;
  createdAt: string;
}

export type CreateAiToolReviewInput = AiToolReview;

export interface ApplyReviewInput {
  reviewedOn: string;
  decision: string;
  riskLevel: string;
  nextReviewOn: string;
  now: string;
}

export interface ListAiToolsFilter {
  status?: string | undefined;
  riskLevel?: string | undefined;
}

export interface TallyRepository {
  createTool(input: CreateAiToolInput): Promise<AiTool>;
  getTool(orgId: string, toolId: string): Promise<AiTool | null>;
  /** Every tool in the org (retired ones too), by name. */
  listTools(orgId: string, filter?: ListAiToolsFilter): Promise<AiTool[]>;
  /**
   * Replace a tool's editable fields. Returns the row through RETURNING —
   * never judged by rowCount, which the D1 executor reports as 0 for any
   * write without RETURNING (runbook trap 22). null: no such tool in the org.
   */
  updateTool(orgId: string, toolId: string, input: UpdateAiToolInput): Promise<AiTool | null>;

  createReview(input: CreateAiToolReviewInput): Promise<AiToolReview>;
  /** A tool's reviews, newest first. */
  listReviews(orgId: string, toolId: string): Promise<AiToolReview[]>;
  /**
   * Apply a review to its tool: status, risk level, last/next review dates.
   * Only when the review is not older than the tool's last one, so a late
   * back-dated review never rolls the register back. null: not applied.
   */
  applyReview(orgId: string, toolId: string, input: ApplyReviewInput): Promise<AiTool | null>;
}
