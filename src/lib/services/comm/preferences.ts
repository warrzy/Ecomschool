import { prisma } from "@/lib/db/prisma";
import type { CommTopic, MessageChannel, PrefAction } from "@prisma/client";

/**
 * Consentements et préférences de communication.
 * TRANSACTIONAL (sécurité, compte, convocations) n'est jamais désinscriptible.
 * Les autres sujets sont désactivables par canal.
 */

/** true si le canal est autorisé pour ce sujet pour cet utilisateur. */
export async function canContactUser(
  userId: string,
  channel: MessageChannel,
  topic: CommTopic,
) {
  if (topic === "TRANSACTIONAL") return true;
  const pref = await prisma.userCommPreference.findUnique({
    where: { userId_channel_topic: { userId, channel, topic } },
    select: { enabled: true },
  });
  return pref?.enabled ?? true; // opt-out explicite seulement
}

/** Canal SMS/WhatsApp vers un tuteur sans compte : consentement requis. */
export async function canContactGuardian(
  guardianId: string,
  channel: MessageChannel,
  topic: CommTopic,
) {
  const consent = await prisma.guardianCommConsent.findUnique({
    where: { guardianId },
  });
  if (consent?.optOutAll) return topic === "TRANSACTIONAL" ? false : false;
  if (channel === "SMS") return consent?.smsOptIn ?? false;
  if (channel === "WHATSAPP") return consent?.whatsappOptIn ?? false;
  return false;
}

export async function setUserPreference(input: {
  userId: string;
  channel: MessageChannel;
  topic: CommTopic;
  enabled: boolean;
  actorId?: string;
}) {
  if (input.topic === "TRANSACTIONAL" && !input.enabled) {
    return { ok: false as const, error: "TRANSACTIONAL_REQUIRED" };
  }
  await prisma.userCommPreference.upsert({
    where: {
      userId_channel_topic: {
        userId: input.userId,
        channel: input.channel,
        topic: input.topic,
      },
    },
    update: { enabled: input.enabled },
    create: {
      userId: input.userId,
      channel: input.channel,
      topic: input.topic,
      enabled: input.enabled,
    },
  });
  await prisma.commConsentEvent.create({
    data: {
      userId: input.userId,
      channel: input.channel,
      topic: input.topic,
      action: (input.enabled ? "OPT_IN" : "OPT_OUT") satisfies PrefAction,
      actorId: input.actorId ?? null,
    },
  });
  return { ok: true as const };
}

export async function listUserPreferences(userId: string) {
  return prisma.userCommPreference.findMany({
    where: { userId },
    orderBy: [{ channel: "asc" }, { topic: "asc" }],
  });
}

export async function consentHistory(userId: string) {
  return prisma.commConsentEvent.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function setGuardianConsent(input: {
  schoolId: string;
  guardianId: string;
  smsOptIn?: boolean;
  whatsappOptIn?: boolean;
  optOutAll?: boolean;
}) {
  const g = await prisma.guardian.findFirst({
    where: { id: input.guardianId, schoolId: input.schoolId },
    select: { id: true },
  });
  if (!g) return { ok: false as const, error: "NOT_FOUND" };
  await prisma.guardianCommConsent.upsert({
    where: { guardianId: g.id },
    update: {
      ...(input.smsOptIn !== undefined ? { smsOptIn: input.smsOptIn } : {}),
      ...(input.whatsappOptIn !== undefined
        ? { whatsappOptIn: input.whatsappOptIn }
        : {}),
      ...(input.optOutAll !== undefined ? { optOutAll: input.optOutAll } : {}),
    },
    create: {
      schoolId: input.schoolId,
      guardianId: g.id,
      smsOptIn: input.smsOptIn ?? false,
      whatsappOptIn: input.whatsappOptIn ?? false,
      optOutAll: input.optOutAll ?? false,
    },
  });
  return { ok: true as const };
}
