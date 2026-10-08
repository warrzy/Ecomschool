import { userIsSuperAdmin } from "@/lib/permissions/rbac";
import { requireTenant } from "@/lib/tenant/context";
import { redirect } from "next/navigation";
import OnboardingSchoolForm from "@/app/app/onboarding/school/ui/onboarding-school-form";

export const instant = false;

export default async function OnboardingSchoolPage() {
  const tenant = await requireTenant();
  if (!tenant) redirect("/login");

  const isSuperAdmin = await userIsSuperAdmin(tenant.userId);
  if (!isSuperAdmin) redirect("/app");

  return <OnboardingSchoolForm />;
}
