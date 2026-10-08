import { getSession } from "@/lib/auth/session";

export async function requireTenant() {
  const session = await getSession();
  if (!session) {
    return null;
  }

  const schoolId = session.user.schoolId;
  if (!schoolId) {
    return null;
  }

  return {
    userId: session.user.id,
    schoolId,
  };
}
