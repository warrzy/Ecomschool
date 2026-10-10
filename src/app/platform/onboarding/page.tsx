import { requirePlatformPermission } from "@/lib/permissions/guard";
import OnboardingSchoolForm from "@/app/platform/onboarding/ui/onboarding-school-form";

export const instant = false;

export default async function PlatformOnboardingPage() {
  await requirePlatformPermission("platform.schools.manage");

  return <OnboardingSchoolForm />;
}
