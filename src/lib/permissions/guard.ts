import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/tenant/context";
import { userHasPermission } from "@/lib/permissions/rbac";

export async function requirePermission(permissionKey: string) {
  const tenant = await requireTenant();
  if (!tenant) redirect("/login");

  const ok = await userHasPermission({
    userId: tenant.userId,
    permissionKey,
  });

  if (!ok) {
    redirect("/app");
  }

  return tenant;
}
