"use server";

import { redirect } from "next/navigation";
import { requestPasswordResetPublic } from "@/lib/services/portal/accounts";
import { throttleKey } from "@/lib/auth/ratelimit";
import { headers } from "next/headers";

export async function requestResetAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const ip =
    (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  // Throttle mémoire : max ~5 demandes/30 s par IP.
  if (throttleKey(`pwreset:${ip}`)) {
    await requestPasswordResetPublic(email).catch(() => null);
  }
  // Réponse constante — aucune indication sur l'existence du compte.
  redirect("/reset-password?ok=1" as never);
}
