import { buildIdempotencyKey, enqueueNotification } from "@saas/notifications-client";
import { AI_RISK_LEVEL_LABELS, type AiRiskLevel } from "@saas/contracts/tally";
import type { AiTool } from "@saas/db/tally";
import type { Env } from "./env.js";
import type { ActorContext } from "./router.js";
import { toolPublicId } from "./ids.js";

/**
 * Tell the accountable owner that a tool in the AI register is theirs. Sent
 * when a tool is registered and when its owner changes. Idempotent per tool
 * and owner, so a retried request never emails twice. Advisory: a failed send
 * never fails the write (the register is the record).
 */
export async function sendOwnerAssigned(env: Env, requestId: string, actor: ActorContext, tool: AiTool): Promise<boolean> {
  try {
    const owner = tool.ownerEmail.toLowerCase();
    const result = await enqueueNotification(
      env,
      {
        internalActor: "tally-worker",
        actorSubjectType: actor.subjectType,
        actorSubjectId: actor.subjectId,
        requestId,
      },
      {
        orgId: tool.orgId,
        category: "product",
        templateKey: "tally.tool.owner_assigned",
        templateData: {
          toolName: tool.name,
          vendor: tool.vendor,
          purpose: tool.purpose,
          riskLabel: AI_RISK_LEVEL_LABELS[tool.riskLevel as AiRiskLevel] ?? tool.riskLevel,
          nextReviewOn: tool.nextReviewOn,
          toolUrl: "",
        },
        recipient: { channel: "email", address: owner },
        idempotencyKey: buildIdempotencyKey("tally.tool.owner_assigned", toolPublicId(tool.id), owner),
      },
    );
    return result.ok;
  } catch {
    return false;
  }
}
