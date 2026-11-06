/**
 * H5 — Délibérations scolaires.
 *
 * Principes :
 * - Les règles de décision sont configurées par l'établissement
 *   (`DeliberationRule`, évaluées par `order` croissant sur une bande
 *   [min, max[ de moyenne) — aucun seuil universel n'est imposé.
 * - Distinction nette : `proposed*` = calcul automatique à partir des
 *   règles ; `final*` = décision du conseil. Tout écart exige un motif.
 * - Les moyennes/notes d'origine ne sont jamais modifiées : la
 *   préparation lit les résultats persistés et fige un snapshot.
 * - Transitions de session par updateMany conditionnel — impossible de
 *   valider deux fois ou de publier une session non validée.
 * - La publication synchronise les libellés vers les surfaces
 *   existantes : `StudentPeriodResult.councilDecision` (bulletins) ou
 *   `StudentAnnualResult.decision` (moyennes annuelles + réinscription
 *   G2). La dépublication ne retire que les libellés encore identiques.
 * - Tout est audité (préparation, ajustements, validation, verrous,
 *   publication/dépublication).
 */
import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import type {
  DeliberationScope,
  DeliberationStatus,
  ReenrollmentProgression,
  Prisma,
} from "@prisma/client";

export type DeliberationError =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "INVALID_STATUS"
  | "YEAR_CLOSED"
  | "NO_RESULTS"
  | "MISSING_DECISIONS"
  | "REASON_REQUIRED"
  | "ALREADY_EXISTS"
  | "UPDATE_FAILED";

export type DeliberationResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: DeliberationError };

type SchoolCtx = { userId: string; schoolId: string };
type Tx = Prisma.TransactionClient;

export const SCOPE_LABELS: Record<DeliberationScope, string> = {
  PERIOD: "Conseil de période",
  ANNUAL: "Délibération annuelle",
};

export const SESSION_STATUS_LABELS: Record<DeliberationStatus, string> = {
  OPEN: "En préparation",
  VALIDATED: "Validée",
  PUBLISHED: "Publiée",
};

export const SESSION_STATUS_TONES: Record<DeliberationStatus, string> = {
  OPEN: "bg-amber-50 text-amber-800",
  VALIDATED: "bg-blue-50 text-blue-800",
  PUBLISHED: "bg-emerald-50 text-emerald-800",
};

export const PROGRESSION_LABELS: Record<ReenrollmentProgression, string> = {
  PROMOTION: "Passage en classe supérieure",
  REPETITION: "Redoublement",
  SAME_LEVEL: "Maintien dans le niveau",
  CLASS_CHANGE: "Changement de classe",
  CYCLE_CHANGE: "Changement de cycle",
  RETURN: "Réintégration",
};

async function hasPerm(ctx: SchoolCtx, key: string) {
  return userHasSchoolPermission({
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    permissionKey: key,
  });
}

// ---------- Règles de décision ----------

export async function listRules(
  ctx: SchoolCtx,
  opts: { scope?: DeliberationScope } = {},
) {
  return prisma.deliberationRule.findMany({
    where: {
      schoolId: ctx.schoolId,
      ...(opts.scope ? { scope: opts.scope } : {}),
    },
    include: {
      academicYear: { select: { name: true } },
      level: { select: { name: true } },
    },
    orderBy: [{ scope: "asc" }, { order: "asc" }, { createdAt: "asc" }],
  });
}

