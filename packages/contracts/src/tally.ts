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
