import { getSession } from "@/lib/auth/session";
import { userIsSuperAdmin } from "@/lib/permissions/rbac";

export async function requireTenant() {
  const session = await getSession();
  if (!session) {
    return null;
  }

  const schoolId = session.user.schoolId;
  if (!schoolId) {
    return null;
  }

  const isSuperAdmin = await userIsSuperAdmin(session.user.id);

  return {
    userId: session.user.id,
    schoolId,
    isSuperAdmin,
  };
}
