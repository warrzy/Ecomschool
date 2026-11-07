"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  adjustDecision,
  depublishSession,
  publishSession,
  reprepareSession,
  unlockSession,
  validateSession,
} from "@/lib/services/deliberations";

const back = (path: string): never => redirect(path as never);
const detail = (id: string, q: string) => `/app/deliberations/${id}?${q}`;

/** Recalcul des propositions (session ouverte uniquement). */
export async function reprepareAction(formData: FormData) {
  const tenant = await requireSchoolPermission("deliberations.manage");
  const id = String(formData.get("id") ?? "");
  if (!id) return back("/app/deliberations?error=INVALID_INPUT");
  const res = await reprepareSession(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id,
  );
  return back(
    res.ok
      ? detail(id, "ok=deliberation_refreshed")
      : detail(id, `error=${res.error}`),
  );
}

const PROGRESSIONS = [
  "PROMOTION", "REPETITION", "SAME_LEVEL", "CLASS_CHANGE",
  "CYCLE_CHANGE", "RETURN", "REMEDIAL", "DEFERRED", "ORIENTATION", "EXIT",
] as const;

const adjustSchema = z.object({
  decisionId: z.string().min(1),
  sessionId: z.string().min(1),
  ruleId: z.string().optional().or(z.literal("")),
  customLabel: z.string().trim().max(100).optional(),
  progression: z.enum(PROGRESSIONS).optional().or(z.literal("")),
  reason: z.string().trim().max(1000).optional(),
});

/** Ajustement motivé d'une décision individuelle. */
export async function adjustDecisionAction(formData: FormData) {
  const tenant = await requireSchoolPermission("deliberations.manage");
  const parsed = adjustSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return back("/app/deliberations?error=INVALID_INPUT");
  }
  const { sessionId, decisionId, ruleId, customLabel, progression, reason } =
    parsed.data;
  const res = await adjustDecision(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    {
      decisionId,
      ruleId: ruleId || undefined,
      customLabel: customLabel || undefined,
      progression: progression ? progression : undefined,
      reason,
    },
  );
  return back(
    res.ok
      ? detail(sessionId, "ok=deliberation_adjusted")
      : detail(sessionId, `error=${res.error}`),
  );
}

/** Validation du conseil : verrouille toutes les décisions. */
export async function validateAction(formData: FormData) {
  const tenant = await requireSchoolPermission("deliberations.validate");
  const id = String(formData.get("id") ?? "");
  if (!id) return back("/app/deliberations?error=INVALID_INPUT");
  const res = await validateSession(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id,
  );
  return back(
    res.ok
      ? detail(id, "ok=deliberation_validated")
      : detail(id, `error=${res.error}`),
  );
}

/** Déverrouillage motivé — correction post-validation. */
export async function unlockAction(formData: FormData) {
  const tenant = await requireSchoolPermission("deliberations.validate");
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!id) return back("/app/deliberations?error=INVALID_INPUT");
  const res = await unlockSession(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id,
    reason,
  );
  return back(
    res.ok
      ? detail(id, "ok=deliberation_unlocked")
      : detail(id, `error=${res.error}`),
  );
}

/** Publication contrôlée vers bulletins / résultats annuels. */
export async function publishAction(formData: FormData) {
  const tenant = await requireSchoolPermission("deliberations.publish");
  const id = String(formData.get("id") ?? "");
  if (!id) return back("/app/deliberations?error=INVALID_INPUT");
  const res = await publishSession(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id,
  );
  return back(
    res.ok
      ? detail(id, "ok=deliberation_published")
      : detail(id, `error=${res.error}`),
  );
}

/** Dépublication motivée : retour en validée + retrait des libellés. */
export async function depublishAction(formData: FormData) {
  const tenant = await requireSchoolPermission("deliberations.publish");
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!id) return back("/app/deliberations?error=INVALID_INPUT");
  const res = await depublishSession(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id,
    reason,
  );
  return back(
    res.ok
      ? detail(id, "ok=deliberation_depublished")
      : detail(id, `error=${res.error}`),
  );
}
