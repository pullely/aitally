import { completionLine, formatQuizText, parseQuizText } from "@web-console-next/lib/quiz-text";

describe("quiz text", () => {
  it("parses blocks into questions with the starred option as correct, and round-trips", () => {
    const text = "May customer data go into an unapproved tool?\nYes\n*No\n\nWho answers for a tool?\n*Its owner\nThe vendor\nNobody";
    const r = parseQuizText(text);
    expect(r).toEqual({
      ok: true,
      quiz: [
        { prompt: "May customer data go into an unapproved tool?", options: ["Yes", "No"], correct: 1 },
        { prompt: "Who answers for a tool?", options: ["Its owner", "The vendor", "Nobody"], correct: 0 },
      ],
    });
    expect(parseQuizText(formatQuizText(r.ok ? r.quiz : null))).toEqual(r);
  });

  it("treats empty text as no quiz and refuses a question without exactly one starred option", () => {
    expect(parseQuizText("  \n")).toEqual({ ok: true, quiz: null });
    expect(parseQuizText("Q?\nA\nB").ok).toBe(false);
    expect(parseQuizText("Q?\n*A\n*B").ok).toBe(false);
    expect(parseQuizText("Q?\n*A").ok).toBe(false);
  });

  it("words completion as a record", () => {
    expect(completionLine({ total: 14, completed: 12 })).toBe("12 of 14 assigned completed");
    expect(completionLine({ total: 0, completed: 0 })).toBe("Not assigned yet");
  });
});
