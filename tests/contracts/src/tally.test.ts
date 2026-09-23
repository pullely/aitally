import {
  AI_RISK_LEVELS,
  AI_TOOL_STATUSES,
  addMonthsToDate,
  isReviewDue,
  isRiskStatusAllowed,
  summarizeRegister,
} from "@saas/contracts/tally";

describe("tally contracts", () => {
  it("adds calendar months, clamping to the end of a shorter month", () => {
    expect(addMonthsToDate("2026-09-23", 12)).toBe("2027-09-23");
    expect(addMonthsToDate("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDate("2027-12-31", 2)).toBe("2028-02-29"); // leap year
    expect(addMonthsToDate("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonthsToDate("2026-03-31", 24)).toBe("2028-03-31");
  });

  it("allows a prohibited risk level only on a blocked or retired tool", () => {
    for (const status of AI_TOOL_STATUSES) {
      expect(isRiskStatusAllowed("prohibited", status)).toBe(status === "blocked" || status === "retired");
    }
    for (const risk of AI_RISK_LEVELS.filter((r) => r !== "prohibited")) {
      expect(isRiskStatusAllowed(risk, "approved")).toBe(true);
    }
  });

  it("says a review is due on or after its date, never for a retired tool", () => {
    expect(isReviewDue("2026-09-23", "approved", "2026-09-23")).toBe(true);
    expect(isReviewDue("2026-09-24", "approved", "2026-09-23")).toBe(false);
    expect(isReviewDue("2020-01-01", "retired", "2026-09-23")).toBe(false);
  });

  it("summarizes the register, counting only tools in use by risk and personal data", () => {
    const summary = summarizeRegister([
      { riskLevel: "high", status: "approved", reviewDue: true, dataCategories: ["employee_personal"] },
      { riskLevel: "minimal", status: "restricted", reviewDue: false, dataCategories: ["public"] },
      { riskLevel: "high", status: "retired", reviewDue: false, dataCategories: ["special_category"] },
    ]);
    expect(summary.total).toBe(3);
    expect(summary.inUse).toBe(2);
    expect(summary.byRiskLevel).toEqual({ unassessed: 0, minimal: 1, limited: 0, high: 1, prohibited: 0 });
    expect(summary.byStatus).toEqual({ proposed: 0, approved: 1, restricted: 1, blocked: 0, retired: 1 });
    expect(summary.reviewsDue).toBe(1);
    expect(summary.withPersonalData).toBe(1);
  });
});
