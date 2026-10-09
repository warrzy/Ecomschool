import { getSession } from "@/lib/auth/session";
import { userIsSuperAdmin } from "@/lib/permissions/rbac";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";

export async function requireTenant() {
  const session = await getSession();
  if (!session) {
    return null;
  }

  const isSuperAdmin = await userIsSuperAdmin(session.user.id);
  if (isSuperAdmin) {
    return {
      userId: session.user.id,
      schoolId: session.user.schoolId,
      isSuperAdmin,
    };
  }

  const schoolId = session.user.schoolId;
  if (!schoolId) {
    redirect("/app/onboarding" as never);
  }

  const membership = await prisma.schoolMembership.findFirst({
    where: {
      userId: session.user.id,
      schoolId,
      status: "ACTIVE",
    },
    select: { roleId: true },
  });

  if (!membership) {
    redirect("/app/onboarding" as never);
  }

  return {
    userId: session.user.id,
    schoolId,
    isSuperAdmin,
    membershipRoleId: membership.roleId,
  };
}
