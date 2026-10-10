import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { userHasPlatformRole } from "@/lib/permissions/rbac";

export const instant = false;

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login" as never);

  const isPlatform = await userHasPlatformRole(session.user.id);
  redirect((isPlatform ? "/platform" : "/app") as never);
}
