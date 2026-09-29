import { buildIdempotencyKey, enqueueNotification } from "@saas/notifications-client";
import type { TrainingReminderRung } from "@saas/contracts/tally";
import type { Env } from "./env.js";
import { assignmentPublicId } from "./ids.js";

export type ReminderRole = "assignee" | "tool_owner" | "org_owner";

export interface AssignedMail {
  orgId: string;
  assignmentId: string;
  cycle: number;
  courseTitle: string;
  dueOn: string;
  address: string;
}

/**
 * Tell a staff member they have AI-literacy training to complete. Idempotent
 * per assignment, so a retried request never emails twice. Advisory: the
 * assignment is the record; a refused send never fails it.
 */
export async function sendTrainingAssigned(
  env: Env,
  requestId: string,
  actor: { subjectType: string; subjectId: string },
  mail: AssignedMail,
): Promise<boolean> {
  try {
    const result = await enqueueNotification(
      env,
      { internalActor: "tally-worker", actorSubjectType: actor.subjectType, actorSubjectId: actor.subjectId, requestId },
      {
        orgId: mail.orgId,
        category: "product",
        templateKey: "tally.training.assigned",
        templateData: {
          courseTitle: mail.courseTitle,
          dueOn: mail.dueOn,
          cycle: mail.cycle,
          trainingUrl: "",
        },
        recipient: { channel: "email", address: mail.address },
        idempotencyKey: buildIdempotencyKey("tally.training.assigned", assignmentPublicId(mail.assignmentId)),
      },
    );
    return result.ok;
  } catch {
    return false;
  }
}

export interface ReminderMail {
  orgId: string;
  assignmentId: string;
  courseTitle: string;
  assigneeEmail: string;
  dueOn: string;
  rung: TrainingReminderRung;
  daysRemaining: number;
  toolName: string | null;
  address: string;
  role: ReminderRole;
}

/** One rung of the ladder to one recipient. Idempotent per (assignment, rung, due date, address). */
export async function sendTrainingReminder(env: Env, requestId: string, mail: ReminderMail): Promise<boolean> {
  try {
    const result = await enqueueNotification(
      env,
      { internalActor: "tally-worker", actorSubjectType: "system", actorSubjectId: "tally-training-clock", requestId },
      {
        orgId: mail.orgId,
        category: "product",
        templateKey: "tally.training.reminder",
        templateData: {
          courseTitle: mail.courseTitle,
          assigneeEmail: mail.assigneeEmail,
          dueOn: mail.dueOn,
          rung: mail.rung,
          daysRemaining: mail.daysRemaining,
          toolName: mail.toolName ?? "",
          role: mail.role,
          trainingUrl: "",
        },
        recipient: { channel: "email", address: mail.address },
        idempotencyKey: buildIdempotencyKey(
          "tally.training.reminder",
          assignmentPublicId(mail.assignmentId),
          mail.rung,
          mail.dueOn,
          mail.address,
        ),
      },
    );
    return result.ok;
  } catch {
    return false;
  }
}
