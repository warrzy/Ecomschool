"use server";

import { redirect } from "next/navigation";
import { requirePlatformContext } from "@/lib/tenant/context";
import { updateOwnWhatsapp } from "@/lib/services/platform/profile";

const back = (path: string): never => redirect(path as never);

/**
 * Le commercial ne modifie que son propre profil : l'identifiant vient
 * exclusivement du contexte de session — aucun userId n'est accepté
 * dans le formulaire.
 */
export async function updateWhatsappAction(formData: FormData) {
  const ctx = await requirePlatformContext();
  const res = await updateOwnWhatsapp(ctx.userId, {
    whatsappNumber: String(formData.get("whatsappNumber") ?? ""),
    whatsappOptIn: formData.get("whatsappOptIn") === "on",
  });
  back(
    res.ok
      ? "/platform/profile?ok=1"
      : `/platform/profile?error=${res.error}`,
  );
}
