"use server";

import { prisma } from "@/lib/db/prisma";
import { requirePlatformPermission } from "@/lib/permissions/guard";
import {
  onboardingCreateSchoolSchema,
  type OnboardingCreateSchoolInput,
} from "@/lib/validations/onboarding";
import { claimSignupRequestForConversion } from "@/lib/services/platform/signup-requests";
import { hashPassword } from "@/lib/auth/password";

export async function createSchoolOnboarding(raw: OnboardingCreateSchoolInput) {
  await requirePlatformPermission("platform.schools.manage");

  const parsed = onboardingCreateSchoolSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false as const,
      error: "INVALID_INPUT" as const,
      field: String(issue?.path.join(".") ?? ""),
      message: issue?.message ?? "Données invalides",
    };
  }

  const input = parsed.data;

  // Contrôles de doublons explicites (contraintes uniques en base).
  const [codeTaken, slugTaken, emailTaken] = await Promise.all([
    prisma.school.findFirst({ where: { code: input.code }, select: { id: true } }),
    prisma.school.findFirst({ where: { slug: input.slug }, select: { id: true } }),
    prisma.user.findUnique({ where: { email: input.adminEmail }, select: { id: true } }),
  ]);
  if (codeTaken) {
    return { ok: false as const, error: "CODE_TAKEN" as const, field: "code", message: "Ce code est déjà utilisé par un établissement" };
  }
  if (slugTaken) {
    return { ok: false as const, error: "SLUG_TAKEN" as const, field: "slug", message: "Ce slug est déjà utilisé par un établissement" };
  }
  if (emailTaken) {
    return { ok: false as const, error: "EMAIL_TAKEN" as const, field: "adminEmail", message: "Cet email est déjà associé à un compte" };
  }

  // Conversion d'une demande d'inscription : doit exister et être APPROVED.
  let requestedPlan: { id: string; name: string } | null = null;
  if (input.signupRequestId) {
    const req = await prisma.schoolSignupRequest.findUnique({
      where: { id: input.signupRequestId },
      select: {
        status: true,
        requestedPlan: { select: { id: true, name: true } },
      },
    });
    if (!req) {
      return { ok: false as const, error: "REQUEST_NOT_FOUND" as const, field: "signupRequestId", message: "Demande d'inscription introuvable" };
    }
    if (req.status === "CONVERTED") {
      return { ok: false as const, error: "ALREADY_CONVERTED" as const, field: "signupRequestId", message: "Cette demande a déjà été convertie en établissement" };
    }
    if (req.status !== "APPROVED") {
      return { ok: false as const, error: "REQUEST_NOT_APPROVED" as const, field: "signupRequestId", message: "La demande doit être approuvée avant conversion" };
    }
    requestedPlan = req.requestedPlan;
  }

  const adminPasswordHash = await hashPassword(input.adminPassword);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const school = await tx.school.create({
        data: {
          name: input.name,
          code: input.code,
          slug: input.slug,
          city: input.city,
          phone: input.phone,
          email: input.email,
          website: input.website,
          country: "BF",
          currency: "XOF",
          timezone: "Africa/Ouagadougou",
          locale: "fr",
          status: "ACTIVE",
        },
        select: { id: true },
      });

      const year = await tx.academicYear.create({
        data: {
          schoolId: school.id,
          name: input.academicYearName,
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
          isCurrent: true,
          status: "ACTIVE",
        },
        select: { id: true },
      });

      const periods =
        input.periodType === "TRIMESTER"
          ? [
              { name: "Trimestre 1", number: 1 },
              { name: "Trimestre 2", number: 2 },
              { name: "Trimestre 3", number: 3 },
            ]
          : [
              { name: "Semestre 1", number: 1 },
              { name: "Semestre 2", number: 2 },
            ];

      await tx.academicPeriod.createMany({
        data: periods.map((p) => ({
          academicYearId: year.id,
          schoolId: school.id,
          name: p.name,
          number: p.number,
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
          type: input.periodType,
        })),
      });

      const adminRole = await tx.role.findFirst({
        where: {
          name: "ADMIN_SCHOOL",
          scope: "SCHOOL",
          schoolId: null,
        },
        select: { id: true },
      });

      if (!adminRole) {
        throw new Error("MISSING_SYSTEM_ROLE_ADMIN_SCHOOL");
      }

      const adminUser = await tx.user.create({
        data: {
          schoolId: school.id,
          email: input.adminEmail.toLowerCase(),
          passwordHash: adminPasswordHash,
          firstName: input.adminFirstName,
          lastName: input.adminLastName,
          status: "ACTIVE",
        },
        select: { id: true },
      });

      await tx.schoolMembership.create({
        data: {
          schoolId: school.id,
          userId: adminUser.id,
          roleId: adminRole.id,
          status: "ACTIVE",
        },
        select: { id: true },
      });

      // Revendication atomique : si la demande a été convertie entre-temps,
      // l'échec fait échouer la transaction → aucune école orpheline.
      if (input.signupRequestId) {
        const claimed = await claimSignupRequestForConversion(
          tx,
          input.signupRequestId,
          school.id,
        );
        if (!claimed) throw new Error("REQUEST_ALREADY_CONVERTED");
      }

      return { schoolId: school.id, adminUserId: adminUser.id };
    });

    // requestedPlan : l'attribution reste manuelle depuis la fiche école —
    // la demande conserve le plan souhaité jusqu'à la confirmation commerciale.
    return { ok: true as const, result: { ...result, requestedPlan } };
  } catch (e) {
    if (e instanceof Error && e.message === "MISSING_SYSTEM_ROLE_ADMIN_SCHOOL") {
      return { ok: false as const, error: "MISSING_SYSTEM_ROLE" as const };
    }
    if (e instanceof Error && e.message === "REQUEST_ALREADY_CONVERTED") {
      return { ok: false as const, error: "ALREADY_CONVERTED" as const, field: "signupRequestId" as const, message: "Cette demande a déjà été convertie en établissement" };
    }
    return { ok: false as const, error: "CREATE_FAILED" as const };
  }
}
