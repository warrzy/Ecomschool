import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { DEFAULT_RULES, type GradingRules } from "./calculation";

export type GradingPolicyError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "UPDATE_FAILED";

export type GradingPolicyResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: GradingPolicyError };

type SchoolCtx = { userId: string; schoolId: string };

export interface PolicyInput {
  academicYearId: string;
  levelId?: string | null;
  maxScore?: number;
  minScore?: number;
  precision?: number;
  rounding?: "HALF_UP" | "FLOOR" | "CEIL";
  passMark?: number;
  missingGradePolicy?: "EXCLUDE" | "ZERO";
  absentPolicy?: "EXCLUDE" | "ZERO";
  exemptPolicy?: "EXCLUDE" | "ZERO";
  tieRule?: "SHARED_RANK" | "DENSE_RANK";
  perSubjectRank?: boolean;
  mentions?: { label: string; min: number }[];
  annualWeights?: Record<string, number>;
}

export async function listPolicies(ctx: SchoolCtx) {
  return prisma.gradingPolicy.findMany({
    where: { schoolId: ctx.schoolId },
    include: {
      academicYear: { select: { name: true } },
      level: { select: { name: true } },
    },
    orderBy: [{ academicYearId: "desc" }, { levelId: "asc" }],
  });
}

export async function upsertPolicy(
  ctx: SchoolCtx,
  input: PolicyInput,
): Promise<GradingPolicyResult<{ id: string; unchanged?: boolean }>> {
  const year = await prisma.academicYear.findFirst({
    where: { id: input.academicYearId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!year) return { ok: false, error: "NOT_FOUND" };

  if (input.levelId) {
    const level = await prisma.level.findFirst({
      where: { id: input.levelId, schoolId: ctx.schoolId },
      select: { id: true },
    });
    if (!level) return { ok: false, error: "NOT_FOUND" };
  }

  const data = {
    maxScore: input.maxScore ?? 20,
    minScore: input.minScore ?? 0,
    precision: input.precision ?? 2,
    rounding: input.rounding ?? ("HALF_UP" as const),
    passMark: input.passMark ?? 10,
    missingGradePolicy: input.missingGradePolicy ?? ("EXCLUDE" as const),
    absentPolicy: input.absentPolicy ?? ("EXCLUDE" as const),
    exemptPolicy: input.exemptPolicy ?? ("EXCLUDE" as const),
    tieRule: input.tieRule ?? ("SHARED_RANK" as const),
    perSubjectRank: input.perSubjectRank ?? true,
    mentions: input.mentions ?? undefined,
    annualWeights: input.annualWeights ?? undefined,
  };

  try {
    // Historisation : une mise à jour incrémente la version plutôt que
    // d'écraser silencieusement (les bulletins publiés gardent leur snapshot).
    const existing = await prisma.gradingPolicy.findFirst({
      where: {
        academicYearId: input.academicYearId,
        levelId: input.levelId ?? null,
        schoolId: ctx.schoolId,
      },
    });
    // Enregistrer sans aucun changement effectif ne crée pas de nouvelle
    // version (évite des incréments vides). Comparaison champ à champ, JSON
    // inclus (pondérations comparées clés triées, ordre insensible).
    const canon = (o: unknown) =>
      o == null || typeof o !== "object"
        ? (o ?? null)
        : Object.fromEntries(
            Object.entries(o as Record<string, unknown>).sort(([a], [b]) =>
              a.localeCompare(b),
            ),
          );
    // mentions/annualWeights non saisis = conservation de la valeur existante ;
    // la comparaison porte donc sur les valeurs effectivement résultantes.
    const unchanged =
      existing != null &&
      existing.maxScore === data.maxScore &&
      existing.minScore === data.minScore &&
      existing.precision === data.precision &&
      existing.rounding === data.rounding &&
      existing.passMark === data.passMark &&
      existing.missingGradePolicy === data.missingGradePolicy &&
      existing.absentPolicy === data.absentPolicy &&
      existing.exemptPolicy === data.exemptPolicy &&
      existing.tieRule === data.tieRule &&
      existing.perSubjectRank === data.perSubjectRank &&
      JSON.stringify(existing.mentions ?? null) ===
        JSON.stringify(data.mentions ?? existing.mentions ?? null) &&
      JSON.stringify(canon(existing.annualWeights)) ===
        JSON.stringify(canon(data.annualWeights ?? existing.annualWeights));
    if (unchanged) return { ok: true, result: { id: existing.id, unchanged: true } };
    const policy = existing
      ? await prisma.gradingPolicy.update({
          where: { id: existing.id },
          data: { ...data, version: { increment: 1 } },
        })
      : await prisma.gradingPolicy.create({
          data: {
            schoolId: ctx.schoolId,
            academicYearId: input.academicYearId,
            levelId: input.levelId ?? null,
            ...data,
          },
        });
    await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId,
      action: existing ? "gradingPolicy.update" : "gradingPolicy.create",
      entity: "GradingPolicy",
      entityId: policy.id,
    });
    return { ok: true, result: { id: policy.id } };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

/**
 * Résout les règles applicables : politique du niveau si définie,
 * sinon politique par défaut de l'année, sinon DEFAULT_RULES.
 */
export async function resolveRules(
  ctx: SchoolCtx,
  academicYearId: string,
  levelId?: string | null,
): Promise<GradingRules> {
  const policy = await prisma.gradingPolicy.findFirst({
    where: {
      schoolId: ctx.schoolId,
      academicYearId,
      OR: [{ levelId: levelId ?? "__none__" }, { levelId: null }],
      status: "ACTIVE",
    },
    orderBy: { levelId: "desc" }, // la politique de niveau prime sur le défaut année
  });
  if (!policy) return DEFAULT_RULES;
  const mentions = Array.isArray(policy.mentions)
    ? (policy.mentions as { label: string; min: number }[])
    : DEFAULT_RULES.mentions;
  return {
    maxScore: policy.maxScore,
    minScore: policy.minScore,
    precision: policy.precision,
    rounding: policy.rounding,
    passMark: policy.passMark,
    missingGradePolicy: policy.missingGradePolicy,
    absentPolicy: policy.absentPolicy,
    exemptPolicy: policy.exemptPolicy,
    tieRule: policy.tieRule,
    perSubjectRank: policy.perSubjectRank,
    mentions,
  };
}

/** Coefficients de pondération annuelle par période (défaut : 1 partout). */
export async function annualWeightsFor(
  ctx: SchoolCtx,
  academicYearId: string,
): Promise<Record<string, number>> {
  const policy = await prisma.gradingPolicy.findFirst({
    where: { schoolId: ctx.schoolId, academicYearId, status: "ACTIVE" },
    orderBy: { levelId: "desc" },
  });
  if (policy?.annualWeights && typeof policy.annualWeights === "object") {
    return policy.annualWeights as Record<string, number>;
  }
  return {};
}
