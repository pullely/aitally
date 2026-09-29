import type { SqlExecutor, SqlRow } from "../d1/executor.js";
import type { AiToolReview } from "./types.js";

// Aitally (tally) — AT3 evidence: the reads a pack is built from, and the
// packs themselves. A pack row is inserted once and never updated.

type Row = SqlRow & Record<string, unknown>;

export interface EvidenceFileRow {
  name: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  objectKey: string;
}

export interface EvidencePack {
  id: string;
  orgId: string;
  scope: string;
  subject: string | null;
  asOf: string;
  files: EvidenceFileRow[];
  manifestSha256: string;
  requestedBy: string | null;
  requestedByEmail: string | null;
  createdAt: string;
}

export type CreateEvidencePackInput = EvidencePack;

/** One assignment with its course's tool and the material version taken. */
export interface TrainingRecordRow {
  id: string;
  courseId: string;
  courseTitle: string;
  toolId: string | null;
  assigneeEmail: string;
  cycle: number;
  assignedOn: string;
  dueOn: string;
  status: string;
  completedAt: string | null;
  scorePct: number | null;
  materialVersion: number | null;
  materialSha256: string | null;
  attemptCount: number;
}

export interface EvidenceRepository {
  orgName(orgId: string): Promise<string | null>;
  /** Every review of every tool in the org (retired tools included), oldest first. */
  listOrgReviews(orgId: string): Promise<AiToolReview[]>;
  /** Training records, filtered to one person or to the courses tied to one tool. */
  listTrainingRecords(orgId: string, filter?: { email?: string | undefined; toolId?: string | undefined }): Promise<TrainingRecordRow[]>;
  /** Tools (UUIDs) this address is a named user of. */
  listToolIdsForUser(orgId: string, email: string): Promise<string[]>;
  createPack(input: CreateEvidencePackInput): Promise<EvidencePack>;
  getPack(orgId: string, packId: string): Promise<EvidencePack | null>;
  listPacks(orgId: string): Promise<EvidencePack[]>;
}

function str(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function num(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function mapPack(row: Row): EvidencePack {
  let files: EvidenceFileRow[] = [];
  try {
    const parsed = JSON.parse(String(row.files_json)) as unknown;
    if (Array.isArray(parsed)) files = parsed as EvidenceFileRow[];
  } catch {
    files = [];
  }
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    scope: row.scope as string,
    subject: str(row.subject),
    asOf: row.as_of as string,
    files,
    manifestSha256: row.manifest_sha256 as string,
    requestedBy: str(row.requested_by),
    requestedByEmail: str(row.requested_by_email),
    createdAt: row.created_at as string,
  };
}

const PACK_COLUMNS = `id, org_id, scope, subject, as_of, files_json, manifest_sha256, requested_by,
  requested_by_email, created_at`;

export function createEvidenceRepository(executor: SqlExecutor): EvidenceRepository {
  async function all(sql: string, params: unknown[]): Promise<Row[]> {
    return (await executor.execute<Row>(sql, params)).rows;
  }

  return {
    async orgName(orgId) {
      const rows = await all(`SELECT name FROM membership_organizations WHERE id = $1`, [orgId]);
      return rows[0] ? String(rows[0].name) : null;
    },

    async listOrgReviews(orgId) {
      const rows = await all(
        `SELECT id, org_id, tool_id, reviewed_on, decision, risk_level, reviewer_email, notes, created_by, created_at
           FROM tally_tool_reviews WHERE org_id = $1
          ORDER BY reviewed_on ASC, created_at ASC, id ASC LIMIT 10000`,
        [orgId],
      );
      return rows.map((r) => ({
        id: r.id as string,
        orgId: r.org_id as string,
        toolId: r.tool_id as string,
        reviewedOn: r.reviewed_on as string,
        decision: r.decision as string,
        riskLevel: r.risk_level as string,
        reviewerEmail: str(r.reviewer_email),
        notes: (r.notes as string) ?? "",
        createdBy: str(r.created_by),
        createdAt: r.created_at as string,
      }));
    },

    async listTrainingRecords(orgId, filter = {}) {
      const params: unknown[] = [orgId];
      let where = "a.org_id = $1";
      if (filter.email) {
        params.push(filter.email);
        where += ` AND a.assignee_email = $${params.length}`;
      }
      if (filter.toolId) {
        params.push(filter.toolId);
        where += ` AND c.tool_id = $${params.length}`;
      }
      const rows = await all(
        `SELECT a.id, a.course_id, c.title AS course_title, c.tool_id, a.assignee_email, a.cycle, a.assigned_on,
                a.due_on, a.status, a.completed_at, a.score_pct, m.version AS material_version,
                a.material_sha256, a.attempt_count
           FROM tally_assignments a
           JOIN tally_courses c ON c.id = a.course_id
           LEFT JOIN tally_course_materials m ON m.id = a.material_id
          WHERE ${where}
          ORDER BY a.assignee_email ASC, c.title ASC, a.cycle ASC, a.id ASC
          LIMIT 20000`,
        params,
      );
      return rows.map((r) => ({
        id: r.id as string,
        courseId: r.course_id as string,
        courseTitle: r.course_title as string,
        toolId: str(r.tool_id),
        assigneeEmail: r.assignee_email as string,
        cycle: Number(r.cycle),
        assignedOn: r.assigned_on as string,
        dueOn: r.due_on as string,
        status: r.status as string,
        completedAt: str(r.completed_at),
        scorePct: num(r.score_pct),
        materialVersion: num(r.material_version),
        materialSha256: str(r.material_sha256),
        attemptCount: Number(r.attempt_count ?? 0),
      }));
    },

    async listToolIdsForUser(orgId, email) {
      const rows = await all(`SELECT tool_id FROM tally_tool_users WHERE org_id = $1 AND email = $2 ORDER BY tool_id`, [orgId, email]);
      return rows.map((r) => r.tool_id as string);
    },

    async createPack(input) {
      const rows = await all(
        `INSERT INTO tally_evidence_packs
           (id, org_id, scope, subject, as_of, files_json, manifest_sha256, requested_by, requested_by_email, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${PACK_COLUMNS}`,
        [
          input.id,
          input.orgId,
          input.scope,
          input.subject,
          input.asOf,
          JSON.stringify(input.files),
          input.manifestSha256,
          input.requestedBy,
          input.requestedByEmail,
          input.createdAt,
        ],
      );
      if (!rows[0]) throw new Error("tally: evidence pack insert returned no row");
      return mapPack(rows[0]);
    },

    async getPack(orgId, packId) {
      const rows = await all(`SELECT ${PACK_COLUMNS} FROM tally_evidence_packs WHERE org_id = $1 AND id = $2`, [orgId, packId]);
      return rows[0] ? mapPack(rows[0]) : null;
    },

    async listPacks(orgId) {
      const rows = await all(
        `SELECT ${PACK_COLUMNS} FROM tally_evidence_packs WHERE org_id = $1 ORDER BY created_at DESC, id DESC LIMIT 200`,
        [orgId],
      );
      return rows.map(mapPack);
    },
  };
}
