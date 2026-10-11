import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { notifyUsers } from "@/lib/services/notifications";
import { createDelivery } from "@/lib/services/comm/deliver";
import type { CommTopic, MessageAudience, MessageChannel } from "@prisma/client";

export type MessagesResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: "INVALID_INPUT" | "NOT_FOUND" | "INVALID_STATUS" | "CREATE_FAILED" };

type SchoolCtx = { userId: string | null; schoolId: string };

type Recipient = { userId?: string; guardianId?: string };

/** Résolution stricte des destinataires — toujours scopé à l'école. */
async function resolveRecipients(
  schoolId: string,
  input: { audience: MessageAudience; classroomId?: string; guardianId?: string },
): Promise<Recipient[]> {
  switch (input.audience) {
    case "ALL_PARENTS": {
      const guardians = await prisma.guardian.findMany({
        where: { schoolId, status: "ACTIVE" },
        select: { id: true, userId: true },
      });
      return guardians.map((g) => ({ guardianId: g.id, userId: g.userId ?? undefined }));
    }
    case "CLASS_PARENTS": {
      if (!input.classroomId) return [];
      const links = await prisma.studentGuardian.findMany({
        where: {
          schoolId,
          student: {
            enrollments: {
              some: {
                schoolId,
                classroomId: input.classroomId,
                status: "ENROLLED",
              },
            },
          },
        },
        select: { guardian: { select: { id: true, userId: true } } },
      });
      return links.map((l) => ({
        guardianId: l.guardian.id,
        userId: l.guardian.userId ?? undefined,
      }));
    }
    case "GUARDIAN": {
      if (!input.guardianId) return [];
      const g = await prisma.guardian.findFirst({
        where: { id: input.guardianId, schoolId },
        select: { id: true, userId: true },
      });
      return g ? [{ guardianId: g.id, userId: g.userId ?? undefined }] : [];
    }
    case "STUDENTS":
    case "TEACHERS":
    case "STAFF": {
      const roleNames =
        input.audience === "STUDENTS"
          ? ["STUDENT"]
          : input.audience === "TEACHERS"
            ? ["TEACHER"]
            : ["ADMIN_SCHOOL", "FINANCE_MANAGER", "CASHIER"];
      const memberships = await prisma.schoolMembership.findMany({
        where: {
          schoolId,
          status: "ACTIVE",
          user: { status: "ACTIVE" },
          role: { name: { in: roleNames } },
        },
        select: { userId: true },
      });
      return memberships.map((m) => ({ userId: m.userId }));
    }
  }
}

export async function createMessage(
  ctx: SchoolCtx,
  input: {
    subject: string;
    body: string;
    audience: MessageAudience;
    classroomId?: string;
    guardianId?: string;
    channels?: MessageChannel[];
    topic?: CommTopic;
    scheduledAt?: Date;
  },
): Promise<MessagesResult<{ id: string }>> {
  if (!input.subject.trim() || !input.body.trim()) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  if (input.audience === "CLASS_PARENTS" && !input.classroomId) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  if (input.audience === "GUARDIAN" && !input.guardianId) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  // Contrôle strict des cibles : la classe et le tuteur doivent appartenir à l'école.
  if (input.classroomId) {
    const c = await prisma.classroom.findFirst({
      where: { id: input.classroomId, schoolId: ctx.schoolId },
      select: { id: true },
    });
    if (!c) return { ok: false, error: "NOT_FOUND" };
  }
  if (input.guardianId) {
    const g = await prisma.guardian.findFirst({
      where: { id: input.guardianId, schoolId: ctx.schoolId },
      select: { id: true },
    });
    if (!g) return { ok: false, error: "NOT_FOUND" };
  }

  try {
    const m = await prisma.schoolMessage.create({
      data: {
        schoolId: ctx.schoolId,
        subject: input.subject.trim(),
        body: input.body.trim(),
        audience: input.audience,
        classroomId: input.classroomId ?? null,
        guardianId: input.guardianId ?? null,
        channels: input.channels?.length ? input.channels : ["INTERNAL"],
        topic: input.topic ?? "OPTIONAL",
        status: input.scheduledAt && input.scheduledAt > new Date() ? "SCHEDULED" : "DRAFT",
        scheduledAt: input.scheduledAt ?? null,
        createdById: ctx.userId,
      },
      select: { id: true },
    });
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "message.create",
      entity: "SchoolMessage",
      entityId: m.id,
      metadata: { audience: input.audience, channels: input.channels },
    });
    return { ok: true, result: m };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

