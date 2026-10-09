import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

export const instant = false;

export default async function OnboardingIndex() {
  const session = await getSession();
  if (!session) redirect("/login");

  redirect("/app/onboarding/school");
}
