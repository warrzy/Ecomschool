import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { DEFAULT_RULES, type GradingRules } from "./calculation";

export type GradingPolicyError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "UPDATE_FAILED"
  | "INVALID_STATE"
  | "CONFLICT";

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

/**
 * Crée ou met à jour la politique du statut demandé pour le couple
 * (année, niveau). Une écriture "DRAFT" cible toujours le brouillon du
 * périmètre ; une écriture "ACTIVE" cible la politique active — les deux
 * peuvent coexister sans se remplacer.
 */
export async function upsertPolicy(
  ctx: SchoolCtx,
  input: PolicyInput,
  status: "ACTIVE" | "DRAFT" = "ACTIVE",
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
        status,
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
            status,
            ...data,
          },
        });
    await logAudit({ actorId: ctx.userId, schoolId: ctx.schoolId,
      action: existing
        ? `gradingPolicy.update:${status.toLowerCase()}`
        : `gradingPolicy.create:${status.toLowerCase()}`,
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

// ---------- Cycle de vie : brouillon / active / archivée ----------

const POLICY_WITH_NAMES = {
  academicYear: { select: { name: true } },
  level: { select: { name: true } },
} as const;

export type PolicyWithNames = NonNullable<
  Awaited<ReturnType<typeof getPolicy>>
>;

export async function getPolicy(ctx: SchoolCtx, id: string) {
  return prisma.gradingPolicy.findFirst({
    where: { id, schoolId: ctx.schoolId },
    include: POLICY_WITH_NAMES,
  });
}

/** Politique ACTIVE actuellement applicable pour le périmètre, s'il y en a une. */
export async function activeInScope(
  ctx: SchoolCtx,
  academicYearId: string,
  levelId: string | null,
) {
  return prisma.gradingPolicy.findFirst({
    where: {
      schoolId: ctx.schoolId,
      academicYearId,
      levelId: levelId ?? null,
      status: "ACTIVE",
    },
    include: POLICY_WITH_NAMES,
  });
}

/**
 * Met à jour les champs d'une ligne existante sans toucher son statut ni sa
 * version — utilisé pour persister les modifications d'un brouillon avant
 * une demande d'activation (confirmation éventuelle ensuite).
 */
export async function updatePolicyRow(
  ctx: SchoolCtx,
  policyId: string,
  input: PolicyInput,
): Promise<GradingPolicyResult<{ id: string }>> {
  const row = await prisma.gradingPolicy.findFirst({
    where: { id: policyId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!row) return { ok: false, error: "NOT_FOUND" };
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
  try {
    await prisma.gradingPolicy.update({
      where: { id: row.id },
      data: {
        academicYearId: input.academicYearId,
        levelId: input.levelId ?? null,
        maxScore: input.maxScore ?? 20,
        minScore: input.minScore ?? 0,
        precision: input.precision ?? 2,
        rounding: input.rounding ?? "HALF_UP",
        passMark: input.passMark ?? 10,
        missingGradePolicy: input.missingGradePolicy ?? "EXCLUDE",
        absentPolicy: input.absentPolicy ?? "EXCLUDE",
        exemptPolicy: input.exemptPolicy ?? "EXCLUDE",
        tieRule: input.tieRule ?? "SHARED_RANK",
        perSubjectRank: input.perSubjectRank ?? true,
        mentions: input.mentions ?? undefined,
        annualWeights: input.annualWeights ?? undefined,
      },
    });
    return { ok: true, result: { id: row.id } };
  } catch {
    // Conflit d'unicité DRAFT (un autre brouillon occupe la nouvelle portée).
    return { ok: false, error: "ALREADY_EXISTS" };
  }
}

export function describePolicy(p: {
  academicYear: { name: string };
  level: { name: string } | null;
  maxScore: number;
  passMark: number;
  version: number;
}) {
  return `« ${p.academicYear.name} / ${p.level?.name ?? "tous niveaux"} » (barème /${p.maxScore}, seuil ${p.passMark}, v${p.version})`;
}

/**
 * Si `policy` (active ou brouillon) est activée : quelle politique ACTIVE du
 * même périmètre serait remplacée (archivée). null → activation directe.
 */
export async function activationPreview(
  ctx: SchoolCtx,
  policyId: string,
): Promise<
  | { error: GradingPolicyError }
  | { target: PolicyWithNames; replaced: PolicyWithNames | null }
> {
  const target = await getPolicy(ctx, policyId);
  if (!target) return { error: "NOT_FOUND" };
  if (target.status === "ACTIVE") return { error: "INVALID_STATE" };
  const current = await activeInScope(
    ctx,
    target.academicYearId,
    target.levelId,
  );
  return { target, replaced: current };
}

/**
 * Activation d'un brouillon ou réactivation d'une archivée — mêmes règles :
 * si une politique ACTIVE existe déjà sur le périmètre, `confirmed` est
 * requis et la transition est transactionnelle (archivage + activation).
 */
export async function activatePolicy(
  ctx: SchoolCtx,
  policyId: string,
  opts: { confirmed?: boolean; data?: PolicyInput } = {},
): Promise<
  GradingPolicyResult<{ id: string }> & { replacedName?: string }
> {
  const preview = await activationPreview(ctx, policyId);
  if ("error" in preview) return { ok: false, error: preview.error };
  const { target } = preview;
  // Portée effective : celle saisie si l'édition l'a modifiée, sinon l'actuelle.
  const scopeYear = opts.data?.academicYearId ?? target.academicYearId;
  const scopeLevel =
    opts.data?.levelId !== undefined
      ? (opts.data.levelId ?? null)
      : target.levelId;
  const replaced = await activeInScope(ctx, scopeYear, scopeLevel);
  if (replaced && !opts.confirmed) {
    return {
      ok: false,
      error: "CONFLICT",
      replacedName: describePolicy(replaced),
    };
  }
  try {
    const data = opts.data
      ? {
          academicYearId: scopeYear,
          levelId: scopeLevel,
          maxScore: opts.data.maxScore ?? target.maxScore,
          minScore: opts.data.minScore ?? target.minScore,
          precision: opts.data.precision ?? target.precision,
          rounding: opts.data.rounding ?? target.rounding,
          passMark: opts.data.passMark ?? target.passMark,
          missingGradePolicy:
            opts.data.missingGradePolicy ?? target.missingGradePolicy,
          absentPolicy: opts.data.absentPolicy ?? target.absentPolicy,
          exemptPolicy: opts.data.exemptPolicy ?? target.exemptPolicy,
          tieRule: opts.data.tieRule ?? target.tieRule,
          perSubjectRank: opts.data.perSubjectRank ?? target.perSubjectRank,
          mentions: opts.data.mentions ?? undefined,
          annualWeights: opts.data.annualWeights ?? undefined,
        }
      : {};
    await prisma.$transaction([
      ...(replaced
        ? [
            prisma.gradingPolicy.update({
              where: { id: replaced.id },
              data: { status: "ARCHIVED" },
            }),
          ]
        : []),
      prisma.gradingPolicy.update({
        where: { id: target.id },
        data: {
          ...data,
          status: "ACTIVE",
          version: { increment: 1 },
        },
      }),
    ]);
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "gradingPolicy.activate",
      entity: "GradingPolicy",
      entityId: target.id,
      metadata: replaced ? { replacedPolicyId: replaced.id } : undefined,
    });
    return { ok: true, result: { id: target.id } };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}

export interface ArchivePreview {
  target: PolicyWithNames;
  /** Description de la règle qui s'appliquera après archivage. */
  fallback: string;
  /** Vrai si le relais modifie le barème (ou repasse aux règles intégrées). */
  changesScale: boolean;
  /** Bulletins/résultats de l'année non encore publiés. */
  unpublishedCount: number;
}

/**
 * Conséquences d'un archivage : quelle règle prendra le relais et combien de
 * bulletins de l'année ne sont pas encore publiés (leurs snapshots publiés
 * restent de toute façon intouchés).
 */
export async function archivePreview(
  ctx: SchoolCtx,
  policyId: string,
): Promise<ArchivePreview | { error: "NOT_FOUND" }> {
  const target = await getPolicy(ctx, policyId);
  if (!target) return { error: "NOT_FOUND" };
  let fallback: string;
  let changesScale = false;
  if (target.status !== "ACTIVE") {
    fallback = "Aucun impact : cette politique n'est pas appliquée.";
  } else if (target.levelId) {
    const def = await prisma.gradingPolicy.findFirst({
      where: {
        schoolId: ctx.schoolId,
        academicYearId: target.academicYearId,
        levelId: null,
        status: "ACTIVE",
      },
      include: POLICY_WITH_NAMES,
    });
    if (def) {
      fallback = `La politique par défaut de l'année s'appliquera : ${describePolicy(def)}.`;
      changesScale =
        def.maxScore !== target.maxScore || def.passMark !== target.passMark;
    } else {
      fallback =
        "Aucune politique de niveau ni de défaut d'année — les règles par défaut intégrées s'appliqueront (barème /20, seuil 10, arrondi demi-supérieur, cas particuliers exclus).";
      changesScale = target.maxScore !== 20 || target.passMark !== 10;
    }
  } else {
    fallback =
      "Aucune autre politique active pour cette année — les règles par défaut intégrées s'appliqueront (barème /20, seuil 10, arrondi demi-supérieur, cas particuliers exclus).";
    changesScale = target.maxScore !== 20 || target.passMark !== 10;
  }
  const unpublishedCount = await prisma.reportCard.count({
    where: {
      schoolId: ctx.schoolId,
      publishedAt: null,
      academicPeriod: { academicYearId: target.academicYearId },
    },
  });
  return { target, fallback, changesScale, unpublishedCount };
}

/** Archivage : la politique reste consultable mais n'est plus jamais appliquée. */
export async function archivePolicy(
  ctx: SchoolCtx,
  policyId: string,
): Promise<GradingPolicyResult<{ id: string }>> {
  const target = await getPolicy(ctx, policyId);
  if (!target) return { ok: false, error: "NOT_FOUND" };
  if (target.status === "ARCHIVED") return { ok: false, error: "INVALID_STATE" };
  try {
    await prisma.gradingPolicy.update({
      where: { id: target.id },
      data: { status: "ARCHIVED" },
    });
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "gradingPolicy.archive",
      entity: "GradingPolicy",
      entityId: target.id,
    });
    return { ok: true, result: { id: target.id } };
  } catch {
    return { ok: false, error: "UPDATE_FAILED" };
  }
}
