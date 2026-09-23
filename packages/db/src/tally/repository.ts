import type { SqlExecutor, SqlRow } from "../d1/executor.js";
import type {
  AiTool,
  AiToolReview,
  ApplyReviewInput,
  CreateAiToolInput,
  CreateAiToolReviewInput,
  ListAiToolsFilter,
  TallyRepository,
  UpdateAiToolInput,
} from "./types.js";

type Row = SqlRow & Record<string, unknown>;

function str(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** The stored form of a category list: sorted, de-duplicated, comma-joined. */
export function joinDataCategories(categories: readonly string[]): string {
  return [...new Set(categories)].sort().join(",");
}

export function splitDataCategories(stored: string | null | undefined): string[] {
  if (!stored) return [];
  return stored.split(",").filter((c) => c.length > 0);
}

function mapTool(row: Row): AiTool {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    name: row.name as string,
    vendor: (row.vendor as string) ?? "",
    websiteUrl: str(row.website_url),
    category: row.category as string,
    purpose: row.purpose as string,
    dataCategories: splitDataCategories(row.data_categories as string),
    riskLevel: row.risk_level as string,
    actRole: row.act_role as string,
    status: row.status as string,
    ownerEmail: row.owner_email as string,
    usersDescription: (row.users_description as string) ?? "",
    reviewIntervalMonths: Number(row.review_interval_months),
    lastReviewedOn: str(row.last_reviewed_on),
    nextReviewOn: row.next_review_on as string,
    notes: (row.notes as string) ?? "",
    createdBy: str(row.created_by),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapReview(row: Row): AiToolReview {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    toolId: row.tool_id as string,
    reviewedOn: row.reviewed_on as string,
    decision: row.decision as string,
    riskLevel: row.risk_level as string,
    reviewerEmail: str(row.reviewer_email),
    notes: (row.notes as string) ?? "",
    createdBy: str(row.created_by),
    createdAt: row.created_at as string,
  };
}

const TOOL_COLUMNS = `id, org_id, name, vendor, website_url, category, purpose, data_categories,
  risk_level, act_role, status, owner_email, users_description, review_interval_months,
  last_reviewed_on, next_review_on, notes, created_by, created_at, updated_at`;

const REVIEW_COLUMNS = `id, org_id, tool_id, reviewed_on, decision, risk_level, reviewer_email,
  notes, created_by, created_at`;

export function createTallyRepository(executor: SqlExecutor): TallyRepository {
  async function one(sql: string, params: unknown[]): Promise<Row | null> {
    const result = await executor.execute<Row>(sql, params);
    return result.rows[0] ?? null;
  }

  return {
    async createTool(input: CreateAiToolInput) {
      const row = await one(
        `INSERT INTO tally_tools
           (id, org_id, name, vendor, website_url, category, purpose, data_categories, risk_level,
            act_role, status, owner_email, users_description, review_interval_months,
            last_reviewed_on, next_review_on, notes, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NULL, $15, $16, $17, $18, $18)
         RETURNING ${TOOL_COLUMNS}`,
        [
          input.id,
          input.orgId,
          input.name,
          input.vendor,
          input.websiteUrl,
          input.category,
          input.purpose,
          joinDataCategories(input.dataCategories),
          input.riskLevel,
          input.actRole,
          input.status,
          input.ownerEmail,
          input.usersDescription,
          input.reviewIntervalMonths,
          input.nextReviewOn,
          input.notes,
          input.createdBy,
          input.now,
        ],
      );
      if (!row) throw new Error("tally: tool insert returned no row");
      return mapTool(row);
    },

    async getTool(orgId, toolId) {
      const row = await one(`SELECT ${TOOL_COLUMNS} FROM tally_tools WHERE org_id = $1 AND id = $2`, [orgId, toolId]);
      return row ? mapTool(row) : null;
    },

    async listTools(orgId, filter: ListAiToolsFilter = {}) {
      const params: unknown[] = [orgId];
      let where = "org_id = $1";
      if (filter.status) {
        params.push(filter.status);
        where += ` AND status = $${params.length}`;
      }
      if (filter.riskLevel) {
        params.push(filter.riskLevel);
        where += ` AND risk_level = $${params.length}`;
      }
      const result = await executor.execute<Row>(
        `SELECT ${TOOL_COLUMNS} FROM tally_tools WHERE ${where}
          ORDER BY name COLLATE NOCASE ASC, created_at ASC, id ASC LIMIT 1000`,
        params,
      );
      return result.rows.map(mapTool);
    },

    async updateTool(orgId, toolId, input: UpdateAiToolInput) {
      const row = await one(
        `UPDATE tally_tools SET
           name = $3, vendor = $4, website_url = $5, category = $6, purpose = $7,
           data_categories = $8, risk_level = $9, act_role = $10, status = $11, owner_email = $12,
           users_description = $13, review_interval_months = $14, next_review_on = $15, notes = $16,
           updated_at = $17
         WHERE org_id = $1 AND id = $2
         RETURNING ${TOOL_COLUMNS}`,
        [
          orgId,
          toolId,
          input.name,
          input.vendor,
          input.websiteUrl,
          input.category,
          input.purpose,
          joinDataCategories(input.dataCategories),
          input.riskLevel,
          input.actRole,
          input.status,
          input.ownerEmail,
          input.usersDescription,
          input.reviewIntervalMonths,
          input.nextReviewOn,
          input.notes,
          input.now,
        ],
      );
      return row ? mapTool(row) : null;
    },

    async createReview(input: CreateAiToolReviewInput) {
      const row = await one(
        `INSERT INTO tally_tool_reviews
           (id, org_id, tool_id, reviewed_on, decision, risk_level, reviewer_email, notes,
            created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${REVIEW_COLUMNS}`,
        [
          input.id,
          input.orgId,
          input.toolId,
          input.reviewedOn,
          input.decision,
          input.riskLevel,
          input.reviewerEmail,
          input.notes,
          input.createdBy,
          input.createdAt,
        ],
      );
      if (!row) throw new Error("tally: review insert returned no row");
      return mapReview(row);
    },

    async listReviews(orgId, toolId) {
      const result = await executor.execute<Row>(
        `SELECT ${REVIEW_COLUMNS} FROM tally_tool_reviews
          WHERE org_id = $1 AND tool_id = $2
          ORDER BY reviewed_on DESC, created_at DESC, id DESC`,
        [orgId, toolId],
      );
      return result.rows.map(mapReview);
    },

    async applyReview(orgId, toolId, input: ApplyReviewInput) {
      const row = await one(
        `UPDATE tally_tools SET
           status = $3, risk_level = $4, last_reviewed_on = $5, next_review_on = $6, updated_at = $7
         WHERE org_id = $1 AND id = $2
           AND (last_reviewed_on IS NULL OR last_reviewed_on <= $5)
         RETURNING ${TOOL_COLUMNS}`,
        [orgId, toolId, input.decision, input.riskLevel, input.reviewedOn, input.nextReviewOn, input.now],
      );
      return row ? mapTool(row) : null;
    },
  };
}
