import { redirect } from "next/navigation";
import {
  requirePlatformContext,
  requireSchoolContext,
  type SchoolContext,
} from "@/lib/tenant/context";
import {
  userHasPlatformPermission,
  userHasSchoolPermission,
} from "@/lib/permissions/rbac";

export async function requirePlatformPermission(permissionKey: string) {
  const ctx = await requirePlatformContext();

  const ok = await userHasPlatformPermission({
    userId: ctx.userId,
    permissionKey,
  });

  if (!ok) redirect("/platform" as never);

  return ctx;
}

export async function requireSchoolPermission(permissionKey: string) {
  const ctx = await requireSchoolContext();

  const ok = await userHasSchoolPermission({
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    permissionKey,
  });

  if (!ok) redirect("/app" as never);

  return ctx;
}

export function assertSchoolResourceAccess(
  ctx: SchoolContext,
  resourceSchoolId: string | null | undefined,
) {
  if (!resourceSchoolId || resourceSchoolId !== ctx.schoolId) {
    return false;
  }
  return true;
}
