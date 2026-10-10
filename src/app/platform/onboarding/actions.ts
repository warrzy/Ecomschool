"use server";

import { prisma } from "@/lib/db/prisma";
import { requirePlatformPermission } from "@/lib/permissions/guard";
import {
  onboardingCreateSchoolSchema,
  type OnboardingCreateSchoolInput,
} from "@/lib/validations/onboarding";
import { hashPassword } from "@/lib/auth/password";

export async function createSchoolOnboarding(raw: OnboardingCreateSchoolInput) {
  await requirePlatformPermission("platform.schools.manage");

  const parsed = onboardingCreateSchoolSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false as const, error: "INVALID_INPUT" as const };
  }

  const input = parsed.data;

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

      return { schoolId: school.id, adminUserId: adminUser.id };
    });

    return { ok: true as const, result };
  } catch (e) {
    if (e instanceof Error && e.message === "MISSING_SYSTEM_ROLE_ADMIN_SCHOOL") {
      return { ok: false as const, error: "MISSING_SYSTEM_ROLE" as const };
    }
    return { ok: false as const, error: "CREATE_FAILED" as const };
  }
}
