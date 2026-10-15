import { requirePlatformPermission } from "@/lib/permissions/guard";
import { getSignupRequest } from "@/lib/services/platform/signup-requests";
import OnboardingSchoolForm, {
  type OnboardingDefaults,
} from "@/app/platform/onboarding/ui/onboarding-school-form";

export const instant = false;

export default async function PlatformOnboardingPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformPermission("platform.schools.manage");
  const sp = (await props.searchParams) ?? {};
  const from = typeof sp.from === "string" ? sp.from : undefined;

  // Préremplissage depuis une demande d'inscription approuvée.
  // Seules les coordonnées de l'ÉTABLISSEMENT sont préremplies — le choix du
  // futur compte administrateur reste à la main de l'admin plateforme.
  let signupRequestId: string | undefined;
  let defaults: OnboardingDefaults | undefined;
  let prospect: { contactName: string; contactEmail: string; contactPhone: string | null; planName: string | null } | undefined;
  if (from) {
    const req = await getSignupRequest(from);
    if (req && req.status !== "CONVERTED" && req.status !== "REJECTED") {
      signupRequestId = req.id;
      defaults = {
        name: req.schoolName,
        city: req.city ?? undefined,
        phone: req.phone ?? undefined,
        email: req.email ?? undefined,
      };
      prospect = {
        contactName: req.contactName,
        contactEmail: req.contactEmail,
        contactPhone: req.contactPhone,
        planName: req.requestedPlan?.name ?? null,
      };
    }
  }

  return (
    <OnboardingSchoolForm
      signupRequestId={signupRequestId}
      defaults={defaults}
      prospect={prospect}
    />
  );
}
