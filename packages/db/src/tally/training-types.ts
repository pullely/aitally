// Aitally (tally) — AT2 training rows and the repository seam.
//
// Dates are YYYY-MM-DD strings and timestamps ISO-8601 strings, end to end.

export interface QuizQuestionRow {
  prompt: string;
  options: string[];
  correct: number;
}

export interface TrainingCourse {
  id: string;
  orgId: string;
  title: string;
  summary: string;
  toolId: string | null;
  dueDays: number;
  recurrenceMonths: number;
  passMarkPct: number | null;
  quiz: QuizQuestionRow[] | null;
  status: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingCourseFields {
  title: string;
  summary: string;
  toolId: string | null;
  dueDays: number;
  recurrenceMonths: number;
  passMarkPct: number | null;
  quiz: QuizQuestionRow[] | null;
  status: string;
}

export interface CreateTrainingCourseInput extends TrainingCourseFields {
  id: string;
  orgId: string;
  createdBy: string | null;
  now: string;
}

export interface TrainingMaterial {
  id: string;
  orgId: string;
  courseId: string;
  version: number;
  objectKey: string;
  filename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  uploadedBy: string | null;
  uploadedAt: string;
}

export type CreateTrainingMaterialInput = Omit<TrainingMaterial, "version">;

export interface TrainingAssignment {
  id: string;
  orgId: string;
  courseId: string;
  courseTitle: string;
  assigneeEmail: string;
  cycle: number;
  assignedOn: string;
  dueOn: string;
  status: string;
  completedAt: string | null;
  scorePct: number | null;
  materialId: string | null;
  materialSha256: string | null;
  materialVersion: number | null;
  attemptCount: number;
  assignedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAssignmentInput {
  id: string;
  orgId: string;
  courseId: string;
  assigneeEmail: string;
  assignedOn: string;
  dueOn: string;
  assignedBy: string | null;
  now: string;
}

export interface ListAssignmentsFilter {
  status?: string | undefined;
  email?: string | undefined;
  courseId?: string | undefined;
}

export interface CompleteAssignmentInput {
  completedAt: string;
  scorePct: number | null;
  materialId: string;
  materialSha256: string;
}

export interface QuizAttemptInput {
  id: string;
  orgId: string;
  assignmentId: string;
  answers: number[];
  scorePct: number;
  passed: boolean;
  materialSha256: string | null;
  attemptedAt: string;
}

export interface AssignmentCounts {
  total: number;
  open: number;
  completed: number;
  overdue: number;
}

export interface MyAssignmentRow extends TrainingAssignment {
  orgName: string;
  orgSlug: string;
}

/** An open assignment the reminder ladder may act on, with who to escalate to. */
export interface ReminderCandidate {
  id: string;
  orgId: string;
  courseId: string;
  courseTitle: string;
  assigneeEmail: string;
  dueOn: string;
  toolId: string | null;
  toolName: string | null;
  toolOwnerEmail: string | null;
}

export interface ClaimReminderInput {
  id: string;
  orgId: string;
  assignmentId: string;
  rung: string;
  dueOn: string;
  recipients: string;
  sentAt: string;
}

/** A completed assignment in its latest cycle, on a recurring published course. */
export interface ReassignmentCandidate {
  assignment: TrainingAssignment;
  recurrenceMonths: number;
  dueDays: number;
}

export interface TrainingRepository {
  createCourse(input: CreateTrainingCourseInput): Promise<TrainingCourse>;
  getCourse(orgId: string, courseId: string): Promise<TrainingCourse | null>;
  listCourses(orgId: string): Promise<TrainingCourse[]>;
  updateCourse(orgId: string, courseId: string, fields: TrainingCourseFields, now: string): Promise<TrainingCourse | null>;

  /** Insert the next version of a course's material (version = newest + 1). */
  createMaterial(input: CreateTrainingMaterialInput): Promise<TrainingMaterial>;
  getMaterial(orgId: string, courseId: string, materialId: string): Promise<TrainingMaterial | null>;
  /** A course's material versions, newest first. */
  listMaterials(orgId: string, courseId: string): Promise<TrainingMaterial[]>;
  /** The newest material version of every course in the org, by course id. */
  currentMaterials(orgId: string): Promise<Map<string, TrainingMaterial>>;

  setToolUsers(orgId: string, toolId: string, emails: string[], now: string): Promise<string[]>;
  listToolUsers(orgId: string, toolId: string): Promise<string[]>;
  /** Active members' addresses (membership's usr_ subject ids resolved — runbook trap 39). */
  listMemberEmails(orgId: string): Promise<string[]>;
  /** Active org owners' addresses (trap 39). */
  listOwnerEmails(orgId: string): Promise<string[]>;

  /**
   * Assign the next cycle of a course to one address, unless that address
   * already holds an open assignment of it. null: skipped (open already, or a
   * concurrent insert took the cycle). Never judged by rowCount (trap 22).
   */
  createAssignment(input: CreateAssignmentInput): Promise<TrainingAssignment | null>;
  getAssignment(orgId: string, assignmentId: string): Promise<TrainingAssignment | null>;
  listAssignments(orgId: string, filter?: ListAssignmentsFilter): Promise<TrainingAssignment[]>;
  assignmentCounts(orgId: string, today: string): Promise<Map<string, AssignmentCounts>>;
  /** Record a quiz attempt and count it on the assignment. */
  recordAttempt(input: QuizAttemptInput): Promise<void>;
  /** Complete an OPEN assignment, once. null: not open (already completed, excused, or absent). */
  completeAssignment(orgId: string, assignmentId: string, input: CompleteAssignmentInput): Promise<TrainingAssignment | null>;
  /** The caller's assignments in every org they are an active member of. */
  listMyAssignments(email: string, subjectIds: string[]): Promise<MyAssignmentRow[]>;

  listReminderCandidates(opts: { from: string; through: string; orgId?: string | undefined; limit: number }): Promise<ReminderCandidate[]>;
  /** INSERT … ON CONFLICT DO NOTHING RETURNING: true only for the first claim of (assignment, rung, due_on). */
  claimReminder(input: ClaimReminderInput): Promise<boolean>;
  listReassignmentCandidates(opts: { orgId?: string | undefined; limit: number }): Promise<ReassignmentCandidate[]>;
}
