import {
  AI_RISK_LEVELS,
  AI_TOOL_STATUSES,
  addMonthsToDate,
  isReviewDue,
  isRiskStatusAllowed,
  summarizeRegister,
  addDaysToDate,
  daysUntil,
  scoreQuiz,
  trainingReminderRung,
  toCsv,
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


describe("tally training contracts", () => {
  it("counts whole days to a due date across month and year ends", () => {
    expect(daysUntil("2026-10-07", "2026-09-30")).toBe(7);
    expect(daysUntil("2026-09-16", "2026-09-30")).toBe(-14);
    expect(daysUntil("2027-01-01", "2026-12-31")).toBe(1);
    expect(addDaysToDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDate("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("puts an assignment on the latest rung whose day has come", () => {
    expect(trainingReminderRung(20)).toBeNull();
    expect(trainingReminderRung(8)).toBeNull();
    expect(trainingReminderRung(7)).toBe("d7");
    expect(trainingReminderRung(3)).toBe("d7");
    expect(trainingReminderRung(1)).toBe("d1");
    expect(trainingReminderRung(0)).toBe("d0");
    expect(trainingReminderRung(-2)).toBe("d0");
    expect(trainingReminderRung(-3)).toBe("late3");
    expect(trainingReminderRung(-7)).toBe("late7");
    expect(trainingReminderRung(-13)).toBe("late7");
    expect(trainingReminderRung(-14)).toBe("late14");
    expect(trainingReminderRung(-40)).toBe("late14");
  });

  it("scores a quiz as the percentage right, rounded down", () => {
    const q = [0, 1, 2].map((correct) => ({ prompt: "?", options: ["a", "b", "c"], correct }));
    expect(scoreQuiz(q, [0, 1, 2])).toBe(100);
    expect(scoreQuiz(q, [0, 1, 0])).toBe(66);
    expect(scoreQuiz(q, [])).toBe(0);
  });
});

describe("tally evidence contracts", () => {
  it("writes RFC 4180 CSV with CRLF, quoting what needs it and neutralising formulas", () => {
    expect(toCsv(["a", "b"], [["x", 1], [null, 'say "hi", then go']])).toBe('a,b\r\nx,1\r\n,"say ""hi"", then go"\r\n');
    expect(toCsv(["f"], [["=HYPERLINK(1)"], ["+1"], ["@x"], ["-x"], ["ok"]])).toBe("f\r\n'=HYPERLINK(1)\r\n'+1\r\n'@x\r\n'-x\r\nok\r\n");
    expect(toCsv(["n"], [[-3]])).toBe("n\r\n-3\r\n");
  });
});
