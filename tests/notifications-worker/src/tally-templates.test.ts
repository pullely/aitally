import { renderEmailTemplate } from "@notifications-worker/templates/index";

describe("Aitally templates", () => {
  it("renders every tally template key (none falls through to null)", () => {
    for (const key of ["tally.tool.owner_assigned", "tally.training.assigned", "tally.training.reminder"]) {
      expect(renderEmailTemplate(key, { courseTitle: "x", toolName: "y" }, { brandName: "Aitally" })).not.toBeNull();
    }
  });

  it("tells an assignee what to complete and by when, and says so on a later cycle", () => {
    const first = renderEmailTemplate("tally.training.assigned", { courseTitle: "Using ChatGPT safely", dueOn: "2026-10-30", cycle: 1 })!;
    expect(first.subject).toBe("Training to complete: Using ChatGPT safely");
    expect(first.text).toContain("by 2026-10-30");
    const again = renderEmailTemplate("tally.training.assigned", { courseTitle: "Using ChatGPT safely", dueOn: "2027-10-30", cycle: 2 })!;
    expect(again.subject).toBe("Time to refresh your training: Using ChatGPT safely");
  });

  it("words each rung for its reader and escapes hostile values", () => {
    const d1 = renderEmailTemplate("tally.training.reminder", {
      courseTitle: "AI basics",
      assigneeEmail: "a@acme.example",
      dueOn: "2026-10-01",
      daysRemaining: 1,
      role: "assignee",
    })!;
    expect(d1.subject).toBe("Reminder: AI basics is due tomorrow");
    const late = renderEmailTemplate("tally.training.reminder", {
      courseTitle: "<script>x</script>",
      assigneeEmail: "a@acme.example",
      dueOn: "2026-09-23",
      daysRemaining: -7,
      toolName: "ChatGPT Team",
      role: "tool_owner",
    })!;
    expect(late.subject).toContain("Overdue training: a@acme.example");
    expect(late.text).toContain("7 days ago");
    expect(late.text).toContain("owner of ChatGPT Team");
    expect(late.html).not.toContain("<script>");
    const owners = renderEmailTemplate("tally.training.reminder", {
      courseTitle: "AI basics",
      assigneeEmail: "a@acme.example",
      dueOn: "2026-09-16",
      daysRemaining: -14,
      role: "org_owner",
    })!;
    expect(owners.text).toContain("an owner of the organization");
  });
});
