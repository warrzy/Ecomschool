"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { upsertPolicy } from "@/lib/services/grading/policy";
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

export async function upsertPolicyAction(formData: FormData) {
  const tenant = await requireSchoolPermission("gradingpolicy.manage");
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

  const m = parseMentions(parsed.data.mentions);
  if (m.invalid) return redirect(failUrl("INVALID_MENTIONS"));
  const w = await parseAnnualWeights(
    tenant.schoolId,
    parsed.data.academicYearId,
    parsed.data.annualWeights,
  );
  if (w.invalid) return redirect(failUrl("INVALID_WEIGHTS"));

  const res = await upsertPolicy(ctx(tenant), {
    ...parsed.data,
    levelId: parsed.data.levelId ?? null,
    mentions: m.mentions,
    annualWeights: w.weights,
  });
  redirect(
    (res.ok ? "/app/grading-policy?ok=saved" : `/app/grading-policy?error=${res.error}`) as never,
  );
}
