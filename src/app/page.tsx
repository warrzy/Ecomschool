import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { userIsSuperAdmin } from "@/lib/permissions/rbac";

export const instant = false;

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login" as never);

  const isSuperAdmin = await userIsSuperAdmin(session.user.id);
  redirect((isSuperAdmin ? "/platform" : "/app") as never);
}
