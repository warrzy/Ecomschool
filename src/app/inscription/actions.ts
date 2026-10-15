"use server";

import { headers } from "next/headers";
import { throttleKey } from "@/lib/auth/ratelimit";
import { createSignupRequest } from "@/lib/services/platform/signup-requests";
import {
  signupRequestSchema,
  type SignupRequestInput,
} from "@/lib/validations/signup";

export type SignupResult =
  | { ok: true }
  | { ok: false; error: string; field?: string; message?: string };

export async function submitSignupRequest(
  raw: SignupRequestInput,
): Promise<SignupResult> {
  // Honeypot : un bot qui remplit le champ invisible reçoit un faux succès —
  // aucune demande n'est enregistrée.
  if (raw.companyUrl && raw.companyUrl.length > 0) {
    return { ok: true };
  }

  // Throttle par IP réelle : Nginx positionne X-Forwarded-For
  // ($proxy_add_x_forwarded_for) — première entrée = client.
  const ip =
    (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  if (!throttleKey(`signup:${ip}`)) {
    return {
      ok: false,
      error: "RATE_LIMITED",
      message: "Trop de demandes — réessayez dans quelques instants.",
    };
  }

  const parsed = signupRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: "INVALID_INPUT",
      field: String(issue?.path.join(".") ?? ""),
      message: issue?.message ?? "Données invalides",
    };
  }

  const res = await createSignupRequest(parsed.data);
  if (!res.ok) {
    if (res.error === "DUPLICATE") {
      return {
        ok: false,
        error: "DUPLICATE",
        message:
          "Une demande est déjà en cours pour cet établissement ou cet email. Notre équipe vous recontactera.",
      };
    }
    if (res.error === "PLAN_NOT_FOUND") {
      return {
        ok: false,
        error: "PLAN_NOT_FOUND",
        field: "planCode",
        message: "La formule choisie n'est plus disponible.",
      };
    }
    return {
      ok: false,
      error: "CREATE_FAILED",
      message: "Une erreur est survenue — veuillez réessayer.",
    };
  }

  return { ok: true };
}
