import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";

export type SupportResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: "INVALID_INPUT" | "NOT_FOUND" | "INVALID_STATUS" | "CREATE_FAILED" };

/**
 * Ouvre une session d'assistance auprès d'un établissement.
 * Durée limitée (défaut 2 h), motif obligatoire, journalisée.
 * La session n'accorde aucun contournement des permissions scolaires :
 * elle trace l'intervention ECOM-TOUCH.
 */
export async function startSupportSession(
  agentUserId: string,
  input: { schoolId: string; reason: string; durationHours?: number; authorizedById?: string },
): Promise<SupportResult<{ id: string }>> {
  const school = await prisma.school.findUnique({
    where: { id: input.schoolId },
    select: { id: true },
  });
  if (!school || !input.reason.trim()) return { ok: false, error: "INVALID_INPUT" };
  if (input.authorizedById) {
    const auth = await prisma.schoolMembership.findFirst({
      where: { schoolId: input.schoolId, userId: input.authorizedById, status: "ACTIVE" },
      select: { id: true },
    });
    if (!auth) return { ok: false, error: "NOT_FOUND" };
  }
  const hours = Math.min(72, Math.max(1, input.durationHours ?? 2));
  try {
    const s = await prisma.supportSession.create({
      data: {
        schoolId: input.schoolId,
        agentId: agentUserId,
        reason: input.reason.trim(),
        authorizedById: input.authorizedById ?? null,
        expiresAt: new Date(Date.now() + hours * 3600000),
      },
      select: { id: true },
    });
    await logAudit({
      actorId: agentUserId,
      schoolId: input.schoolId,
      action: "platform.support.start",
      entity: "SupportSession",
      entityId: s.id,
      metadata: { reason: input.reason, hours },
    });
    return { ok: true, result: s };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

export async function endSupportSession(agentUserId: string, sessionId: string) {
  const s = await prisma.supportSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, schoolId: true },
  });
  if (!s) return { ok: false, error: "NOT_FOUND" as const };
  if (s.status !== "ACTIVE") return { ok: false, error: "INVALID_STATUS" as const };
  await prisma.supportSession.update({
    where: { id: s.id },
    data: { status: "ENDED", endedAt: new Date() },
  });
  await logAudit({
    actorId: agentUserId,
    schoolId: s.schoolId,
    action: "platform.support.end",
    entity: "SupportSession",
    entityId: s.id,
  });
  return { ok: true as const, result: undefined };
}

/** Marque EXPIRED les sessions actives dont l'échéance est dépassée. */
export async function expireSupportSessions() {
  const now = new Date();
  const res = await prisma.supportSession.updateMany({
    where: { status: "ACTIVE", expiresAt: { lt: now } },
    data: { status: "EXPIRED", endedAt: now },
  });
  return res.count;
}

export async function listSupportSessions(schoolId?: string) {
  await expireSupportSessions();
  return prisma.supportSession.findMany({
    where: schoolId ? { schoolId } : {},
    include: {
      school: { select: { name: true, code: true } },
      agent: { select: { email: true, firstName: true, lastName: true } },
      authorizedBy: { select: { email: true, firstName: true, lastName: true } },
    },
    orderBy: { startedAt: "desc" },
    take: 100,
  });
}

/** Session d'assistance active sur une école (pour affichage côté école). */
export async function activeSupportSession(schoolId: string) {
  await expireSupportSessions();
  return prisma.supportSession.findFirst({
    where: { schoolId, status: "ACTIVE" },
    include: { agent: { select: { email: true, firstName: true, lastName: true } } },
    orderBy: { startedAt: "desc" },
  });
}
