import { redirect } from "next/navigation";
import { requireSchoolContext } from "@/lib/tenant/context";

export const instant = false;

// Ancienne page « Cours » remplacée par le module Emplois du temps —
// redirection stable pour les URL déjà diffusées.
export default async function Page() {
  await requireSchoolContext();
  redirect("/app/schedules" as never);
}
