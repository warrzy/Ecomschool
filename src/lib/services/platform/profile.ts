import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { whatsappProfileSchema } from "@/lib/validations/profile";

/**
 * Profil commercial plateforme : le numéro WhatsApp n'est modifiable que
 * par son titulaire (userId du contexte de session, jamais un paramètre
 * externe). Réservé aux porteurs du rôle PLATFORM_SALES.
 */
export async function userIsPlatformSales(userId: string) {
  const count = await prisma.userRole.count({
    where: {
      userId,
      user: { status: "ACTIVE" },
      role: { name: "PLATFORM_SALES", scope: "PLATFORM" },
    },
  });
  return count > 0;
}

export async function getPlatformProfile(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      firstName: true,
      lastName: true,
      whatsappNumber: true,
      whatsappOptIn: true,
    },
  });
}

export async function updateOwnWhatsapp(
  userId: string,
  input: { whatsappNumber: string; whatsappOptIn: boolean },
): Promise<{ ok: true } | { ok: false; error: "FORBIDDEN" | "INVALID_PHONE" | "PHONE_REQUIRED" | "UPDATE_FAILED" }> {
  if (!(await userIsPlatformSales(userId))) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const parsed = whatsappProfileSchema.safeParse({
    whatsappNumber: input.whatsappNumber,
    whatsappOptIn: input.whatsappOptIn,
  });
  if (!parsed.success) return { ok: false, error: "INVALID_PHONE" };

  const whatsappNumber = parsed.data.whatsappNumber || null;
  if (parsed.data.whatsappOptIn && !whatsappNumber) {
    return { ok: false, error: "PHONE_REQUIRED" };
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        whatsappNumber,
        whatsappOptIn: whatsappNumber ? parsed.data.whatsappOptIn : false,
      },
    });
    await logAudit({
      actorId: userId,
      action: "platform.profile.whatsapp",
      entity: "User",
      entityId: userId,
      metadata: { optIn: whatsappNumber ? parsed.data.whatsappOptIn : false },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}
