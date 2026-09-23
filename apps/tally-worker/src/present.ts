import {
  isReviewDue,
  type AiActRole,
  type AiDataCategory,
  type AiReviewDecision,
  type AiRiskLevel,
  type AiToolCategory,
  type AiToolStatus,
  type PublicAiTool,
  type PublicAiToolReview,
} from "@saas/contracts/tally";
import type { AiTool, AiToolReview } from "@saas/db/tally";
import { orgPublicId, reviewPublicId, toolPublicId } from "./ids.js";

export function toPublicTool(t: AiTool, today: string): PublicAiTool {
  return {
    id: toolPublicId(t.id),
    orgId: orgPublicId(t.orgId),
    name: t.name,
    vendor: t.vendor,
    websiteUrl: t.websiteUrl,
    category: t.category as AiToolCategory,
    purpose: t.purpose,
    dataCategories: t.dataCategories as AiDataCategory[],
    riskLevel: t.riskLevel as AiRiskLevel,
    actRole: t.actRole as AiActRole,
    status: t.status as AiToolStatus,
    ownerEmail: t.ownerEmail,
    usersDescription: t.usersDescription,
    reviewIntervalMonths: t.reviewIntervalMonths,
    lastReviewedOn: t.lastReviewedOn,
    nextReviewOn: t.nextReviewOn,
    reviewDue: isReviewDue(t.nextReviewOn, t.status, today),
    notes: t.notes,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export function toPublicReview(r: AiToolReview): PublicAiToolReview {
  return {
    id: reviewPublicId(r.id),
    toolId: toolPublicId(r.toolId),
    reviewedOn: r.reviewedOn,
    decision: r.decision as AiReviewDecision,
    riskLevel: r.riskLevel as AiRiskLevel,
    reviewerEmail: r.reviewerEmail,
    notes: r.notes,
    createdAt: r.createdAt,
  };
}