export async function upsertRule(
  ctx: SchoolCtx,
  input: {
    id?: string;
    scope: DeliberationScope;
    label: string;
    progression?: ReenrollmentProgression | null;
    minAverage?: number | null;
    maxAverage?: number | null;
    requiresComplete?: boolean;
    order?: number;
    academicYearId?: string | null;
    levelId?: string | null;
  },
): Promise<DeliberationResult<{ id: string }>> {
  if (!(await hasPerm(ctx, "deliberations.manage"))) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const label = input.label.trim();
  if (!label || label.length > 100) return { ok: false, error: "INVALID_INPUT" };
  const min = input.minAverage ?? null;
  const max = input.maxAverage ?? null;
  if (min != null && (min < 0 || min > 100)) return { ok: false, error: "INVALID_INPUT" };
  if (max != null && (max < 0 || max > 100)) return { ok: false, error: "INVALID_INPUT" };
  if (min != null && max != null && min >= max) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  if (input.academicYearId) {
    const y = await prisma.academicYear.findFirst({
      where: { id: input.academicYearId, schoolId: ctx.schoolId },
      select: { id: true },
    });
    if (!y) return { ok: false, error: "NOT_FOUND" };
  }
  if (input.levelId) {
    const l = await prisma.level.findFirst({
      where: { id: input.levelId, schoolId: ctx.schoolId },
      select: { id: true },
    });
    if (!l) return { ok: false, error: "NOT_FOUND" };
  }

  const data = {
    scope: input.scope,
    label,
    progression: input.progression ?? null,
    minAverage: min,
    maxAverage: max,
    requiresComplete: input.requiresComplete ?? false,
    order: input.order ?? 0,
    academicYearId: input.academicYearId ?? null,
    levelId: input.levelId ?? null,
  };

  const rule = input.id
    ? await prisma.deliberationRule.updateMany({
        where: { id: input.id, schoolId: ctx.schoolId },
        data,
      }).then(async (u) =>
        u.count
          ? prisma.deliberationRule.findUniqueOrThrow({ where: { id: input.id } })
          : null,
      )
    : await prisma.deliberationRule.create({
        data: { schoolId: ctx.schoolId, ...data },
      });
  if (!rule) return { ok: false, error: "NOT_FOUND" };

  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: input.id ? "deliberation.rule.update" : "deliberation.rule.create",
    entity: "DeliberationRule",
    entityId: rule.id,
    metadata: { scope: input.scope, label, min, max },
  });
  return { ok: true, result: { id: rule.id } };
}

/** Archivage — les décisions passées gardent leur libellé snapshot. */
export async function archiveRule(
  ctx: SchoolCtx,
  id: string,
): Promise<DeliberationResult> {
  if (!(await hasPerm(ctx, "deliberations.manage"))) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const u = await prisma.deliberationRule.updateMany({
    where: { id, schoolId: ctx.schoolId, status: "ACTIVE" },
    data: { status: "ARCHIVED" },
  });
  if (!u.count) return { ok: false, error: "NOT_FOUND" };
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "deliberation.rule.archive",
    entity: "DeliberationRule",
    entityId: id,
  });
  return { ok: true, result: undefined };
}

// ---------- Préparation ----------

type RuleRow = {
  id: string;
  label: string;
  minAverage: number | null;
  maxAverage: number | null;
  requiresComplete: boolean;
};

