import { prisma } from "@/lib/db/prisma";
import { channelAvailable, getProvider } from "@/lib/services/comm/providers";
import { canContactGuardian, canContactUser } from "@/lib/services/comm/preferences";
import type { CommTopic, DeliveryStatus, MessageChannel } from "@prisma/client";

/** Crée une livraison dédupliquée ; retourne null si doublon. */
export async function createDelivery(input: {
  schoolId?: string | null;
  channel: MessageChannel;
  userId?: string | null;
  guardianId?: string | null;
  address?: string | null;
  messageId?: string | null;
  topic: CommTopic;
  dedupKey?: string;
  subject?: string;
  body: string;
  templateName?: string;
}) {
  try {
    const d = await prisma.messageDelivery.create({
      data: {
        schoolId: input.schoolId,
        messageId: input.messageId ?? null,
        userId: input.userId ?? null,
        guardianId: input.guardianId ?? null,
        channel: input.channel,
        address: input.address ?? null,
        status: "QUEUED",
        dedupKey: input.dedupKey ?? null,
      },
      select: { id: true },
    });
    // Contenu conservé hors ligne de livraison pour envoi asynchrone.
    await prisma.job.create({
      data: {
        type: "delivery.send",
        schoolId: input.schoolId,
        payload: {
          deliveryId: d.id,
          subject: input.subject ?? null,
          body: input.body,
          templateName: input.templateName ?? null,
        } as never,
      },
    });
    return d.id;
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") return null; // doublon
    throw e;
  }
}

/** Résolution de l'adresse du destinataire. */
async function resolveAddress(d: {
  userId: string | null;
  guardianId: string | null;
  channel: MessageChannel;
}) {
  if (d.userId) {
    const u = await prisma.user.findUnique({
      where: { id: d.userId },
      select: { email: true },
    });
    return d.channel === "EMAIL" ? u?.email ?? null : null;
  }
  if (d.guardianId) {
    const g = await prisma.guardian.findUnique({
      where: { id: d.guardianId },
      select: { phone: true, email: true },
    });
    if (d.channel === "SMS" || d.channel === "WHATSAPP") return g?.phone ?? null;
    if (d.channel === "EMAIL") return g?.email ?? null;
  }
  return null;
}

async function updateDelivery(
  id: string,
  data: { status: DeliveryStatus; lastError?: string | null; providerRef?: string; costUnits?: number; sent?: boolean },
) {
  await prisma.messageDelivery.update({
    where: { id },
    data: {
      status: data.status,
      lastError: data.lastError ?? null,
      providerRef: data.providerRef ?? undefined,
      costUnits: data.costUnits ?? undefined,
      attempts: { increment: 1 },
      ...(data.sent ? { sentAt: new Date() } : {}),
    },
  });
}

/**
 * Traite une livraison : consentement → disponibilité du canal → envoi.
 * Lève une erreur retryable pour la file de jobs.
 */
export async function processDelivery(deliveryId: string, content: {
  subject?: string | null;
  body: string;
  templateName?: string | null;
}) {
  const d = await prisma.messageDelivery.findUnique({ where: { id: deliveryId } });
  if (!d || d.status !== "QUEUED") return;

  const message = d.messageId
    ? await prisma.schoolMessage.findUnique({
        where: { id: d.messageId },
        select: { topic: true },
      })
    : null;
  const topic = message?.topic ?? "TRANSACTIONAL";

  // Consentement
  if (d.userId && !(await canContactUser(d.userId, d.channel, topic))) {
    await updateDelivery(d.id, { status: "BLOCKED", lastError: "OPT_OUT" });
    return;
  }
  if (d.guardianId && !d.userId) {
    const ok = await canContactGuardian(d.guardianId, d.channel, topic);
    if (!ok) {
      await updateDelivery(d.id, { status: "BLOCKED", lastError: "NO_CONSENT" });
      return;
    }
  }

  const address = d.address ?? (await resolveAddress(d));
  if (!address) {
    await updateDelivery(d.id, { status: "FAILED", lastError: "NO_ADDRESS" });
    return;
  }
  if (!d.address) {
    await prisma.messageDelivery.update({
      where: { id: d.id },
      data: { address },
    });
  }

  if (!channelAvailable(d.channel)) {
    await updateDelivery(d.id, { status: "FAILED", lastError: "PROVIDER_NOT_CONFIGURED" });
    return;
  }

  const provider = getProvider(d.channel)!;
  const res = await provider.send({
    to: address,
    subject: content.subject ?? undefined,
    body: content.body,
    templateName: content.templateName ?? undefined,
  });

  if (res.ok) {
    await updateDelivery(d.id, {
      status: "SENT",
      sent: true,
      providerRef: res.providerRef,
      costUnits: res.costUnits,
    });
    return;
  }
  if (res.retryable) {
    await updateDelivery(d.id, { status: "QUEUED", lastError: res.error });
    throw new Error(res.error);
  }
  await updateDelivery(d.id, { status: "FAILED", lastError: res.error });
}
