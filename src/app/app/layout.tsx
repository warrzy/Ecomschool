import { requireSessionUser } from "@/lib/tenant/context";
import { userHasPlatformRole } from "@/lib/permissions/rbac";
import { redirect } from "next/navigation";

export const instant = false;

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireSessionUser();

  const isPlatform = await userHasPlatformRole(user.id);
  if (isPlatform) redirect("/platform" as never);

  return <>{children}</>;
}
