import { userIsSuperAdmin } from "@/lib/permissions/rbac";
import { redirect } from "next/navigation";
import OnboardingSchoolForm from "@/app/app/onboarding/school/ui/onboarding-school-form";
import { getSession } from "@/lib/auth/session";

export const instant = false;

export default async function OnboardingSchoolPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const isSuperAdmin = await userIsSuperAdmin(session.user.id);
  if (!isSuperAdmin) redirect("/app");

  return <OnboardingSchoolForm />;
}
