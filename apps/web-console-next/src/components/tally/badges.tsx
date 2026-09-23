import { Badge } from "@/components/ui/badge";
import { AI_RISK_LEVEL_LABELS, type AiRiskLevel, type AiToolStatus } from "@saas/contracts/tally";

const RISK_VARIANT: Record<AiRiskLevel, "default" | "secondary" | "destructive" | "warning" | "success" | "outline"> = {
  unassessed: "outline",
  minimal: "success",
  limited: "secondary",
  high: "warning",
  prohibited: "destructive",
};

const STATUS_VARIANT: Record<AiToolStatus, "default" | "secondary" | "destructive" | "warning" | "success" | "outline"> = {
  proposed: "outline",
  approved: "success",
  restricted: "warning",
  blocked: "destructive",
  retired: "secondary",
};

export function RiskBadge({ level }: { level: AiRiskLevel }) {
  return (
    <Badge variant={RISK_VARIANT[level] ?? "outline"} title={AI_RISK_LEVEL_LABELS[level]}>
      {level === "unassessed" ? "not assessed" : level}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: AiToolStatus }) {
  return <Badge variant={STATUS_VARIANT[status] ?? "outline"}>{status}</Badge>;
}

/** The next review date, flagged when it has come due. */
export function ReviewDate({ nextReviewOn, reviewDue }: { nextReviewOn: string; reviewDue: boolean }) {
  return (
    <span className="whitespace-nowrap text-sm">
      {nextReviewOn} {reviewDue ? <Badge variant="warning">review due</Badge> : null}
    </span>
  );
}
