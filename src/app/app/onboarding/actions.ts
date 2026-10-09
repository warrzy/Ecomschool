"use server";

import { prisma } from "@/lib/db/prisma";
import { requireTenant } from "@/lib/tenant/context";
import { userIsSuperAdmin } from "@/lib/permissions/rbac";
import {
  onboardingCreateSchoolSchema,
  type OnboardingCreateSchoolInput,
} from "@/lib/validations/onboarding";
import { hashPassword } from "@/lib/auth/password";

export async function createSchoolOnboarding(raw: OnboardingCreateSchoolInput) {
  const tenant = await requireTenant();
  if (!tenant) {
    return { ok: false as const, error: "UNAUTHORIZED" as const };
  }

  const isSuperAdmin = await userIsSuperAdmin(tenant.userId);
  if (!isSuperAdmin) {
    return { ok: false as const, error: "FORBIDDEN" as const };
  }

  const parsed = onboardingCreateSchoolSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false as const, error: "INVALID_INPUT" as const };
  }

  const input = parsed.data;

  const adminPasswordHash = await hashPassword(input.adminPassword);

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
        name: p.name,
        number: p.number,
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        type: input.periodType,
      })),
    });

    const existingAdminRole = await tx.role.findFirst({
      where: {
        name: "ADMIN_SCHOOL",
        scope: "SCHOOL",
        schoolId: school.id,
      },
      select: { id: true },
    });

    const adminRole =
      existingAdminRole ??
      (await tx.role.create({
        data: {
          name: "ADMIN_SCHOOL",
          scope: "SCHOOL",
          schoolId: school.id,
          description: "Administrateur établissement",
        },
        select: { id: true },
      }));

    const adminUser = await tx.user.create({
      data: {
        schoolId: school.id,
        email: input.adminEmail.toLowerCase(),
        passwordHash: adminPasswordHash,
        firstName: input.adminFirstName,
        lastName: input.adminLastName,
        status: "ACTIVE",
        userRoles: {
          create: [{ roleId: adminRole.id }],
        },
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
}
