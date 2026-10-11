import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";

/**
 * Purge planifiée des données à durée de vie limitée.
 * Durées configurables par variables d'environnement (en jours) :
 *   RETENTION_JOB_DAYS        (défaut 90)  — jobs DONE/DEAD + TaskRun
 *   RETENTION_DELIVERY_DAYS   (défaut 365) — MessageDelivery terminées
 *   RETENTION_INVITE_DAYS     (défaut 30)  — invitations utilisées/expirées
 *   RETENTION_AUDIT_DAYS      (défaut 0 = jamais purgé)
 *   RETENTION_NOTIFICATION_DAYS (défaut 0 = jamais purgé)
 * Les notifications, journaux d'audit, messages école, données académiques et
 * financières ne sont jamais supprimés par défaut (conservation historique).
 */

function days(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

function cutoff(dayCount: number): Date | null {
  if (dayCount <= 0) return null;
  return new Date(Date.now() - dayCount * 24 * 3600_000);
}

export function retentionConfig() {
  return {
    jobDays: days("RETENTION_JOB_DAYS", 90),
    deliveryDays: days("RETENTION_DELIVERY_DAYS", 365),
    inviteDays: days("RETENTION_INVITE_DAYS", 30),
    auditDays: days("RETENTION_AUDIT_DAYS", 0),
    notificationDays: days("RETENTION_NOTIFICATION_DAYS", 0),
  };
}

export async function purgeExpiredData() {
  const cfg = retentionConfig();
  const result: Record<string, number> = {};

  const jobsCut = cutoff(cfg.jobDays);
  if (jobsCut) {
    result.taskRuns = (
      await prisma.taskRun.deleteMany({
        where: { finishedAt: { lt: jobsCut } },
      })
    ).count;
    result.jobs = (
      await prisma.job.deleteMany({
        where: {
          status: { in: ["DONE", "DEAD"] },
          finishedAt: { lt: jobsCut },
        },
      })
    ).count;
  }

  const dlvCut = cutoff(cfg.deliveryDays);
  if (dlvCut) {
    // Seules les livraisons terminées ; les SchoolMessage parents sont conservés.
    result.deliveries = (
      await prisma.messageDelivery.deleteMany({
        where: {
          status: { in: ["SENT", "FAILED", "SKIPPED", "BLOCKED"] },
          createdAt: { lt: dlvCut },
          // Ne pas purger les marqueurs de déduplication (sans destinataire) :
          // leur conservation garantit l'idempotence.
          OR: [{ userId: { not: null } }, { guardianId: { not: null } }],
        },
      })
    ).count;
  }

  const invCut = cutoff(cfg.inviteDays);
  if (invCut) {
    result.invites = (
      await prisma.accountInvite.deleteMany({
        where: {
          OR: [{ usedAt: { lt: invCut } }, { expiresAt: { lt: invCut } }],
        },
      })
    ).count;
  }

  const audCut = cutoff(cfg.auditDays);
  if (audCut) {
    result.auditLogs = (
      await prisma.auditLog.deleteMany({
        where: { createdAt: { lt: audCut } },
      })
    ).count;
  }

  const notifCut = cutoff(cfg.notificationDays);
  if (notifCut) {
    result.notifications = (
      await prisma.notification.deleteMany({
        where: { createdAt: { lt: notifCut }, readAt: { not: null } },
      })
    ).count;
  }

  await logAudit({
    actorId: null,
    schoolId: null,
    action: "retention.purge",
    entity: "Retention",
    metadata: result,
  });
  return result;
}
