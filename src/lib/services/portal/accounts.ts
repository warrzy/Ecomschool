import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { hashPassword, passwordPolicyError } from "@/lib/auth/password";
import { logAudit } from "@/lib/services/audit";
import {
  checkLimit,
  isModuleEnabled,
  subscriptionMatrixV2Enabled,
} from "@/lib/services/platform/modules";

export type PortalAccountsError =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "EMAIL_TAKEN"
  | "ALREADY_LINKED"
  | "INVALID_TOKEN"
  | "MODULE_DISABLED"
  | "LIMIT_USERS"
  | "CREATE_FAILED";

export type PortalAccountsResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: PortalAccountsError };

type SchoolCtx = { userId: string; schoolId: string };

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

/**
 * Garde pré-invitation (matrice V2) : le module portail cible doit être
 * couvert par l'abonnement et le quota utilisateurs doit rester disponible.
 * Inerte tant que SUBSCRIPTION_MATRIX_V2 n'est pas activé.
 */
async function checkInviteAllowed(
  ctx: SchoolCtx,
  portalModule: "PARENT_PORTAL" | "STUDENT_PORTAL",
): Promise<PortalAccountsResult> {
  if (!subscriptionMatrixV2Enabled()) return { ok: true, result: undefined };
  if (!(await isModuleEnabled(ctx.schoolId, portalModule))) {
    return { ok: false, error: "MODULE_DISABLED" };
  }
  const limit = await checkLimit(ctx.schoolId, "users");
  if (!limit.ok) return { ok: false, error: "LIMIT_USERS" };
  return { ok: true, result: undefined };
}

async function createInvitedUser(
  ctx: SchoolCtx,
  input: { email: string; firstName?: string; lastName?: string; roleName: "STUDENT" | "PARENT" },
): Promise<PortalAccountsResult<{ userId: string; token: string }>> {
  const email = input.email.toLowerCase().trim();
  if (!email.includes("@")) return { ok: false, error: "INVALID_INPUT" };

  const role = await prisma.role.findFirst({
    where: { name: input.roleName, scope: "SCHOOL", schoolId: null },
    select: { id: true },
  });
  if (!role) return { ok: false, error: "NOT_FOUND" };

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { ok: false, error: "EMAIL_TAKEN" };

  // Mot de passe aléatoire non communiqué : le compte reste DISABLED tant que
  // l'invitation (token) n'a pas été utilisée pour définir un mot de passe.
  const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
  const token = randomBytes(24).toString("hex");

  try {
    const user = await prisma.user.create({
      data: {
        schoolId: ctx.schoolId,
        email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        status: "DISABLED",
        memberships: {
          create: [{ schoolId: ctx.schoolId, roleId: role.id, status: "ACTIVE" }],
        },
        accountInvites: {
          create: {
            schoolId: ctx.schoolId,
            email,
            token,
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
            createdById: ctx.userId,
          },
        },
      },
      select: { id: true },
    });
    return { ok: true, result: { userId: user.id, token } };
  } catch {
    return { ok: false, error: "CREATE_FAILED" };
  }
}

/** Invite un élève : crée le compte (désactivé) + lien Student.userId + token d'invitation. */
export async function inviteStudentAccount(
  ctx: SchoolCtx,
  input: { studentId: string; email?: string },
): Promise<PortalAccountsResult<{ token: string }>> {
  const student = await prisma.student.findFirst({
    where: { id: input.studentId, schoolId: ctx.schoolId },
    select: { id: true, userId: true, email: true, firstName: true, lastName: true },
  });
  if (!student) return { ok: false, error: "NOT_FOUND" };
  if (student.userId) return { ok: false, error: "ALREADY_LINKED" };

  const email = (input.email ?? student.email ?? "").trim();
  if (!email) return { ok: false, error: "INVALID_INPUT" };

  const gate = await checkInviteAllowed(ctx, "STUDENT_PORTAL");
  if (!gate.ok) return gate;

  const res = await createInvitedUser(ctx, {
    email,
    firstName: student.firstName,
    lastName: student.lastName,
    roleName: "STUDENT",
  });
  if (!res.ok) return res;

  await prisma.student.update({
    where: { id: student.id },
    data: { userId: res.result.userId },
    select: { id: true },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "portal.invite_student",
    entity: "Student",
    entityId: student.id,
    metadata: { email },
  });
  return { ok: true, result: { token: res.result.token } };
}

