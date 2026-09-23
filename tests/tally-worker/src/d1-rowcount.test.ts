import { createTallyRepository } from "@saas/db/tally";
import { createSqlExecutor } from "@saas/db/d1";
import { d1Over, migratedDatabase } from "./harness";

// Runbook trap 22: the D1 executor reports rowCount = rows.length, so a write
// without RETURNING always reports 0 on D1, whatever it changed. These run the
// real executor over a real SQLite engine — the combination a mocked executor
// hides — and pin that the tally repository decides "did my write happen?" from
// RETURNING rows, never from rowCount.

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = "2026-09-23T10:00:00.000Z";

const FIELDS = {
  name: "ChatGPT",
  vendor: "OpenAI",
  websiteUrl: null,
  category: "general_assistant",
  purpose: "Drafting",
  dataCategories: ["internal"],
  riskLevel: "limited",
  actRole: "deployer",
  status: "approved",
  ownerEmail: "ops@acme.example",
  usersDescription: "",
  reviewIntervalMonths: 12,
  notes: "",
};

describe("trap 22: rowCount after a write on D1", () => {
  it("is 0 for an UPDATE without RETURNING even though the row changed", async () => {
    const executor = createSqlExecutor(d1Over(migratedDatabase()));
    const repo = createTallyRepository(executor);
    const tool = await repo.createTool({ id: crypto.randomUUID(), orgId: ORG, ...FIELDS, nextReviewOn: "2027-09-23", createdBy: null, now: NOW });

    const bare = await executor.execute(`UPDATE tally_tools SET name = $2 WHERE id = $1`, [tool.id, "Claude"]);
    expect(bare.rowCount).toBe(0); // the trap: the row DID change
    expect((await repo.getTool(ORG, tool.id))?.name).toBe("Claude");

    const returning = await executor.execute(`UPDATE tally_tools SET name = $2 WHERE id = $1 RETURNING id`, [tool.id, "ChatGPT"]);
    expect(returning.rowCount).toBe(1);
  });

  it("the repository's writes report their outcome through RETURNING, scoped by org", async () => {
    const repo = createTallyRepository(createSqlExecutor(d1Over(migratedDatabase())));
    const tool = await repo.createTool({ id: crypto.randomUUID(), orgId: ORG, ...FIELDS, nextReviewOn: "2027-09-23", createdBy: null, now: NOW });

    expect(await repo.updateTool(OTHER, tool.id, { ...FIELDS, nextReviewOn: "2027-09-23", now: NOW })).toBeNull();
    const updated = await repo.updateTool(ORG, tool.id, { ...FIELDS, status: "restricted", nextReviewOn: "2027-09-23", now: NOW });
    expect(updated?.status).toBe("restricted");

    const apply = { reviewedOn: "2026-09-01", decision: "approved", riskLevel: "minimal", nextReviewOn: "2027-09-01", now: NOW };
    expect(await repo.applyReview(OTHER, tool.id, apply)).toBeNull();
    expect((await repo.applyReview(ORG, tool.id, apply))?.lastReviewedOn).toBe("2026-09-01");
    // Older than the last review: not applied, and null says so without rowCount.
    expect(await repo.applyReview(ORG, tool.id, { ...apply, reviewedOn: "2026-01-01", decision: "blocked" })).toBeNull();
    expect((await repo.getTool(ORG, tool.id))?.status).toBe("approved");
  });

  it("the schema refuses a prohibited risk level on a tool or review that is not blocked or retired", async () => {
    const db = migratedDatabase();
    const repo = createTallyRepository(createSqlExecutor(d1Over(db)));
    const tool = await repo.createTool({ id: crypto.randomUUID(), orgId: ORG, ...FIELDS, nextReviewOn: "2027-09-23", createdBy: null, now: NOW });
    expect(() => db.prepare("UPDATE tally_tools SET risk_level = 'prohibited' WHERE id = ?").run(tool.id)).toThrow();
    expect(() => db.prepare("UPDATE tally_tools SET risk_level = 'prohibited', status = 'blocked' WHERE id = ?").run(tool.id)).not.toThrow();
    expect(() =>
      db
        .prepare(
          "INSERT INTO tally_tool_reviews (id, org_id, tool_id, reviewed_on, decision, risk_level) VALUES (?, ?, ?, '2026-09-01', 'approved', 'prohibited')",
        )
        .run(crypto.randomUUID(), ORG, tool.id),
    ).toThrow();
  });
});
