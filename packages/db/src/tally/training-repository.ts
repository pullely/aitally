import type { SqlExecutor, SqlRow } from "../d1/executor.js";
import type {
  AssignmentCounts,
  ClaimReminderInput,
  CompleteAssignmentInput,
  CreateAssignmentInput,
  CreateTrainingCourseInput,
  CreateTrainingMaterialInput,
  ListAssignmentsFilter,
  MyAssignmentRow,
  QuizAttemptInput,
  QuizQuestionRow,
  ReassignmentCandidate,
  ReminderCandidate,
  TrainingAssignment,
  TrainingCourse,
  TrainingCourseFields,
  TrainingMaterial,
  TrainingRepository,
} from "./training-types.js";

type Row = SqlRow & Record<string, unknown>;

function str(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function num(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function parseQuiz(raw: unknown): QuizQuestionRow[] | null {
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    return Array.isArray(parsed) ? (parsed as QuizQuestionRow[]) : null;
  } catch {
    return null;
  }
}

function mapCourse(row: Row): TrainingCourse {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    title: row.title as string,
    summary: (row.summary as string) ?? "",
    toolId: str(row.tool_id),
    dueDays: Number(row.due_days),
    recurrenceMonths: Number(row.recurrence_months),
    passMarkPct: num(row.pass_mark_pct),
    quiz: parseQuiz(row.quiz_json),
    status: row.status as string,
    createdBy: str(row.created_by),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapMaterial(row: Row): TrainingMaterial {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    courseId: row.course_id as string,
    version: Number(row.version),
    objectKey: row.object_key as string,
    filename: row.filename as string,
    contentType: row.content_type as string,
    byteSize: Number(row.byte_size),
    sha256: row.sha256 as string,
    uploadedBy: str(row.uploaded_by),
    uploadedAt: row.uploaded_at as string,
  };
}

function mapAssignment(row: Row): TrainingAssignment {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    courseId: row.course_id as string,
    courseTitle: (row.course_title as string) ?? "",
    assigneeEmail: row.assignee_email as string,
    cycle: Number(row.cycle),
    assignedOn: row.assigned_on as string,
    dueOn: row.due_on as string,
    status: row.status as string,
    completedAt: str(row.completed_at),
    scorePct: num(row.score_pct),
    materialId: str(row.material_id),
    materialSha256: str(row.material_sha256),
    materialVersion: num(row.material_version),
    attemptCount: Number(row.attempt_count ?? 0),
    assignedBy: str(row.assigned_by),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

const COURSE_COLUMNS = `id, org_id, title, summary, tool_id, due_days, recurrence_months, pass_mark_pct,
  quiz_json, status, created_by, created_at, updated_at`;

const MATERIAL_COLUMNS = `id, org_id, course_id, version, object_key, filename, content_type, byte_size,
  sha256, uploaded_by, uploaded_at`;

const ASSIGNMENT_COLUMNS = `id, org_id, course_id, assignee_email, cycle, assigned_on, due_on, status,
  completed_at, score_pct, material_id, material_sha256, attempt_count, assigned_by, created_at, updated_at`;

/** Assignment columns, qualified by `a`, joined to their course's title and the material version taken. */
const ASSIGNMENT_SELECT = `SELECT a.id, a.org_id, a.course_id, a.assignee_email, a.cycle, a.assigned_on, a.due_on,
         a.status, a.completed_at, a.score_pct, a.material_id, a.material_sha256, a.attempt_count,
         a.assigned_by, a.created_at, a.updated_at, c.title AS course_title, m.version AS material_version
    FROM tally_assignments a
    JOIN tally_courses c ON c.id = a.course_id
    LEFT JOIN tally_course_materials m ON m.id = a.material_id`;

/**
 * Membership stores a user's subject id as the PUBLIC `usr_<32 hex>` on D1,
 * while identity_users.id is the UUID (runbook trap 39). A join on the raw
 * value matches nothing, silently. Match either form: the raw value (a UUID
 * subject) or the UUID rebuilt from the public id's hex.
 */
const IDENTITY_JOIN = (col: string): string => `JOIN identity_users u
      ON u.id IN (
           ${col},
           lower(substr(${col}, 5, 8) || '-' || substr(${col}, 13, 4) || '-' ||
                 substr(${col}, 17, 4) || '-' || substr(${col}, 21, 4) || '-' ||
                 substr(${col}, 25, 12))
         )
     AND u.status = 'active'`;

function quizJson(quiz: QuizQuestionRow[] | null): string | null {
  return quiz === null ? null : JSON.stringify(quiz);
}

export function createTrainingRepository(executor: SqlExecutor): TrainingRepository {
  async function one(sql: string, params: unknown[]): Promise<Row | null> {
    const result = await executor.execute<Row>(sql, params);
    return result.rows[0] ?? null;
  }
  async function all(sql: string, params: unknown[]): Promise<Row[]> {
    return (await executor.execute<Row>(sql, params)).rows;
  }
  async function assignmentById(orgId: string, id: string): Promise<TrainingAssignment | null> {
    const row = await one(`${ASSIGNMENT_SELECT} WHERE a.org_id = $1 AND a.id = $2`, [orgId, id]);
    return row ? mapAssignment(row) : null;
  }
  async function toolUsers(orgId: string, toolId: string): Promise<string[]> {
    const rows = await all(`SELECT email FROM tally_tool_users WHERE org_id = $1 AND tool_id = $2 ORDER BY email`, [orgId, toolId]);
    return rows.map((r) => r.email as string);
  }
  async function emails(sql: string, params: unknown[]): Promise<string[]> {
    const rows = await all(sql, params);
    return [...new Set(rows.map((r) => str(r.email)).filter((e): e is string => !!e))];
  }

  return {
    async createCourse(input: CreateTrainingCourseInput) {
      const row = await one(
        `INSERT INTO tally_courses
           (id, org_id, title, summary, tool_id, due_days, recurrence_months, pass_mark_pct, quiz_json,
            status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
         RETURNING ${COURSE_COLUMNS}`,
        [
          input.id,
          input.orgId,
          input.title,
          input.summary,
          input.toolId,
          input.dueDays,
          input.recurrenceMonths,
          input.passMarkPct,
          quizJson(input.quiz),
          input.status,
          input.createdBy,
          input.now,
        ],
      );
      if (!row) throw new Error("tally: course insert returned no row");
      return mapCourse(row);
    },

    async getCourse(orgId, courseId) {
      const row = await one(`SELECT ${COURSE_COLUMNS} FROM tally_courses WHERE org_id = $1 AND id = $2`, [orgId, courseId]);
      return row ? mapCourse(row) : null;
    },

    async listCourses(orgId) {
      const rows = await all(
        `SELECT ${COURSE_COLUMNS} FROM tally_courses WHERE org_id = $1
          ORDER BY title COLLATE NOCASE ASC, created_at ASC, id ASC LIMIT 500`,
        [orgId],
      );
      return rows.map(mapCourse);
    },

    async updateCourse(orgId, courseId, f: TrainingCourseFields, now) {
      const row = await one(
        `UPDATE tally_courses SET
           title = $3, summary = $4, tool_id = $5, due_days = $6, recurrence_months = $7,
           pass_mark_pct = $8, quiz_json = $9, status = $10, updated_at = $11
         WHERE org_id = $1 AND id = $2
         RETURNING ${COURSE_COLUMNS}`,
        [orgId, courseId, f.title, f.summary, f.toolId, f.dueDays, f.recurrenceMonths, f.passMarkPct, quizJson(f.quiz), f.status, now],
      );
      return row ? mapCourse(row) : null;
    },

    async createMaterial(input: CreateTrainingMaterialInput) {
      const row = await one(
        `INSERT INTO tally_course_materials
           (id, org_id, course_id, version, object_key, filename, content_type, byte_size, sha256,
            uploaded_by, uploaded_at)
         VALUES ($1, $2, $3,
                 (SELECT COALESCE(MAX(version), 0) + 1 FROM tally_course_materials WHERE course_id = $3),
                 $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${MATERIAL_COLUMNS}`,
        [
          input.id,
          input.orgId,
          input.courseId,
          input.objectKey,
          input.filename,
          input.contentType,
          input.byteSize,
          input.sha256,
          input.uploadedBy,
          input.uploadedAt,
        ],
      );
      if (!row) throw new Error("tally: material insert returned no row");
      return mapMaterial(row);
    },

    async getMaterial(orgId, courseId, materialId) {
      const row = await one(
        `SELECT ${MATERIAL_COLUMNS} FROM tally_course_materials WHERE org_id = $1 AND course_id = $2 AND id = $3`,
        [orgId, courseId, materialId],
      );
      return row ? mapMaterial(row) : null;
    },

    async listMaterials(orgId, courseId) {
      const rows = await all(
        `SELECT ${MATERIAL_COLUMNS} FROM tally_course_materials WHERE org_id = $1 AND course_id = $2
          ORDER BY version DESC`,
        [orgId, courseId],
      );
      return rows.map(mapMaterial);
    },

    async currentMaterials(orgId) {
      const rows = await all(
        `SELECT ${MATERIAL_COLUMNS} FROM tally_course_materials m
          WHERE m.org_id = $1
            AND m.version = (SELECT MAX(version) FROM tally_course_materials x WHERE x.course_id = m.course_id)`,
        [orgId],
      );
      return new Map(rows.map((r) => [r.course_id as string, mapMaterial(r)]));
    },

    async setToolUsers(orgId, toolId, list, now) {
      // The user list is current state, not evidence: replaced wholesale.
      await executor.execute(`DELETE FROM tally_tool_users WHERE org_id = $1 AND tool_id = $2`, [orgId, toolId]);
      for (const email of list) {
        await executor.execute(
          `INSERT INTO tally_tool_users (org_id, tool_id, email, added_at) VALUES ($1, $2, $3, $4)
           ON CONFLICT (tool_id, email) DO NOTHING RETURNING email`,
          [orgId, toolId, email, now],
        );
      }
      return toolUsers(orgId, toolId);
    },

    listToolUsers: toolUsers,

    async listMemberEmails(orgId) {
      return emails(
        `SELECT u.email_lower AS email
           FROM membership_organization_members m
           ${IDENTITY_JOIN("m.subject_id")}
          WHERE m.org_id = $1 AND m.status = 'active' AND m.subject_type = 'user'
          ORDER BY u.email_lower
          LIMIT 1000`,
        [orgId],
      );
    },

    async listOwnerEmails(orgId) {
      return emails(
        `SELECT u.email_lower AS email
           FROM membership_role_assignments ra
           JOIN membership_organization_members m
             ON m.org_id = ra.org_id AND m.subject_id = ra.subject_id AND m.status = 'active'
           ${IDENTITY_JOIN("ra.subject_id")}
          WHERE ra.org_id = $1 AND ra.role = 'owner' AND ra.scope_kind = 'organization'
            AND ra.revoked_at IS NULL
          ORDER BY ra.created_at ASC, ra.id ASC
          LIMIT 10`,
        [orgId],
      );
    },

    async createAssignment(input: CreateAssignmentInput) {
      // The next cycle for (course, address), unless an open one exists. The
      // UNIQUE (course_id, assignee_email, cycle) key settles a race: the
      // loser's insert does nothing and returns no row.
      const row = await one(
        `INSERT INTO tally_assignments
           (id, org_id, course_id, assignee_email, cycle, assigned_on, due_on, status, attempt_count,
            assigned_by, created_at, updated_at)
         SELECT $1, $2, $3, $4,
                (SELECT COALESCE(MAX(cycle), 0) + 1 FROM tally_assignments WHERE course_id = $3 AND assignee_email = $4),
                $5, $6, 'open', 0, $7, $8, $8
          WHERE NOT EXISTS (
                SELECT 1 FROM tally_assignments
                 WHERE course_id = $3 AND assignee_email = $4 AND status = 'open')
         ON CONFLICT (course_id, assignee_email, cycle) DO NOTHING
         RETURNING id`,
        [input.id, input.orgId, input.courseId, input.assigneeEmail, input.assignedOn, input.dueOn, input.assignedBy, input.now],
      );
      return row ? assignmentById(input.orgId, input.id) : null;
    },

    getAssignment: assignmentById,

    async listAssignments(orgId, filter: ListAssignmentsFilter = {}) {
      const params: unknown[] = [orgId];
      let where = "a.org_id = $1";
      if (filter.status) {
        params.push(filter.status);
        where += ` AND a.status = $${params.length}`;
      }
      if (filter.email) {
        params.push(filter.email);
        where += ` AND a.assignee_email = $${params.length}`;
      }
      if (filter.courseId) {
        params.push(filter.courseId);
        where += ` AND a.course_id = $${params.length}`;
      }
      const rows = await all(
        `${ASSIGNMENT_SELECT} WHERE ${where}
          ORDER BY a.due_on ASC, a.assignee_email ASC, a.cycle DESC LIMIT 2000`,
        params,
      );
      return rows.map(mapAssignment);
    },

    async assignmentCounts(orgId, today) {
      const rows = await all(
        `SELECT course_id,
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN status = 'open' AND due_on < $2 THEN 1 ELSE 0 END) AS overdue
           FROM tally_assignments WHERE org_id = $1 GROUP BY course_id`,
        [orgId, today],
      );
      return new Map<string, AssignmentCounts>(
        rows.map((r) => [
          r.course_id as string,
          { total: Number(r.total), open: Number(r.open ?? 0), completed: Number(r.completed ?? 0), overdue: Number(r.overdue ?? 0) },
        ]),
      );
    },

    async recordAttempt(input: QuizAttemptInput) {
      await one(
        `INSERT INTO tally_quiz_attempts
           (id, org_id, assignment_id, answers_json, score_pct, passed, material_sha256, attempted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          input.id,
          input.orgId,
          input.assignmentId,
          JSON.stringify(input.answers),
          input.scorePct,
          input.passed ? 1 : 0,
          input.materialSha256,
          input.attemptedAt,
        ],
      );
      await one(
        `UPDATE tally_assignments SET attempt_count = attempt_count + 1, updated_at = $3
          WHERE org_id = $1 AND id = $2 RETURNING id`,
        [input.orgId, input.assignmentId, input.attemptedAt],
      );
    },

    async completeAssignment(orgId, assignmentId, input: CompleteAssignmentInput) {
      // Written once: only an open assignment completes, so a replay or a
      // second completion never rewrites the record.
      const row = await one(
        `UPDATE tally_assignments SET
           status = 'completed', completed_at = $3, score_pct = $4, material_id = $5,
           material_sha256 = $6, updated_at = $3
         WHERE org_id = $1 AND id = $2 AND status = 'open'
         RETURNING ${ASSIGNMENT_COLUMNS}`,
        [orgId, assignmentId, input.completedAt, input.scorePct, input.materialId, input.materialSha256],
      );
      return row ? assignmentById(orgId, assignmentId) : null;
    },

    async listMyAssignments(email, subjectIds) {
      if (subjectIds.length === 0) return [];
      const placeholders = subjectIds.map((_, i) => `$${i + 2}`).join(", ");
      const rows = await all(
        `SELECT a.id, a.org_id, a.course_id, a.assignee_email, a.cycle, a.assigned_on, a.due_on,
                a.status, a.completed_at, a.score_pct, a.material_id, a.material_sha256, a.attempt_count,
                a.assigned_by, a.created_at, a.updated_at, c.title AS course_title, m.version AS material_version,
                o.name AS org_name, o.slug AS org_slug
           FROM tally_assignments a
           JOIN tally_courses c ON c.id = a.course_id
           LEFT JOIN tally_course_materials m ON m.id = a.material_id
           JOIN membership_organizations o ON o.id = a.org_id AND o.status = 'active'
          WHERE a.assignee_email = $1
            AND EXISTS (
                SELECT 1 FROM membership_organization_members mm
                 WHERE mm.org_id = a.org_id AND mm.status = 'active' AND mm.subject_id IN (${placeholders}))
          ORDER BY CASE a.status WHEN 'open' THEN 0 ELSE 1 END, a.due_on ASC
          LIMIT 500`,
        [email, ...subjectIds],
      );
      return rows.map((r) => ({ ...mapAssignment(r), orgName: r.org_name as string, orgSlug: r.org_slug as string }));
    },

    async listReminderCandidates(opts) {
      const params: unknown[] = [opts.from, opts.through, opts.limit];
      let orgFilter = "";
      if (opts.orgId) {
        params.push(opts.orgId);
        orgFilter = ` AND a.org_id = $${params.length}`;
      }
      const rows = await all(
        `SELECT a.id, a.org_id, a.course_id, c.title AS course_title, a.assignee_email, a.due_on,
                c.tool_id, t.name AS tool_name, t.owner_email AS tool_owner_email
           FROM tally_assignments a
           JOIN tally_courses c ON c.id = a.course_id AND c.status <> 'archived'
           LEFT JOIN tally_tools t ON t.id = c.tool_id
          WHERE a.status = 'open' AND a.due_on >= $1 AND a.due_on <= $2${orgFilter}
          ORDER BY a.due_on ASC, a.id ASC
          LIMIT $3`,
        params,
      );
      return rows.map(
        (r): ReminderCandidate => ({
          id: r.id as string,
          orgId: r.org_id as string,
          courseId: r.course_id as string,
          courseTitle: r.course_title as string,
          assigneeEmail: r.assignee_email as string,
          dueOn: r.due_on as string,
          toolId: str(r.tool_id),
          toolName: str(r.tool_name),
          toolOwnerEmail: str(r.tool_owner_email),
        }),
      );
    },

    async claimReminder(input: ClaimReminderInput) {
      const row = await one(
        `INSERT INTO tally_reminders (id, org_id, assignment_id, rung, due_on, recipients, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (assignment_id, rung, due_on) DO NOTHING
         RETURNING id`,
        [input.id, input.orgId, input.assignmentId, input.rung, input.dueOn, input.recipients, input.sentAt],
      );
      return row !== null;
    },

    async listReassignmentCandidates(opts) {
      const params: unknown[] = [opts.limit];
      let orgFilter = "";
      if (opts.orgId) {
        params.push(opts.orgId);
        orgFilter = ` AND a.org_id = $${params.length}`;
      }
      const rows = await all(
        `${ASSIGNMENT_SELECT.replace("c.title AS course_title", "c.title AS course_title, c.recurrence_months, c.due_days")}
          WHERE a.status = 'completed' AND c.status = 'published' AND c.recurrence_months > 0${orgFilter}
            AND NOT EXISTS (
                SELECT 1 FROM tally_assignments n
                 WHERE n.course_id = a.course_id AND n.assignee_email = a.assignee_email AND n.cycle > a.cycle)
          ORDER BY a.completed_at ASC
          LIMIT $1`,
        params,
      );
      return rows.map((r) => ({
        assignment: mapAssignment(r),
        recurrenceMonths: Number(r.recurrence_months),
        dueDays: Number(r.due_days),
      }));
    },
  };
}
