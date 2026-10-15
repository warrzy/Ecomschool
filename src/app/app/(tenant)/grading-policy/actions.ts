"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  upsertPolicy,
  activatePolicy,
  archivePolicy,
  updatePolicyRow,
  type PolicyInput,
} from "@/lib/services/grading/policy";
import { gradingPolicySchema } from "@/lib/validations/grading";
import { prisma } from "@/lib/db/prisma";

function ctx(t: { userId: string; schoolId: string }) {
  return { userId: t.userId, schoolId: t.schoolId };
}

const failUrl = (code: string) =>
  `/app/grading-policy?error=${code}` as never;

/**
 * "Libellé:seuil;Libellé:seuil" → [{ label, min }].
 * Retourne { invalid: true } si une partie est mal formée.
 */
function parseMentions(raw?: string):
  | { invalid: true }
  | { invalid: false; mentions: { label: string; min: number }[] | undefined } {
  if (!raw?.trim()) return { invalid: false, mentions: undefined };
  const parts = raw.split(";").map((p) => p.trim()).filter(Boolean);
  const mentions = parts.map((part) => {
    const [label, min] = part.split(":").map((p) => p.trim());
    const n = Number(min?.replace(",", "."));
    return label && Number.isFinite(n) ? { label, min: n } : null;
  });
  if (mentions.some((m) => m == null)) return { invalid: true };
  return { invalid: false, mentions: mentions as { label: string; min: number }[] };
}

/**
 * "Nom de période:coef;…" → { periodId: coef }, résolu sur les périodes
 * réelles de l'année choisie (correspondance exacte, casse ignorée).
 */
async function parseAnnualWeights(
  schoolId: string,
  academicYearId: string,
  raw?: string,
): Promise<
  | { invalid: true }
  | { invalid: false; weights: Record<string, number> | undefined }
> {
  if (!raw?.trim()) return { invalid: false, weights: undefined };
  const periods = await prisma.academicPeriod.findMany({
    where: { schoolId, academicYearId },
    select: { id: true, name: true },
  });
  const byName = new Map(
    periods.map((p) => [p.name.trim().toLowerCase(), p.id] as const),
  );
  const weights: Record<string, number> = {};
  for (const part of raw.split(";").map((p) => p.trim()).filter(Boolean)) {
    const [name, coef] = part.split(":").map((p) => p.trim());
    const n = Number(coef?.replace(",", "."));
    const id = name ? byName.get(name.toLowerCase()) : undefined;
    if (!id || !Number.isFinite(n) || n <= 0) return { invalid: true };
    weights[id] = n;
  }
  return { invalid: false, weights };
}

/** Valide et parse le formulaire ; redirige vers un code d'erreur sinon. */
async function parseForm(tenant: { userId: string; schoolId: string }, formData: FormData) {
  const parsed = gradingPolicySchema.safeParse({
    academicYearId: formData.get("academicYearId"),
    levelId: String(formData.get("levelId") ?? "") || undefined,
    maxScore: formData.get("maxScore"),
    minScore: formData.get("minScore"),
    precision: formData.get("precision"),
    rounding: formData.get("rounding"),
    passMark: formData.get("passMark"),
    missingGradePolicy: formData.get("missingGradePolicy"),
    absentPolicy: formData.get("absentPolicy"),
    exemptPolicy: formData.get("exemptPolicy"),
    tieRule: formData.get("tieRule"),
    perSubjectRank: formData.get("perSubjectRank") === "on" || formData.get("perSubjectRank") === "true",
    mentions: String(formData.get("mentions") ?? ""),
    annualWeights: String(formData.get("annualWeights") ?? ""),
  });
  if (!parsed.success) return redirect(failUrl("INVALID_INPUT"));

  // Cohérences inter-champs (la formule de calcul n'est pas modifiée).
  const d = parsed.data;
  if (d.minScore >= d.maxScore) return redirect(failUrl("MIN_GE_MAX"));
  if (d.passMark < d.minScore || d.passMark > d.maxScore) {
    return redirect(failUrl("SEUIL_RANGE"));
  }

  const m = parseMentions(d.mentions);
  if (m.invalid) return redirect(failUrl("INVALID_MENTIONS"));
  if (m.mentions?.some((x) => x.min < d.minScore || x.min > d.maxScore)) {
    return redirect(failUrl("MENTION_RANGE"));
  }

  const w = await parseAnnualWeights(
    tenant.schoolId,
    d.academicYearId,
    d.annualWeights,
  );
  if (w.invalid) return redirect(failUrl("INVALID_WEIGHTS"));

  return {
    ...d,
    levelId: d.levelId ?? null,
    mentions: m.mentions,
    annualWeights: w.weights,
  } as PolicyInput;
}