/** Invite un tuteur/parent : compte désactivé + Guardian.userId + token. */
export async function inviteGuardianAccount(
  ctx: SchoolCtx,
  input: { guardianId: string; email?: string },
): Promise<PortalAccountsResult<{ token: string }>> {
  const guardian = await prisma.guardian.findFirst({
    where: { id: input.guardianId, schoolId: ctx.schoolId },
    select: { id: true, userId: true, email: true, firstName: true, lastName: true },
  });
  if (!guardian) return { ok: false, error: "NOT_FOUND" };
  if (guardian.userId) return { ok: false, error: "ALREADY_LINKED" };

  const email = (input.email ?? guardian.email ?? "").trim();
  if (!email) return { ok: false, error: "INVALID_INPUT" };

  const gate = await checkInviteAllowed(ctx, "PARENT_PORTAL");
  if (!gate.ok) return gate;

  const res = await createInvitedUser(ctx, {
    email,
    firstName: guardian.firstName,
    lastName: guardian.lastName,
    roleName: "PARENT",
  });
  if (!res.ok) return res;

  await prisma.guardian.update({
    where: { id: guardian.id },
    data: { userId: res.result.userId },
    select: { id: true },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "portal.invite_parent",
    entity: "Guardian",
    entityId: guardian.id,
    metadata: { email },
  });
  return { ok: true, result: { token: res.result.token } };
}

/** Renvoie une invitation : révoque les tokens actifs du compte et en émet un nouveau. */
export async function resendInvite(
  ctx: SchoolCtx,
  userId: string,
): Promise<PortalAccountsResult<{ token: string }>> {
  const user = await prisma.user.findFirst({
    where: { id: userId, schoolId: ctx.schoolId },
    select: { id: true, email: true, status: true },
  });
  if (!user || user.status !== "DISABLED") return { ok: false, error: "NOT_FOUND" };

  const token = randomBytes(24).toString("hex");
  await prisma.$transaction([
    prisma.accountInvite.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { expiresAt: new Date() },
    }),
    prisma.accountInvite.create({
      data: {
        schoolId: ctx.schoolId,
        userId: user.id,
        email: user.email,
        token,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        createdById: ctx.userId,
      },
    }),
  ]);
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "portal.invite_resend",
    entity: "User",
    entityId: user.id,
  });
  return { ok: true, result: { token } };
}

/** Active/désactive l'accès d'un compte lié à l'école (élève ou parent). */
export async function setPortalAccountStatus(
  ctx: SchoolCtx,
  input: { userId: string; status: "ACTIVE" | "DISABLED" },
): Promise<PortalAccountsResult> {
  const membership = await prisma.schoolMembership.findFirst({
    where: { userId: input.userId, schoolId: ctx.schoolId },
    select: { id: true, role: { select: { name: true } } },
  });
  if (!membership || !["STUDENT", "PARENT"].includes(membership.role.name)) {
    return { ok: false, error: "NOT_FOUND" };
  }
  await prisma.$transaction([
    prisma.user.update({
      where: { id: input.userId },
      data: { status: input.status },
    }),
    prisma.schoolMembership.update({
      where: { id: membership.id },
      data: { status: input.status === "ACTIVE" ? "ACTIVE" : "INACTIVE" },
    }),
  ]);
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: input.status === "ACTIVE" ? "portal.access_enable" : "portal.access_disable",
    entity: "User",
    entityId: input.userId,
  });
  return { ok: true, result: undefined };
}

/**
 * Acceptation d'invitation (route publique) : définit le mot de passe,
 * active le compte, consomme le token. Jamais de mot de passe en clair ailleurs.
 */
export async function acceptInvite(
  token: string,
  password: string,
): Promise<PortalAccountsResult<{ schoolId: string | null }>> {
  if (passwordPolicyError(password)) return { ok: false, error: "INVALID_INPUT" };
  const invite = await prisma.accountInvite.findFirst({
    where: { token, usedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, userId: true, schoolId: true },
  });
  if (!invite) return { ok: false, error: "INVALID_TOKEN" };

  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.accountInvite.update({
      where: { id: invite.id },
      data: { usedAt: new Date() },
    }),
    prisma.accountInvite.updateMany({
      where: { userId: invite.userId, usedAt: null },
      data: { expiresAt: new Date() },
    }),
    prisma.user.update({
      where: { id: invite.userId },
      data: { passwordHash, status: "ACTIVE" },
    }),
  ]);
  await logAudit({
    actorId: invite.userId,
    schoolId: invite.schoolId,
    action: "portal.invite_accept",
    entity: "User",
    entityId: invite.userId,
  });
  return { ok: true, result: { schoolId: invite.schoolId } };
}

