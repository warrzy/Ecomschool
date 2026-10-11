import { prisma } from "@/lib/db/prisma";
import { notifyUsers } from "@/lib/services/notifications";
import { sweepSubscriptions } from "@/lib/services/platform/subscriptions";
import { expireSupportSessions } from "@/lib/services/platform/support";
import { registerJobHandler } from "@/lib/services/comm/queue";
import { processDelivery } from "@/lib/services/comm/deliver";

const day = () => new Date().toISOString().slice(0, 10);

/** Marqueur de déduplication persistant (renvoie false si déjà présent). */
async function dedupMarker(schoolId: string, key: string) {
  try {
    await prisma.messageDelivery.create({
      data: {
        schoolId,
        channel: "INTERNAL",
        status: "SENT",
        dedupKey: key,
        sentAt: new Date(),
      },
    });
    return true;
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") return false;
    throw e;
  }
}

async function recordTask(task: string, fn: () => Promise<Record<string, unknown>>) {
  const run = await prisma.taskRun.create({
    data: { task, status: "RUNNING" },
    select: { id: true },
  });
  try {
    const detail = await fn();
    await prisma.taskRun.update({
      where: { id: run.id },
      data: { status: "DONE", detail: detail as never, finishedAt: new Date() },
    });
    return detail;
  } catch (e) {
    await prisma.taskRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        detail: { error: e instanceof Error ? e.message : String(e) } as never,
        finishedAt: new Date(),
      },
    });
    throw e;
  }
}

/** Comptes admin d'une école (ADMIN_SCHOOL actif). */
async function schoolAdminUserIds(schoolId: string) {
  const m = await prisma.schoolMembership.findMany({
    where: {
      schoolId,
      status: "ACTIVE",
      user: { status: "ACTIVE" },
      role: { name: "ADMIN_SCHOOL" },
    },
    select: { userId: true },
  });
  return m.map((x) => x.userId);
}

async function platformOwnerIds() {
  const roles = await prisma.userRole.findMany({
    where: { role: { name: "PLATFORM_OWNER", scope: "PLATFORM" }, user: { status: "ACTIVE" } },
    select: { userId: true },
  });
  return roles.map((r) => r.userId);
}

// ===================== Automatisations ÉCOLE =====================

/** Publication programmée des annonces + messages planifiés. */
export async function runSchoolAutomations(schoolId: string) {
  return recordTask("school.automations", async () => {
    const now = new Date();
    let published = 0;
    let messagesSent = 0;
    let reminders = 0;

    // 1. Annonces programmées arrivées à échéance.
    const due = await prisma.announcement.findMany({
      where: { schoolId, publishedAt: null, scheduledAt: { lte: now } },
      select: { id: true, title: true, audience: true },
    });
    for (const a of due) {
      const claimed = await prisma.announcement.updateMany({
        where: { id: a.id, publishedAt: null },
        data: { publishedAt: now },
      });
      if (claimed.count === 0) continue; // déjà publiée entre-temps
      published++;
      const roleNames =
        a.audience === "PARENTS"
          ? ["PARENT"]
          : a.audience === "STUDENTS"
            ? ["STUDENT"]
            : a.audience === "TEACHERS"
              ? ["TEACHER"]
              : ["PARENT", "STUDENT", "TEACHER", "ADMIN_SCHOOL"];
      const targets = await prisma.schoolMembership.findMany({
        where: { schoolId, status: "ACTIVE", user: { status: "ACTIVE" }, role: { name: { in: roleNames } } },
        select: { userId: true },
      });
      await notifyUsers({
        schoolId,
        userIds: targets.map((t) => t.userId),
        type: "ANNOUNCEMENT",
        title: `Annonce — ${a.title}`,
        link: "/app/announcements",
      });
    }

    // 2. Messages programmés dus.
    const dueMessages = await prisma.schoolMessage.findMany({
      where: { schoolId, status: "SCHEDULED", scheduledAt: { lte: now } },
      select: { id: true },
    });
    const { sendMessage } = await import("@/lib/services/comm/messages");
    for (const m of dueMessages) {
      const claimed = await prisma.schoolMessage.updateMany({
        where: { id: m.id, status: "SCHEDULED" },
        data: { status: "DRAFT" }, // récupéré pour envoi
      });
      if (claimed.count === 0) continue;
      const res = await sendMessage({ userId: null, schoolId }, m.id);
      if (res.ok) messagesSent++;
    }

    // 3. Rappels d'échéances financières (J-3 et en retard) — dédupliqués par jour.
    const in3d = new Date(now.getTime() + 3 * 86400000);
    const installments = await prisma.feeInstallment.findMany({
      where: { schoolId, status: "ACTIVE", dueDate: { lte: in3d } },
      include: {
        student: { select: { firstName: true, lastName: true, userId: true } },
        charge: { select: { amount: true } },
        allocations: {
          where: { payment: { status: "VALIDATED" } },
          select: { amount: true },
        },
      },
      take: 500,
    });
    const discounts = await prisma.feeDiscount.findMany({
      where: { schoolId, status: "ACTIVE" },
      select: { studentId: true, academicYearId: true, type: true, value: true },
    });
    const discountByStudentYear = new Map<string, number>();
    for (const d of discounts) {
      const k = `${d.studentId}:${d.academicYearId}`;
      discountByStudentYear.set(
        k,
        (discountByStudentYear.get(k) ?? 0) + (d.type === "PERCENT" ? 0 : d.value),
      );
    }
    for (const inst of installments) {
      const paid = inst.allocations.reduce((s, a) => s + a.amount, 0);
      // Part de réduction au prorata de l'échéance sur la créance.
      const discTotal =
        discountByStudentYear.get(`${inst.studentId}:${inst.academicYearId}`) ?? 0;
      const discShare =
        inst.charge.amount > 0
          ? Math.min(inst.amount, Math.floor((inst.amount * discTotal) / inst.charge.amount))
          : 0;
      const remaining = Math.max(0, inst.amount - paid - discShare);
      if (remaining <= 0) continue;

      if (!(await dedupMarker(schoolId, `fin-reminder:${inst.id}:${day()}`))) continue;

      const links = await prisma.studentGuardian.findMany({
        where: { schoolId, studentId: inst.studentId },
        select: { guardian: { select: { id: true, userId: true } } },
      });
      const userIds = [
        ...(inst.student.userId ? [inst.student.userId] : []),
        ...links.map((l) => l.guardian.userId).filter((x): x is string => !!x),
      ];
      const name =
        [inst.student.firstName, inst.student.lastName].filter(Boolean).join(" ") ||
        "élève";
      if (userIds.length) {
        await notifyUsers({
          schoolId,
          userIds,
          type: "FINANCE_REMINDER",
          title: `Rappel d'échéance — ${name}`,
          body: `${remaining.toLocaleString("fr-FR")} FCFA dus le ${inst.dueDate.toISOString().slice(0, 10)}.`,
          link: "/parent",
        });
      }
      reminders++;
    }

    return { published, messagesSent, reminders };
  });
}

