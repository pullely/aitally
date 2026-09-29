import {
  addDaysToDate,
  addMonthsToDate,
  daysUntil,
  isEscalationToOrgOwners,
  isEscalationToToolOwner,
  trainingReminderRung,
  type TrainingReminderClaim,
  type TrainingSweepResponse,
} from "@saas/contracts/tally";
import type { Env } from "./env.js";
import { recordAudit, type AuditActor } from "./audit.js";
import { openDb } from "./context.js";
import { assignmentPublicId, coursePublicId } from "./ids.js";
import { sendTrainingAssigned, sendTrainingReminder, type ReminderRole } from "./notify-training.js";
import { toPublicAssignment } from "./present-training.js";

/** The clock's own actor in the audit trail and on the notifications it sends. */
export const CLOCK_ACTOR: AuditActor = { type: "system", id: "tally-training-clock" };

const BATCH = 1000;
/** Open assignments further past due than this are no longer chased. */
const OVERDUE_HORIZON_DAYS = 60;

export interface RunClockOptions {
  /** Only this org (the on-demand sweep). The cron passes none. */
  orgId?: string | undefined;
  requestId?: string | undefined;
}

/**
 * One tick of the training clock for `now`'s UTC date:
 *
 * 1. Re-assignment. A completion `recurrence_months` old on a published course
 *    produces the next cycle's assignment. The next cycle is inserted only
 *    when no open assignment and no later cycle exists, and the UNIQUE
 *    (course, person, cycle) key settles a race — so exactly once.
 * 2. The reminder ladder. Every open assignment due within the next 7 days
 *    (or up to 60 days late) is on the latest rung whose day has come. The
 *    rung is claimed with `INSERT … ON CONFLICT DO NOTHING RETURNING id`, and
 *    mail goes out only when a row comes back, so two ticks on the same day —
 *    or two at once — send each rung once. late3/late7 add the owner of the
 *    course's tool; late14 adds the org's owners.
 */
export async function runClock(env: Env, now: Date, opts: RunClockOptions = {}): Promise<TrainingSweepResponse> {
  const today = now.toISOString().slice(0, 10);
  const nowIso = now.toISOString();
  const result: TrainingSweepResponse = { today, considered: 0, claimed: [], alreadySent: 0, reassigned: [] };
  const db = openDb(env);
  if (!db) return result;
  const requestId = opts.requestId ?? `cron_${now.getTime()}`;

  try {
    // ── 1. annual (recurring) re-assignment ──
    const due = await db.training.listReassignmentCandidates({ orgId: opts.orgId, limit: BATCH });
    for (const { assignment: prev, recurrenceMonths, dueDays } of due) {
      if (!prev.completedAt) continue;
      const anniversary = addMonthsToDate(prev.completedAt.slice(0, 10), recurrenceMonths);
      if (anniversary > today) continue;
      const next = await db.training.createAssignment({
        id: crypto.randomUUID(),
        orgId: prev.orgId,
        courseId: prev.courseId,
        assigneeEmail: prev.assigneeEmail,
        assignedOn: today,
        dueOn: addDaysToDate(today, dueDays),
        assignedBy: null,
        now: nowIso,
      });
      if (!next) continue;
      result.reassigned.push(toPublicAssignment(next, today));
      await sendTrainingAssigned(env, requestId, { subjectType: CLOCK_ACTOR.type, subjectId: CLOCK_ACTOR.id }, {
        orgId: next.orgId,
        assignmentId: next.id,
        cycle: next.cycle,
        courseTitle: next.courseTitle,
        dueOn: next.dueOn,
        address: next.assigneeEmail,
      });
      await recordAudit(db.executor, {
        type: "tally.assignment.created",
        orgId: next.orgId,
        actor: CLOCK_ACTOR,
        requestId,
        subjectKind: "training_assignment",
        subjectId: next.id,
        subjectName: next.courseTitle,
        description: `Re-assigned "${next.courseTitle}" to ${next.assigneeEmail} (cycle ${next.cycle}, due ${next.dueOn}): the last completion was ${prev.completedAt.slice(0, 10)}`,
        payload: {
          assignmentId: assignmentPublicId(next.id),
          courseId: coursePublicId(next.courseId),
          cycle: next.cycle,
          dueOn: next.dueOn,
          previousAssignmentId: assignmentPublicId(prev.id),
          reason: "recurrence",
        },
        occurredAt: nowIso,
      });
    }

    // ── 2. the reminder ladder ──
    const candidates = await db.training.listReminderCandidates({
      from: addDaysToDate(today, -OVERDUE_HORIZON_DAYS),
      through: addDaysToDate(today, 7),
      orgId: opts.orgId,
      limit: BATCH,
    });
    const owners = new Map<string, string[]>();
    for (const c of candidates) {
      const daysRemaining = daysUntil(c.dueOn, today);
      const rung = trainingReminderRung(daysRemaining);
      if (rung === null) continue;
      result.considered += 1;

      const recipients: { address: string; role: ReminderRole }[] = [{ address: c.assigneeEmail, role: "assignee" }];
      const add = (address: string | null, role: ReminderRole): void => {
        const a = address?.trim().toLowerCase();
        if (a && !recipients.some((r) => r.address === a)) recipients.push({ address: a, role });
      };
      if (isEscalationToToolOwner(rung)) add(c.toolOwnerEmail, "tool_owner");
      if (isEscalationToOrgOwners(rung)) {
        if (!owners.has(c.orgId)) owners.set(c.orgId, await db.training.listOwnerEmails(c.orgId));
        for (const o of owners.get(c.orgId) ?? []) add(o, "org_owner");
      }

      const claimed = await db.training.claimReminder({
        id: crypto.randomUUID(),
        orgId: c.orgId,
        assignmentId: c.id,
        rung,
        dueOn: c.dueOn,
        recipients: recipients.map((r) => r.address).join(","),
        sentAt: nowIso,
      });
      if (!claimed) {
        result.alreadySent += 1;
        continue;
      }

      let notified = 0;
      for (const r of recipients) {
        const accepted = await sendTrainingReminder(env, requestId, {
          orgId: c.orgId,
          assignmentId: c.id,
          courseTitle: c.courseTitle,
          assigneeEmail: c.assigneeEmail,
          dueOn: c.dueOn,
          rung,
          daysRemaining,
          toolName: c.toolName,
          address: r.address,
          role: r.role,
        });
        if (accepted) notified += 1;
      }

      const claim: TrainingReminderClaim = {
        assignmentId: assignmentPublicId(c.id),
        courseId: coursePublicId(c.courseId),
        rung,
        dueOn: c.dueOn,
        daysRemaining,
        recipients: recipients.map((r) => r.address),
        notified,
      };
      result.claimed.push(claim);
      await recordAudit(db.executor, {
        type: "tally.reminder.sent",
        orgId: c.orgId,
        actor: CLOCK_ACTOR,
        requestId,
        subjectKind: "training_assignment",
        subjectId: c.id,
        subjectName: c.courseTitle,
        description:
          daysRemaining < 0
            ? `Overdue training reminder (${rung}) for "${c.courseTitle}", due ${c.dueOn}, sent to ${claim.recipients.join(", ")}`
            : `Training reminder (${rung}) for "${c.courseTitle}", due ${c.dueOn}, sent to ${claim.recipients.join(", ")}`,
        payload: { ...claim },
        occurredAt: nowIso,
      });
    }
  } finally {
    await db.dispose();
  }
  return result;
}