export async function upsertPolicyAction(formData: FormData) {
  const tenant = await requireSchoolPermission("gradingpolicy.manage");
  const input = await parseForm(tenant, formData);
  if (!input) return; // unreachable — parseForm redirige toujours ou retourne

  const intent = formData.get("intent") === "draft" ? "draft" : "activate";
  const policyId = String(formData.get("policyId") ?? "") || undefined;

  // Édition d'une politique existante + « Activer » :
  // - ligne ACTIVE → mise à jour en place (versionnement existant)
  // - ligne DRAFT/ARCHIVED → on persiste d'abord les modifications sur la
  //   ligne, puis activation (avec confirmation si une active existe).
  if (intent === "activate" && policyId) {
    const row = await prisma.gradingPolicy.findFirst({
      where: { id: policyId, schoolId: tenant.schoolId },
      select: { id: true, status: true, academicYearId: true, levelId: true },
    });
    if (!row) return redirect(failUrl("NOT_FOUND"));
    if (row.status === "ACTIVE") {
      // La portée d'une politique active ne se déplace pas via l'édition :
      // l'upsert ciblerait l'active d'un autre périmètre et l'écraserait.
      if (
        input.academicYearId !== row.academicYearId ||
        (input.levelId ?? null) !== row.levelId
      ) {
        return redirect(failUrl("SCOPE_LOCKED"));
      }
      const res = await upsertPolicy(ctx(tenant), input, "ACTIVE");
      if (!res.ok) return redirect(failUrl(res.error));
      return redirect(
        (res.result.unchanged
          ? "/app/grading-policy?ok=unchanged"
          : "/app/grading-policy?ok=saved") as never,
      );
    }
    // Persiste les modifications sur le brouillon/l'archivée puis tente
    // l'activation ; CONFLICT → page de confirmation explicite.
    const saved = await updatePolicyRow(ctx(tenant), row.id, input);
    if (!saved.ok) return redirect(failUrl(saved.error));
    const res = await activatePolicy(ctx(tenant), row.id);
    if (!res.ok && res.error === "CONFLICT") {
      return redirect(
        `/app/grading-policy?confirm=activate&id=${row.id}` as never,
      );
    }
    if (!res.ok) return redirect(failUrl(res.error));
    return redirect("/app/grading-policy?ok=activated" as never);
  }

  const res = await upsertPolicy(
    ctx(tenant),
    input,
    intent === "draft" ? "DRAFT" : "ACTIVE",
  );
  if (!res.ok) return redirect(failUrl(res.error));
  redirect(
    (intent === "draft"
      ? "/app/grading-policy?ok=draft"
      : res.result.unchanged
        ? "/app/grading-policy?ok=unchanged"
        : "/app/grading-policy?ok=saved") as never,
  );
}

/**
 * « Activer » / « Réactiver » depuis la liste ou depuis la confirmation.
 * Pas de confirmation exigée quand aucune politique active n'occupe le
 * périmètre ; sinon → ?confirm=activate&id=…
 */
export async function activatePolicyAction(formData: FormData) {
  const tenant = await requireSchoolPermission("gradingpolicy.manage");
  const id = String(formData.get("policyId") ?? "");
  if (!id) return redirect(failUrl("NOT_FOUND"));

  const confirmed = formData.get("confirmed") === "1";
  const res = await activatePolicy(ctx(tenant), id, { confirmed });
  if (!res.ok && res.error === "CONFLICT") {
    return redirect(`/app/grading-policy?confirm=activate&id=${id}` as never);
  }
  if (!res.ok) return redirect(failUrl(res.error));
  redirect("/app/grading-policy?ok=activated" as never);
}

/** La page de confirmation est affichée avant l'appel (preview serveur). */
export async function archivePolicyAction(formData: FormData) {
  const tenant = await requireSchoolPermission("gradingpolicy.manage");
  const id = String(formData.get("policyId") ?? "");
  if (!id) return redirect(failUrl("NOT_FOUND"));

  // Guard applicatif : l'unicité ACTIVE est aussi garantie par l'index partiel.
  const res = await archivePolicy(ctx(tenant), id);
  if (!res.ok) return redirect(failUrl(res.error));
  redirect("/app/grading-policy?ok=archived" as never);
}
