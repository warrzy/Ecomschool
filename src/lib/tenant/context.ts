import { getSession } from "@/lib/auth/session";
import {
  getActiveMembership,
  getActiveUser,
  userHasPlatformRole,
} from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import { redirect } from "next/navigation";

export type SessionUser = {
  id: string;
  schoolId: string | null;
};

export type SchoolContext = {
  userId: string;
  schoolId: string;
  membershipId: string;
  roleId: string;
  roleName: string;
};

export type PlatformContext = {
  userId: string;
};

export async function requireSessionUser(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect("/login" as never);

  const user = await getActiveUser(session.user.id);
  if (!user) redirect("/login" as never);

  return { id: user.id, schoolId: user.schoolId };
}

export async function requirePlatformContext(): Promise<PlatformContext> {
  const user = await requireSessionUser();

  const isPlatform = await userHasPlatformRole(user.id);
  if (!isPlatform) redirect("/app" as never);

  return { userId: user.id };
}

export async function requireSchoolContext(): Promise<SchoolContext> {
  const user = await requireSessionUser();

  const isPlatform = await userHasPlatformRole(user.id);
  if (isPlatform) redirect("/platform" as never);

  const schoolId = user.schoolId;
  if (!schoolId) redirect("/app/onboarding" as never);

  const school = await prisma.school.findFirst({
    where: { id: schoolId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!school) redirect("/app/onboarding?reason=suspended" as never);

  const membership = await getActiveMembership({
    userId: user.id,
    schoolId,
  });
  if (!membership) redirect("/app/onboarding" as never);

  return {
    userId: user.id,
    schoolId,
    membershipId: membership.id,
    roleId: membership.roleId,
    roleName: membership.role.name,
  };
}
