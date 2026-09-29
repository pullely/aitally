import { isUuid, uuidFromPublicId, uuidToHex, type Uuid } from "@saas/db/ids";

export function generateRequestId(): string {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  let hex = "";
  for (let i = 0; i < buf.length; i++) hex += buf[i]!.toString(16).padStart(2, "0");
  return `req_${hex}`;
}

export const orgPublicId = (uuid: string): string => `org_${uuidToHex(uuid)}`;
export const parseOrgPublicId = (id: string): Uuid | null => uuidFromPublicId(id, "org");

export const toolPublicId = (uuid: string): string => `ait_${uuidToHex(uuid)}`;
export const parseToolPublicId = (id: string): Uuid | null => uuidFromPublicId(id, "ait");

export const reviewPublicId = (uuid: string): string => `atr_${uuidToHex(uuid)}`;

// AT2 — training.
export const coursePublicId = (uuid: string): string => `atc_${uuidToHex(uuid)}`;
export const parseCoursePublicId = (id: string): Uuid | null => uuidFromPublicId(id, "atc");
export const materialPublicId = (uuid: string): string => `atm_${uuidToHex(uuid)}`;
export const parseMaterialPublicId = (id: string): Uuid | null => uuidFromPublicId(id, "atm");
export const assignmentPublicId = (uuid: string): string => `ata_${uuidToHex(uuid)}`;
export const parseAssignmentPublicId = (id: string): Uuid | null => uuidFromPublicId(id, "ata");

/**
 * Every form membership may hold this actor's subject id in: as sent, the
 * `usr_<hex>` public id and the UUID (runbook trap 39 — D1 membership rows
 * carry `usr_<hex>`, identity the UUID).
 */
export function subjectIdForms(subjectId: string): string[] {
  const uuid = actorSubjectUuid(subjectId);
  const forms = new Set<string>([subjectId]);
  if (uuid) {
    forms.add(uuid);
    forms.add(`usr_${uuidToHex(uuid)}`);
  }
  return [...forms];
}

/**
 * The actor id in the shape a UUID column takes: pass a UUID through, decode a
 * `usr_<hex>` public id, and write null rather than garbage for anything else.
 */
export function actorSubjectUuid(subjectId: string): string | null {
  if (isUuid(subjectId)) return subjectId;
  return uuidFromPublicId(subjectId);
}