/**
 * Envoie un message : notifications internes + livraisons par canal,
 * dédupliquées. Le message passe en SENT/PARTIAL/FAILED selon les livraisons.
 */
export async function sendMessage(
  ctx: SchoolCtx,
  messageId: string,
): Promise<MessagesResult<{ recipients: number }>> {
  const m = await prisma.schoolMessage.findFirst({
    where: { id: messageId, schoolId: ctx.schoolId },
  });
  if (!m) return { ok: false, error: "NOT_FOUND" };
  if (m.status === "SENT" || m.status === "CANCELLED") {
    return { ok: false, error: "INVALID_STATUS" };
  }

  const recipients = await resolveRecipients(ctx.schoolId, {
    audience: m.audience,
    classroomId: m.classroomId ?? undefined,
    guardianId: m.guardianId ?? undefined,
  });

  // Canal interne : notification persistante.
  if (m.channels.includes("INTERNAL")) {
    const userIds = recipients.map((r) => r.userId).filter((x): x is string => !!x);
    await notifyUsers({
      schoolId: ctx.schoolId,
      userIds,
      type: "ADMIN_MESSAGE",
      title: m.subject,
      body: m.body.slice(0, 500),
      link: "/app/notifications",
    });
  }

  // Canaux externes : livraisons en file d'attente, dédupliquées par jour.
  const extChannels = m.channels.filter((c) => c !== "INTERNAL");
  const today = new Date().toISOString().slice(0, 10);
  let queued = 0;
  for (const r of recipients) {
    for (const ch of extChannels) {
      const id = await createDelivery({
        schoolId: ctx.schoolId,
        channel: ch,
        userId: r.userId ?? null,
        guardianId: r.guardianId ?? null,
        messageId: m.id,
        topic: m.topic,
        dedupKey: `msg:${m.id}:${ch}:${r.userId ?? r.guardianId}`,
        subject: m.subject,
        body: m.body,
      });
      if (id) queued++;
    }
  }

  await prisma.schoolMessage.update({
    where: { id: m.id },
    data: { status: "SENT", sentAt: new Date() },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "message.send",
    entity: "SchoolMessage",
    entityId: m.id,
    metadata: { recipients: recipients.length, queued, day: today },
  });
  return { ok: true, result: { recipients: recipients.length } };
}

export async function listMessages(
  ctx: SchoolCtx,
  opts: { status?: string; take?: number } = {},
) {
  const messages = await prisma.schoolMessage.findMany({
    where: {
      schoolId: ctx.schoolId,
      ...(opts.status ? { status: opts.status as never } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 50,
    include: { _count: { select: { deliveries: true } } },
  });
  return messages;
}

export async function commDashboard(schoolId: string) {
  const [byStatus, byChannel, scheduled, unread] = await Promise.all([
    prisma.schoolMessage.groupBy({
      by: ["status"],
      where: { schoolId },
      _count: true,
    }),
    prisma.messageDelivery.groupBy({
      by: ["channel", "status"],
      // Les marqueurs de déduplication (sans destinataire) ne sont pas des envois.
      where: {
        schoolId,
        OR: [{ userId: { not: null } }, { guardianId: { not: null } }],
      },
      _count: true,
      _sum: { costUnits: true },
    }),
    prisma.schoolMessage.count({
      where: { schoolId, status: "SCHEDULED" },
    }),
    prisma.notification.count({ where: { schoolId, readAt: null } }),
  ]);
  return {
    messages: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
    deliveries: byChannel.map((d) => ({
      channel: d.channel,
      status: d.status,
      count: d._count,
      cost: d._sum.costUnits ?? 0,
    })),
    scheduled,
    unreadNotifications: unread,
  };
}