/** Règles applicables : celles de l'année si définies, sinon les règles générales. */
async function rulesFor(
  ctx: SchoolCtx,
  scope: DeliberationScope,
  academicYearId: string,
): Promise<RuleRow[]> {
  const specific = await prisma.deliberationRule.findMany({
    where: { schoolId: ctx.schoolId, scope, status: "ACTIVE", academicYearId },
    select: { id: true, label: true, minAverage: true, maxAverage: true, requiresComplete: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  if (specific.length) return specific;
  return prisma.deliberationRule.findMany({
    where: { schoolId: ctx.schoolId, scope, status: "ACTIVE", academicYearId: null },
    select: { id: true, label: true, minAverage: true, maxAverage: true, requiresComplete: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
}

function propose(
  average: number | null,
  complete: boolean,
  rules: RuleRow[],
): { ruleId: string | null; label: string | null } {
  if (average == null) return { ruleId: null, label: null };
  const hit = rules.find(
    (r) =>
      (r.minAverage == null || average >= r.minAverage) &&
      (r.maxAverage == null || average < r.maxAverage) &&
      (!r.requiresComplete || complete),
  );
  return hit ? { ruleId: hit.id, label: hit.label } : { ruleId: null, label: null };
}

async function nextPvNumber(tx: Tx, schoolId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"delib:" + schoolId}))`;
  const yearTag = String(new Date().getUTCFullYear());
  const seq = await tx.deliberationSession.count({
    where: { schoolId, number: { startsWith: `PV-${yearTag}-` } },
  });
  return `PV-${yearTag}-${String(seq + 1).padStart(5, "0")}`;
}

type SourceRow = {
  studentId: string;
  average: number | null;
  rank: number | null;
  mention: string | null;
  complete: boolean;
};

/**
 * Crée une session de délibération et calcule les propositions à
 * partir des résultats persistés (aucune modification des résultats).
 * PERIOD : exige des StudentPeriodResult calculés pour classe+période.
 * ANNUAL : exige des StudentAnnualResult calculés pour l'année.
 */
export async function prepareSession(
  ctx: SchoolCtx,
  input: {
    scope: DeliberationScope;
    classroomId: string;
    academicPeriodId?: string;
    note?: string;
  },
): Promise<DeliberationResult<{ id: string; number: string; students: number }>> {
  if (!(await hasPerm(ctx, "deliberations.manage"))) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const classroom = await prisma.classroom.findFirst({
    where: { id: input.classroomId, schoolId: ctx.schoolId },
    select: { id: true, academicYearId: true, levelId: true },
  });
  if (!classroom) return { ok: false, error: "NOT_FOUND" };

  const year = await prisma.academicYear.findFirst({
    where: { id: classroom.academicYearId, schoolId: ctx.schoolId },
    select: { status: true },
  });
  if (year?.status === "CLOSED") return { ok: false, error: "YEAR_CLOSED" };

  let periodId: string | null = null;
  if (input.scope === "PERIOD") {
    if (!input.academicPeriodId) return { ok: false, error: "INVALID_INPUT" };
    const period = await prisma.academicPeriod.findFirst({
      where: {
        id: input.academicPeriodId,
        schoolId: ctx.schoolId,
        academicYearId: classroom.academicYearId,
      },
      select: { id: true },
    });
    if (!period) return { ok: false, error: "NOT_FOUND" };
    periodId = period.id;
  } else if (input.academicPeriodId) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const rules = await rulesFor(ctx, input.scope, classroom.academicYearId);

  // Élèves de la classe (même périmètre que le calcul des résultats).
  const enrollments = await prisma.enrollment.findMany({
    where: { schoolId: ctx.schoolId, classroomId: classroom.id, status: "ENROLLED" },
    select: { studentId: true },
  });
  if (!enrollments.length) return { ok: false, error: "NO_RESULTS" };

  const studentIds = enrollments.map((e) => e.studentId);
  let rows: SourceRow[];
  if (input.scope === "PERIOD") {
    const results = await prisma.studentPeriodResult.findMany({
      where: {
        schoolId: ctx.schoolId,
        classroomId: classroom.id,
        academicPeriodId: periodId!,
        studentId: { in: studentIds },
        status: { in: ["CALCULATED", "VALIDATED", "PUBLISHED", "RECTIFIED"] },
      },
      select: {
        studentId: true,
        generalAverage: true,
        rank: true,
        mention: true,
        isComplete: true,
      },
    });
    if (!results.length) return { ok: false, error: "NO_RESULTS" };
    const byId = new Map(results.map((r) => [r.studentId, r]));
    rows = studentIds.map((sid) => {
      const r = byId.get(sid);
      return {
        studentId: sid,
        average: r?.generalAverage ?? null,
        rank: r?.rank ?? null,
        mention: r?.mention ?? null,
        complete: r?.isComplete ?? false,
      };
    });
  } else {
    const results = await prisma.studentAnnualResult.findMany({
      where: {
        schoolId: ctx.schoolId,
        academicYearId: classroom.academicYearId,
        studentId: { in: studentIds },
        status: { in: ["CALCULATED", "VALIDATED", "PUBLISHED", "RECTIFIED"] },
      },
      select: { studentId: true, annualAverage: true, rank: true, mention: true },
    });
    if (!results.length) return { ok: false, error: "NO_RESULTS" };
    const byId = new Map(results.map((r) => [r.studentId, r]));
    rows = studentIds.map((sid) => {
      const r = byId.get(sid);
      return {
        studentId: sid,
        average: r?.annualAverage ?? null,
        rank: r?.rank ?? null,
        mention: r?.mention ?? null,
        complete: r != null,
      };
    });
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const number = await nextPvNumber(tx, ctx.schoolId);
      const session = await tx.deliberationSession.create({
        data: {
          schoolId: ctx.schoolId,
          academicYearId: classroom.academicYearId,
          scope: input.scope,
          academicPeriodId: periodId,
          classroomId: classroom.id,
          number,
          note: input.note?.trim() || null,
          preparedById: ctx.userId,
          preparedAt: new Date(),
        },
        select: { id: true, number: true },
      });
      await tx.deliberationDecision.createMany({
        data: rows.map((r) => {
          const p = propose(r.average, r.complete, rules);
          return {
            schoolId: ctx.schoolId,
            sessionId: session.id,
            studentId: r.studentId,
            averageSnapshot: r.average,
            rankSnapshot: r.rank,
            mentionSnapshot: r.mention,
            completeSnapshot: r.complete,
            proposedRuleId: p.ruleId,
            proposedLabel: p.label,
            finalRuleId: p.ruleId,
            finalLabel: p.label,
          };
        }),
      });
      return session;
    });
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "deliberation.prepare",
      entity: "DeliberationSession",
      entityId: created.id,
      metadata: {
        scope: input.scope,
        number: created.number,
        classroomId: classroom.id,
        students: rows.length,
      },
    });
    return { ok: true, result: { ...created, students: rows.length } };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      return { ok: false, error: "ALREADY_EXISTS" };
    }
    throw e;
  }
}

/**
 * Recalcule les propositions d'une session OPEN : snapshots et
 * propositions rafraîchis pour les décisions non ajustées ; les
 * ajustements motivés sont préservés.
 */
export async function reprepareSession(
  ctx: SchoolCtx,
  sessionId: string,
): Promise<DeliberationResult<{ refreshed: number }>> {
  if (!(await hasPerm(ctx, "deliberations.manage"))) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const session = await prisma.deliberationSession.findFirst({
    where: { id: sessionId, schoolId: ctx.schoolId },
    select: {
      id: true, scope: true, classroomId: true,
      academicPeriodId: true, academicYearId: true, status: true,
    },
  });
  if (!session) return { ok: false, error: "NOT_FOUND" };
  if (session.status !== "OPEN") return { ok: false, error: "INVALID_STATUS" };

  const rules = await rulesFor(ctx, session.scope, session.academicYearId);
  const enrollments = await prisma.enrollment.findMany({
    where: { schoolId: ctx.schoolId, classroomId: session.classroomId, status: "ENROLLED" },
    select: { studentId: true },
  });
  const studentIds = enrollments.map((e) => e.studentId);

  const current = new Map<string, SourceRow>();
  if (session.scope === "PERIOD") {
    const results = await prisma.studentPeriodResult.findMany({
      where: {
        schoolId: ctx.schoolId,
        academicPeriodId: session.academicPeriodId!,
        studentId: { in: studentIds },
      },
      select: { studentId: true, generalAverage: true, rank: true, mention: true, isComplete: true },
    });
    for (const r of results) {
      current.set(r.studentId, {
        studentId: r.studentId, average: r.generalAverage,
        rank: r.rank, mention: r.mention, complete: r.isComplete,
      });
    }
  } else {
    const results = await prisma.studentAnnualResult.findMany({
      where: {
        schoolId: ctx.schoolId,
        academicYearId: session.academicYearId,
        studentId: { in: studentIds },
      },
      select: { studentId: true, annualAverage: true, rank: true, mention: true },
    });
    for (const r of results) {
      current.set(r.studentId, {
        studentId: r.studentId, average: r.annualAverage,
        rank: r.rank, mention: r.mention, complete: true,
      });
    }
  }

  const existing = await prisma.deliberationDecision.findMany({
    where: { sessionId: session.id },
    select: { studentId: true, adjustmentReason: true },
  });
  const existingIds = new Set(existing.map((d) => d.studentId));

  let refreshed = 0;
  await prisma.$transaction(async (tx) => {
    for (const d of existing) {
      const src = current.get(d.studentId);
      const row: SourceRow = src ?? {
        studentId: d.studentId, average: null, rank: null, mention: null, complete: false,
      };
      const p = propose(row.average, row.complete, rules);
      await tx.deliberationDecision.updateMany({
        where: { sessionId: session.id, studentId: d.studentId },
        data: {
          averageSnapshot: row.average,
          rankSnapshot: row.rank,
          mentionSnapshot: row.mention,
          completeSnapshot: row.complete,
          proposedRuleId: p.ruleId,
          proposedLabel: p.label,
          // Non ajustée → la décision suit la nouvelle proposition.
          ...(d.adjustmentReason == null
            ? { finalRuleId: p.ruleId, finalLabel: p.label }
            : {}),
        },
      });
      refreshed++;
    }
    // Nouveaux inscrits depuis la préparation initiale.
    const missing = studentIds.filter((sid) => !existingIds.has(sid));
    if (missing.length) {
      await tx.deliberationDecision.createMany({
        data: missing.map((sid) => {
          const row = current.get(sid) ?? {
            studentId: sid, average: null, rank: null, mention: null, complete: false,
          };
          const p = propose(row.average, row.complete, rules);
          return {
            schoolId: ctx.schoolId,
            sessionId: session.id,
            studentId: sid,
            averageSnapshot: row.average,
            rankSnapshot: row.rank,
            mentionSnapshot: row.mention,
            completeSnapshot: row.complete,
            proposedRuleId: p.ruleId,
            proposedLabel: p.label,
            finalRuleId: p.ruleId,
            finalLabel: p.label,
          };
        }),
      });
      refreshed += missing.length;
    }
  });

  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "deliberation.reprepare",
    entity: "DeliberationSession",
    entityId: session.id,
    metadata: { refreshed },
  });
  return { ok: true, result: { refreshed } };
}

// ---------- Consultation ----------

export async function listSessions(ctx: SchoolCtx) {
  if (!(await hasPerm(ctx, "deliberations.read"))) return [];
  return prisma.deliberationSession.findMany({
    where: { schoolId: ctx.schoolId },
    include: {
      classroom: { select: { name: true } },
      academicPeriod: { select: { name: true } },
      academicYear: { select: { name: true } },
      _count: { select: { decisions: true } },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 100,
  });
}

export async function getSession(ctx: SchoolCtx, id: string) {
  if (!(await hasPerm(ctx, "deliberations.read"))) return null;
  const session = await prisma.deliberationSession.findFirst({
    where: { id, schoolId: ctx.schoolId },
    include: {
      classroom: { select: { name: true, level: { select: { name: true } } } },
      academicPeriod: { select: { name: true } },
      academicYear: { select: { name: true } },
      decisions: {
        include: {
          student: { select: { matricule: true, firstName: true, lastName: true } },
        },
        orderBy: [{ rankSnapshot: "asc" }, { student: { lastName: "asc" } }],
      },
    },
  });
  if (!session) return null;

  // Dérive éventuelle : résultats recalculés depuis la préparation.
  const staleIds = new Set<string>();
  if (session.scope === "PERIOD" && session.academicPeriodId) {
    const current = await prisma.studentPeriodResult.findMany({
      where: {
        schoolId: ctx.schoolId,
        academicPeriodId: session.academicPeriodId,
        studentId: { in: session.decisions.map((d) => d.studentId) },
      },
      select: { studentId: true, generalAverage: true },
    });
    const byId = new Map(current.map((r) => [r.studentId, r.generalAverage]));
    for (const d of session.decisions) {
      if ((byId.get(d.studentId) ?? null) !== d.averageSnapshot) staleIds.add(d.id);
    }
  } else if (session.scope === "ANNUAL") {
    const current = await prisma.studentAnnualResult.findMany({
      where: {
        schoolId: ctx.schoolId,
        academicYearId: session.academicYearId,
        studentId: { in: session.decisions.map((d) => d.studentId) },
      },
      select: { studentId: true, annualAverage: true },
    });
    const byId = new Map(current.map((r) => [r.studentId, r.annualAverage]));
    for (const d of session.decisions) {
      if ((byId.get(d.studentId) ?? null) !== d.averageSnapshot) staleIds.add(d.id);
    }
  }
  return { ...session, staleDecisionIds: staleIds };
}

// ---------- Ajustement ----------

/**
 * Ajustement motivé : le conseil retient une règle ou un libellé libre.
 * Le motif est obligatoire dès que la décision retenue diffère de la
 * proposition calculée (y compris quand aucune règle ne s'appliquait).
 */
export async function adjustDecision(
  ctx: SchoolCtx,
  input: {
    decisionId: string;
    ruleId?: string;
    customLabel?: string;
    reason?: string;
  },
): Promise<DeliberationResult> {
  if (!(await hasPerm(ctx, "deliberations.manage"))) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const decision = await prisma.deliberationDecision.findFirst({
    where: { id: input.decisionId, schoolId: ctx.schoolId },
    include: { session: { select: { id: true, status: true, scope: true } } },
  });
  if (!decision) return { ok: false, error: "NOT_FOUND" };
  if (decision.session.status !== "OPEN") {
    return { ok: false, error: "INVALID_STATUS" };
  }

  let finalRuleId: string | null = null;
  let finalLabel: string | null = null;
  if (input.ruleId) {
    const rule = await prisma.deliberationRule.findFirst({
      where: {
        id: input.ruleId,
        schoolId: ctx.schoolId,
        status: "ACTIVE",
        scope: decision.session.scope,
      },
      select: { id: true, label: true },
    });
    if (!rule) return { ok: false, error: "NOT_FOUND" };
    finalRuleId = rule.id;
    finalLabel = rule.label;
  } else if (input.customLabel?.trim()) {
    finalLabel = input.customLabel.trim().slice(0, 100);
  } else {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const differs = finalLabel !== decision.proposedLabel;
  const reason = input.reason?.trim() || null;
  if (differs && !reason) return { ok: false, error: "REASON_REQUIRED" };

  const updated = await prisma.deliberationDecision.updateMany({
    where: {
      id: decision.id,
      session: { status: "OPEN" },
    },
    data: {
      finalRuleId,
      finalLabel,
      adjustmentReason: differs ? reason : null,
      status: differs ? "ADJUSTED" : "PROPOSED",
      adjustedById: differs ? ctx.userId : decision.adjustedById,
      adjustedAt: differs ? new Date() : decision.adjustedAt,
    },
  });
  if (!updated.count) return { ok: false, error: "INVALID_STATUS" };

  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "deliberation.decision.adjust",
    entity: "DeliberationDecision",
    entityId: decision.id,
    metadata: {
      sessionId: decision.session.id,
      proposed: decision.proposedLabel,
      final: finalLabel,
      reason: differs ? reason : null,
    },
  });
  return { ok: true, result: undefined };
}

// ---------- Cycle de vie ----------

/** Validation du conseil : toutes les décisions doivent être retenues. */
export async function validateSession(
  ctx: SchoolCtx,
  sessionId: string,
): Promise<DeliberationResult> {
  if (!(await hasPerm(ctx, "deliberations.validate"))) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const session = await prisma.deliberationSession.findFirst({
    where: { id: sessionId, schoolId: ctx.schoolId },
    select: { id: true, status: true, number: true },
  });
  if (!session) return { ok: false, error: "NOT_FOUND" };
  if (session.status !== "OPEN") return { ok: false, error: "INVALID_STATUS" };

  const undecided = await prisma.deliberationDecision.count({
    where: { sessionId: session.id, finalLabel: null },
  });
  if (undecided > 0) return { ok: false, error: "MISSING_DECISIONS" };

  const done = await prisma.$transaction(async (tx) => {
    const u = await tx.deliberationSession.updateMany({
      where: { id: session.id, status: "OPEN" },
      data: { status: "VALIDATED", validatedById: ctx.userId, validatedAt: new Date() },
    });
    if (!u.count) return false;
    await tx.deliberationDecision.updateMany({
      where: { sessionId: session.id },
      data: { status: "VALIDATED", validatedById: ctx.userId, validatedAt: new Date() },
    });
    return true;
  });
  if (!done) return { ok: false, error: "INVALID_STATUS" };

  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "deliberation.validate",
    entity: "DeliberationSession",
    entityId: session.id,
    metadata: { number: session.number },
  });
  return { ok: true, result: undefined };
}

/** Déverrouillage motivé (corrections post-validation). */
export async function unlockSession(
  ctx: SchoolCtx,
  sessionId: string,
  reason: string,
): Promise<DeliberationResult> {
  if (!(await hasPerm(ctx, "deliberations.validate"))) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const r = reason.trim();
  if (!r) return { ok: false, error: "REASON_REQUIRED" };

  const u = await prisma.deliberationSession.updateMany({
    where: { id: sessionId, schoolId: ctx.schoolId, status: "VALIDATED" },
    data: {
      status: "OPEN",
      unlockedById: ctx.userId,
      unlockedAt: new Date(),
      unlockReason: r,
    },
  });
  if (!u.count) return { ok: false, error: "INVALID_STATUS" };
  // Les décisions repassent à leur état d'avant validation.
  await prisma.deliberationDecision.updateMany({
    where: { sessionId },
    data: { status: "PROPOSED" },
  });
  await prisma.deliberationDecision.updateMany({
    where: { sessionId, adjustmentReason: { not: null } },
    data: { status: "ADJUSTED" },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "deliberation.unlock",
    entity: "DeliberationSession",
    entityId: sessionId,
    metadata: { reason: r },
  });
  return { ok: true, result: undefined };
}

/**
 * Publication : diffuse les libellés retenus vers les surfaces
 * existantes (bulletins via councilDecision ; moyennes annuelles et
 * réinscription G2 via StudentAnnualResult.decision). Contrôlée et
 * atomique — jamais automatique.
 */
export async function publishSession(
  ctx: SchoolCtx,
  sessionId: string,
): Promise<DeliberationResult> {
  if (!(await hasPerm(ctx, "deliberations.publish"))) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const session = await prisma.deliberationSession.findFirst({
    where: { id: sessionId, schoolId: ctx.schoolId },
    include: { decisions: { select: { studentId: true, finalLabel: true } } },
  });
  if (!session) return { ok: false, error: "NOT_FOUND" };

  const done = await prisma.$transaction(async (tx) => {
    const u = await tx.deliberationSession.updateMany({
      where: { id: session.id, status: "VALIDATED" },
      data: { status: "PUBLISHED", publishedById: ctx.userId, publishedAt: new Date() },
    });
    if (!u.count) return false;
    for (const d of session.decisions) {
      if (!d.finalLabel) continue;
      if (session.scope === "PERIOD") {
        await tx.studentPeriodResult.updateMany({
          where: {
            schoolId: ctx.schoolId,
            academicPeriodId: session.academicPeriodId!,
            studentId: d.studentId,
          },
          data: { councilDecision: d.finalLabel },
        });
      } else {
        await tx.studentAnnualResult.updateMany({
          where: {
            schoolId: ctx.schoolId,
            academicYearId: session.academicYearId,
            studentId: d.studentId,
          },
          data: { decision: d.finalLabel },
        });
      }
    }
    return true;
  });
  if (!done) return { ok: false, error: "INVALID_STATUS" };

  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "deliberation.publish",
    entity: "DeliberationSession",
    entityId: session.id,
    metadata: { number: session.number, decisions: session.decisions.length },
  });
  return { ok: true, result: undefined };
}

/**
 * Dépublication motivée : la session repasse VALIDATED et les libellés
 * synchronisés sont retirés — uniquement là où ils valent encore la
 * décision publiée (les corrections manuelles éventuelles sont
 * préservées).
 */
export async function depublishSession(
  ctx: SchoolCtx,
  sessionId: string,
  reason: string,
): Promise<DeliberationResult> {
  if (!(await hasPerm(ctx, "deliberations.publish"))) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const r = reason.trim();
  if (!r) return { ok: false, error: "REASON_REQUIRED" };

  const session = await prisma.deliberationSession.findFirst({
    where: { id: sessionId, schoolId: ctx.schoolId, status: "PUBLISHED" },
    include: { decisions: { select: { studentId: true, finalLabel: true } } },
  });
  if (!session) return { ok: false, error: "INVALID_STATUS" };

  const done = await prisma.$transaction(async (tx) => {
    const u = await tx.deliberationSession.updateMany({
      where: { id: session.id, status: "PUBLISHED" },
      data: {
        status: "VALIDATED",
        depublishReason: r,
        depublishedAt: new Date(),
      },
    });
    if (!u.count) return false;
    for (const d of session.decisions) {
      if (!d.finalLabel) continue;
      if (session.scope === "PERIOD") {
        await tx.studentPeriodResult.updateMany({
          where: {
            schoolId: ctx.schoolId,
            academicPeriodId: session.academicPeriodId!,
            studentId: d.studentId,
            councilDecision: d.finalLabel,
          },
          data: { councilDecision: null },
        });
      } else {
        await tx.studentAnnualResult.updateMany({
          where: {
            schoolId: ctx.schoolId,
            academicYearId: session.academicYearId,
            studentId: d.studentId,
            decision: d.finalLabel,
          },
          data: { decision: null },
        });
      }
    }
    return true;
  });
  if (!done) return { ok: false, error: "INVALID_STATUS" };

  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "deliberation.depublish",
    entity: "DeliberationSession",
    entityId: session.id,
    metadata: { reason: r },
  });
  return { ok: true, result: undefined };
}

// ---------- Données pour le procès-verbal ----------

export async function getSessionForPv(ctx: SchoolCtx, id: string) {
  if (!(await hasPerm(ctx, "deliberations.read"))) return null;
  const session = await prisma.deliberationSession.findFirst({
    where: { id, schoolId: ctx.schoolId },
    include: {
      classroom: {
        select: {
          name: true,
          level: { select: { name: true } },
          headTeacher: { select: { firstName: true, lastName: true } },
        },
      },
      academicPeriod: { select: { name: true, number: true } },
      academicYear: { select: { name: true } },
      decisions: {
        include: {
          student: { select: { matricule: true, firstName: true, lastName: true } },
        },
        orderBy: [{ rankSnapshot: "asc" }, { student: { lastName: "asc" } }],
      },
    },
  });
  if (!session) return null;
  const school = await prisma.school.findUnique({
    where: { id: ctx.schoolId },
    select: {
      name: true, address: true, city: true, phone: true,
      email: true, logoUrl: true,
    },
  });

  const byDecision = new Map<string, number>();
  let undecided = 0;
  for (const d of session.decisions) {
    if (d.finalLabel) {
      byDecision.set(d.finalLabel, (byDecision.get(d.finalLabel) ?? 0) + 1);
    } else undecided++;
  }
  const averages = session.decisions
    .map((d) => d.averageSnapshot)
    .filter((a): a is number => a != null);
  const stats = {
    enrolled: session.decisions.length,
    ranked: averages.length,
    classAverage: averages.length
      ? averages.reduce((a, b) => a + b, 0) / averages.length
      : null,
    byDecision: [...byDecision.entries()].sort((a, b) => b[1] - a[1]),
    undecided,
  };
  return { session, school, stats };
}
