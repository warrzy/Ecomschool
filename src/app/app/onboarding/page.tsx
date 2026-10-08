import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/tenant/context";

export const instant = false;

export default async function OnboardingIndex() {
  const tenant = await requireTenant();
  if (!tenant) redirect("/login");

  redirect("/app/onboarding/school");
}