// ===================== Automatisations PLATEFORME =====================

/** Cycle de vie SaaS quotidien + alertes commerciales. Idempotent. */
export async function runPlatformAutomations() {
  return recordTask("platform.automations", async () => {
    const sweep = await sweepSubscriptions();
    const expiredSessions = await expireSupportSessions();

    // Abonnements arrivant à échéance sous 7 jours → alerte owners + admin école.
    const in7d = new Date(Date.now() + 7 * 86400000);
    const expiring = await prisma.schoolSubscription.findMany({
      where: {
        status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE"] },
        currentPeriodEnd: { lte: in7d, gte: new Date() },
      },
      include: { school: { select: { name: true } }, plan: { select: { name: true } } },
      take: 200,
    });
    const owners = await platformOwnerIds();
    let alerts = 0;
    for (const s of expiring) {
      if (!(await dedupMarker(s.schoolId, `sub-expiry:${s.id}:${day()}`))) continue;
      const adminIds = await schoolAdminUserIds(s.schoolId);
      await notifyUsers({
        schoolId: s.schoolId,
        userIds: adminIds,
        type: "ADMIN_MESSAGE",
        title: "Abonnement bientôt à échéance",
        body: `Votre abonnement ${s.plan.name} arrive à échéance le ${s.currentPeriodEnd.toISOString().slice(0, 10)}.`,
        link: "/app/subscription",
      });
      await notifyUsers({
        schoolId: null,
        userIds: owners,
        type: "ADMIN_MESSAGE",
        title: `Échéance abonnement — ${s.school.name}`,
        body: `${s.plan.name} · échéance ${s.currentPeriodEnd.toISOString().slice(0, 10)} · statut ${s.status}`,
        link: "/platform/subscriptions",
      });
      alerts++;
    }

    // Factures SaaS échues → rappel hebdomadaire (semaine ISO approximative).
    const d0 = new Date();
    const week = `${d0.getUTCFullYear()}-W${String(Math.ceil(((d0.getTime() - Date.UTC(d0.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7)).padStart(2, "0")}`;
    const unpaid = await prisma.platformInvoice.findMany({
      where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: new Date() } },
      include: { school: { select: { name: true } } },
      take: 200,
    });
    let invoiceAlerts = 0;
    for (const inv of unpaid) {
      if (!(await dedupMarker(inv.schoolId, `saas-unpaid:${inv.id}:${week}`))) continue;
      const adminIds = await schoolAdminUserIds(inv.schoolId);
      await notifyUsers({
        schoolId: inv.schoolId,
        userIds: adminIds,
        type: "FINANCE_REMINDER",
        title: `Facture SaaS échue — ${inv.invoiceNumber}`,
        body: `${inv.total.toLocaleString("fr-FR")} FCFA dus depuis le ${inv.dueDate.toISOString().slice(0, 10)}.`,
        link: "/app/subscription",
      });
      await notifyUsers({
        schoolId: null,
        userIds: owners,
        type: "FINANCE_REMINDER",
        title: `Impayé SaaS — ${inv.school.name}`,
        body: `${inv.invoiceNumber} · ${inv.total.toLocaleString("fr-FR")} FCFA · échue`,
        link: "/platform/invoices",
      });
      invoiceAlerts++;
    }

    return { sweep, expiredSessions, expiryAlerts: alerts, invoiceAlerts };
  });
}

/** Enregistre les handlers de jobs (appelé à l'initialisation du worker/route). */
export function registerCommHandlers() {
  registerJobHandler("delivery.send", async (payload) => {
    await processDelivery(String(payload.deliveryId), {
      subject: (payload.subject as string | null) ?? undefined,
      body: String(payload.body ?? ""),
      templateName: (payload.templateName as string | null) ?? undefined,
    });
  });
  registerJobHandler("automation.platform", async () => {
    await runPlatformAutomations();
  });
  registerJobHandler("automation.school", async (payload) => {
    await runSchoolAutomations(String(payload.schoolId));
  });
}

export async function listTaskRuns(take = 30) {
  return prisma.taskRun.findMany({ orderBy: { startedAt: "desc" }, take });
}
