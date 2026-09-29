import type {
  PublicTrainingAssignment,
  PublicTrainingCourse,
  PublicTrainingMaterial,
  TrainingAssignmentStatus,
  TrainingCourseStatus,
  TrainingQuizQuestion,
} from "@saas/contracts/tally";
import type { QuizQuestionRow, TrainingAssignment, TrainingCourse, TrainingMaterial } from "@saas/db/tally";
import { assignmentPublicId, coursePublicId, materialPublicId, orgPublicId, toolPublicId } from "./ids.js";

export function toPublicMaterial(m: TrainingMaterial): PublicTrainingMaterial {
  return {
    id: materialPublicId(m.id),
    courseId: coursePublicId(m.courseId),
    version: m.version,
    filename: m.filename,
    contentType: m.contentType,
    byteSize: m.byteSize,
    sha256: m.sha256,
    uploadedAt: m.uploadedAt,
  };
}

/** The quiz as a reader sees it: the answers only for someone who may edit the course. */
export function presentQuiz(quiz: QuizQuestionRow[] | null, withAnswers: boolean): TrainingQuizQuestion[] | null {
  if (!quiz) return null;
  return quiz.map((q) => (withAnswers ? { prompt: q.prompt, options: q.options, correct: q.correct } : { prompt: q.prompt, options: q.options }));
}

export function toPublicCourse(c: TrainingCourse, current: TrainingMaterial | null, withAnswers: boolean): PublicTrainingCourse {
  return {
    id: coursePublicId(c.id),
    orgId: orgPublicId(c.orgId),
    title: c.title,
    summary: c.summary,
    toolId: c.toolId ? toolPublicId(c.toolId) : null,
    dueDays: c.dueDays,
    recurrenceMonths: c.recurrenceMonths,
    passMarkPct: c.passMarkPct,
    quiz: presentQuiz(c.quiz, withAnswers),
    status: c.status as TrainingCourseStatus,
    currentMaterial: current ? toPublicMaterial(current) : null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export function toPublicAssignment(a: TrainingAssignment, today: string): PublicTrainingAssignment {
  return {
    id: assignmentPublicId(a.id),
    orgId: orgPublicId(a.orgId),
    courseId: coursePublicId(a.courseId),
    courseTitle: a.courseTitle,
    assigneeEmail: a.assigneeEmail,
    cycle: a.cycle,
    assignedOn: a.assignedOn,
    dueOn: a.dueOn,
    status: a.status as TrainingAssignmentStatus,
    overdue: a.status === "open" && a.dueOn < today,
    completedAt: a.completedAt,
    scorePct: a.scorePct,
    materialSha256: a.materialSha256,
    materialVersion: a.materialVersion,
    attemptCount: a.attemptCount,
    createdAt: a.createdAt,
  };
}