/**
 * Réinitialisation de mot de passe déclenchée par un admin d'école :
 * révoque les tokens actifs, émet un nouveau lien valable 24 h.
 */
export async function requestPasswordReset(
  ctx: SchoolCtx,
  userId: string,
): Promise<PortalAccountsResult<{ token: string }>> {
  // Rattachement vérifié via la membership ACTIVE (User.schoolId legacy).
  const membership = await prisma.schoolMembership.findFirst({
    where: { userId, schoolId: ctx.schoolId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!membership) return { ok: false, error: "NOT_FOUND" };
  const user = await prisma.user.findFirst({
    where: { id: userId, status: "ACTIVE" },
    select: { id: true, email: true },
  });
  if (!user) return { ok: false, error: "NOT_FOUND" };

  const token = randomBytes(24).toString("hex");
  await prisma.$transaction([
    prisma.accountInvite.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { expiresAt: new Date() },
    }),
    prisma.accountInvite.create({
      data: {
        schoolId: ctx.schoolId,
        userId: user.id,
        email: user.email,
        token,
        expiresAt: new Date(Date.now() + 24 * 3600_000),
        createdById: ctx.userId,
      },
    }),
  ]);
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "portal.password_reset_request",
    entity: "User",
    entityId: user.id,
  });

  // Email transactionnel via la file si un fournisseur est configuré.
  const { enqueueJob } = await import("@/lib/services/comm/queue");
  await enqueueJob({
    type: "delivery.password_reset",
    schoolId: ctx.schoolId,
    payload: { userId: user.id, email: user.email, token },
    dedupKey: `pwreset:${user.id}:${Math.floor(Date.now() / 3600_000)}`,
  });
  return { ok: true, result: { token } };
}

/**
 * Réinitialisation en libre-service (route publique) : émet un token et
 * enfile un email si le canal est configuré. Réponse identique quelle que
 * soit l'existence du compte — pas d'énumération d'utilisateurs.
 */
export async function requestPasswordResetPublic(email: string) {
  const emailNorm = email.toLowerCase().trim();
  const user = await prisma.user.findFirst({
    where: { email: emailNorm, status: "ACTIVE" },
    select: { id: true, firstName: true },
  });
  if (!user) return;

  // Rattachement dérivé de la membership ACTIVE (User.schoolId legacy).
  const { getActiveSchoolId } = await import("@/lib/permissions/rbac");
  const schoolId = await getActiveSchoolId(user.id);

  const token = randomBytes(24).toString("hex");
  await prisma.$transaction([
    prisma.accountInvite.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { expiresAt: new Date() },
    }),
    prisma.accountInvite.create({
      data: {
        schoolId,
        userId: user.id,
        email: emailNorm,
        token,
        expiresAt: new Date(Date.now() + 24 * 3600_000),
      },
    }),
  ]);
  await logAudit({
    actorId: user.id,
    schoolId,
    action: "portal.password_reset_self",
    entity: "User",
    entityId: user.id,
  });

  // Envoi transactionnel via la file si un fournisseur email est configuré.
  const { enqueueJob } = await import("@/lib/services/comm/queue");
  await enqueueJob({
    type: "delivery.password_reset",
    schoolId,
    payload: { userId: user.id, email: emailNorm, token },
    dedupKey: `pwreset:${user.id}:${Math.floor(Date.now() / 3600_000)}`,
  });
}

/** Statut des accès pour la fiche élève : compte élève + tuteurs (liés ou non). */
export async function getStudentAccessStatus(ctx: SchoolCtx, studentId: string) {
  const student = await prisma.student.findFirst({
    where: { id: studentId, schoolId: ctx.schoolId },
    select: {
      id: true,
      user: { select: { id: true, email: true, status: true } },
      guardians: {
        select: {
          guardian: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              user: { select: { id: true, email: true, status: true } },
            },
          },
          relation: true,
        },
      },
    },
  });
  if (!student) return null;

  const accountIds = [
    student.user?.id,
    ...student.guardians.map((g) => g.guardian.user?.id),
  ].filter(Boolean) as string[];

  const invites = accountIds.length
    ? await prisma.accountInvite.findMany({
        where: { userId: { in: accountIds }, usedAt: null, expiresAt: { gt: new Date() } },
        select: { userId: true, expiresAt: true },
      })
    : [];

  return { student, pendingInvites: new Set(invites.map((i) => i.userId)) };
}
