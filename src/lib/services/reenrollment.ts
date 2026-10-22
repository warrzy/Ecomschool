import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { enrollStudent } from "@/lib/services/enrollments";
import { generateStudentCharges } from "@/lib/services/finance/accounts";
import { uploadDocument } from "@/lib/services/documents";
import { notifyUsers } from "@/lib/services/notifications";
import { verifyChildAccess } from "@/lib/services/portal/parent";
import { MAX_APPLICATION_DOCS } from "@/lib/services/admissions";
import { Prisma } from "@prisma/client";
import type {
  ReenrollmentCampaignStatus,
  ReenrollmentKind,
  ReenrollmentProgression,
  ReenrollmentRequestStatus,
} from "@prisma/client";

/**
 * G2-E — Réinscriptions annuelles (renouvellement de scolarité).
 *
 * Deux profils :
 *  - Back-office : campagnes, instruction, décision, finalisation, lot.
 *    Permissions `reenrollments.*` vérifiées dans le service ; la
 *    finalisation exige en plus `enrollment.create` (même règle que
 *    la conversion G2-D — aucune permission financière requise).
 *  - Portail parent : dépôt, réponse aux compléments, pièces. Chaque
 *    accès revérifie `verifyChildAccess` (lien StudentGuardian) —
 *    un parent n'atteint jamais le dossier d'un autre enfant.
 *
 * Finalisation : verrous advisory (demande puis classe) → `enrollStudent`
 * dans la transaction → demande COMPLETED + lien newEnrollmentId →
 * créances générées APRÈS commit (P2002 → 25P02, pattern G2-D), rejouables
 * en rappelant `finalizeRequest` (idempotent).
 *
 * Jamais dans ce module : aucun paiement, aucun effacement d'impayé,
 * aucun envoi externe, aucune modification des inscriptions historiques.
 */

export type ReenrollError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_STATE"
  | "CAMPAIGN_CLOSED"
  | "CAMPAIGN_OUT_OF_WINDOW"
  | "NOT_ELIGIBLE"
  | "ALREADY_SUBMITTED"
  | "ALREADY_ENROLLED"
  | "MISSING_DOCS"
  | "CLASSROOM_FULL"
  | "CLASSROOM_ARCHIVED"
  | "CROSS_YEAR"
  | "YEAR_CLOSED"
  | "STUDENT_INACTIVE"
  | "UNPAID_BLOCKED"
  | "TOO_MANY_DOCS"
  | "LIMIT_REACHED"
  | "CREATE_FAILED";

export type ReenrollResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: ReenrollError };

type SchoolCtx = { userId: string; schoolId: string };

const err = (e: ReenrollError): ReenrollResult<never> => ({ ok: false, error: e });
const ok = <T>(result: T): ReenrollResult<T> => ({ ok: true, result });

class ReenrollAbort extends Error {
  constructor(public readonly code: ReenrollError) {
    super(code);
  }
}

async function hasPerm(ctx: SchoolCtx, key: string) {
  return userHasSchoolPermission({
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    permissionKey: key,
  });
}

// ---------- Helpers métier ----------

export type RequiredReenrollDoc = { key: string; label: string; category: string; required?: boolean };

export function requiredDocsOfCampaign(campaign: { requiredDocs: unknown }): RequiredReenrollDoc[] {
  const raw = campaign.requiredDocs;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (d): d is RequiredReenrollDoc =>
      !!d && typeof d === "object" &&
      typeof (d as RequiredReenrollDoc).key === "string" &&
      typeof (d as RequiredReenrollDoc).label === "string" &&
      typeof (d as RequiredReenrollDoc).category === "string",
  );
}

function campaignLevelIds(campaign: { targetLevelIds: unknown }): string[] {
  return Array.isArray(campaign.targetLevelIds)
    ? campaign.targetLevelIds.filter((x): x is string => typeof x === "string")
    : [];
}

function progressionOverrides(campaign: { progressionOverrides: unknown }): Record<string, string> {
  const raw = campaign.progressionOverrides;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** Solde d'un élève sur une année : charges - remises - paiements validés. */
async function studentYearBalance(
  studentId: string,
  academicYearId: string,
  schoolId: string,
): Promise<number> {
  const [charges, discounts, paidAgg] = await Promise.all([
    prisma.studentFeeCharge.aggregate({
      where: { schoolId, studentId, academicYearId, status: "ACTIVE" },
      _sum: { amount: true },
    }),
    prisma.feeDiscount.findMany({
      where: { schoolId, studentId, academicYearId, status: "ACTIVE" },
      select: { type: true, value: true },
    }),
    prisma.payment.aggregate({
      where: { schoolId, studentId, academicYearId, status: "VALIDATED" },
      _sum: { amount: true },
    }),
  ]);
  const total = charges._sum.amount ?? 0;
  const disc = discounts.reduce(
    (s, d) =>
      s + (d.type === "PERCENT" ? Math.floor((total * d.value) / 100)
        : d.type === "EXEMPTION" ? total : d.value),
    0,
  );
  return Math.max(0, total - disc) - (paidAgg._sum.amount ?? 0);
}

/**
 * Progression suggérée (jamais automatique) : décision annuelle publiée
 * si disponible, surcharge de campagne, sinon niveau d'ordre supérieur.
 */
async function suggestProgression(
  campaign: {
    id: string;
    schoolId: string;
    sourceYearId: string;
    progressionOverrides: unknown;
  },
  studentId: string,
  sourceLevelId: string | null,
): Promise<{
  progression: ReenrollmentProgression | null;
  targetLevelId: string | null;
  basis: "ANNUAL_DECISION" | "OVERRIDE" | "LEVEL_ORDER" | "NONE";
}> {
  const overrides = progressionOverrides(campaign);

  const annual = await prisma.studentAnnualResult.findFirst({
    where: {
      schoolId: campaign.schoolId,
      studentId,
      academicYearId: campaign.sourceYearId,
      status: { in: ["PUBLISHED", "RECTIFIED"] },
    },
    select: { decision: true },
  });
  const decision = (annual?.decision ?? "").toLowerCase();

  let progression: ReenrollmentProgression | null = null;
  if (/redoubl/.test(decision)) progression = "REPETITION";
  else if (/admis|passe|sup[ée]rieur/.test(decision)) progression = "PROMOTION";

  if (progression === "REPETITION" && sourceLevelId) {
    return { progression, targetLevelId: sourceLevelId, basis: "ANNUAL_DECISION" };
  }
  if (sourceLevelId && overrides[sourceLevelId]) {
    return {
      progression: progression ?? "PROMOTION",
      targetLevelId: overrides[sourceLevelId],
      basis: annual?.decision ? "ANNUAL_DECISION" : "OVERRIDE",
    };
  }
  if (sourceLevelId) {
    const source = await prisma.level.findFirst({
      where: { id: sourceLevelId, schoolId: campaign.schoolId },
      select: { order: true },
    });
    if (source) {
      const next = await prisma.level.findFirst({
        where: { schoolId: campaign.schoolId, status: "ACTIVE", order: { gt: source.order } },
        orderBy: { order: "asc" },
        select: { id: true },
      });
      if (next) {
        return {
          progression: progression ?? "PROMOTION",
          targetLevelId: next.id,
          basis: annual?.decision ? "ANNUAL_DECISION" : "LEVEL_ORDER",
        };
      }
    }
  }
  return {
    progression,
    targetLevelId: sourceLevelId,
    basis: progression ? "ANNUAL_DECISION" : "NONE",
  };
}

/** Déduit la progression enregistrée à partir des niveaux source/cible. */
function deriveProgression(
  sourceOrder: number | null,
  targetOrder: number | null,
  explicit?: ReenrollmentProgression | null,
): ReenrollmentProgression {
  if (explicit) return explicit;
  if (sourceOrder == null || targetOrder == null) return "RETURN";
  if (targetOrder > sourceOrder) return "PROMOTION";
  if (targetOrder < sourceOrder) return "REPETITION";
  return "SAME_LEVEL";
}

// ---------- Campagnes (back-office) ----------

export type ReenrollCampaignInput = {
  name: string;
  sourceYearId: string;
  targetYearId: string;
  description?: string;
  instructions?: string;
  familyMessage?: string;
  opensAt: Date;
  closesAt: Date;
  targetLevelIds?: string[];
  requiredDocs?: RequiredReenrollDoc[];
  blockOnUnpaid?: boolean;
  progressionOverrides?: Record<string, string>;
};

export async function listReenrollmentCampaigns(ctx: SchoolCtx) {
  if (!(await hasPerm(ctx, "reenrollments.read"))) return [];
  return prisma.reenrollmentCampaign.findMany({
    where: { schoolId: ctx.schoolId },
    include: {
      sourceYear: { select: { name: true } },
      targetYear: { select: { name: true } },
      _count: { select: { requests: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getReenrollmentCampaign(ctx: SchoolCtx, id: string) {
  if (!(await hasPerm(ctx, "reenrollments.read"))) return null;
  return prisma.reenrollmentCampaign.findFirst({
    where: { id, schoolId: ctx.schoolId },
    include: {
      sourceYear: { select: { id: true, name: true, isCurrent: true, status: true } },
      targetYear: { select: { id: true, name: true, isCurrent: true, status: true } },
      createdBy: { select: { firstName: true, lastName: true } },
    },
  });
}

export async function createReenrollmentCampaign(
  ctx: SchoolCtx,
  input: ReenrollCampaignInput,
): Promise<ReenrollResult<{ id: string }>> {
  if (!(await hasPerm(ctx, "reenrollments.manage"))) return err("FORBIDDEN");
  const name = input.name.trim();
  if (!name || input.opensAt >= input.closesAt) return err("INVALID_INPUT");
  if (input.sourceYearId === input.targetYearId) return err("INVALID_INPUT");

  const [source, target] = await Promise.all([
    prisma.academicYear.findFirst({ where: { id: input.sourceYearId, schoolId: ctx.schoolId } }),
    prisma.academicYear.findFirst({ where: { id: input.targetYearId, schoolId: ctx.schoolId } }),
  ]);
  if (!source || !target) return err("NOT_FOUND");
  if (target.status === "CLOSED") return err("YEAR_CLOSED");

  // Une seule campagne non archivée par année cible.
  const existing = await prisma.reenrollmentCampaign.findFirst({
    where: {
      schoolId: ctx.schoolId,
      targetYearId: input.targetYearId,
      status: { not: "ARCHIVED" },
    },
    select: { id: true },
  });
  if (existing) return err("ALREADY_SUBMITTED");

  const levelIds = input.targetLevelIds ?? [];
  if (levelIds.length) {
    const n = await prisma.level.count({
      where: { id: { in: levelIds }, schoolId: ctx.schoolId },
    });
    if (n !== levelIds.length) return err("NOT_FOUND");
  }

  const campaign = await prisma.reenrollmentCampaign.create({
    data: {
      schoolId: ctx.schoolId,
      sourceYearId: input.sourceYearId,
      targetYearId: input.targetYearId,
      name,
      description: input.description?.trim() || null,
      instructions: input.instructions?.trim() || null,
      familyMessage: input.familyMessage?.trim() || null,
      opensAt: input.opensAt,
      closesAt: input.closesAt,
      targetLevelIds: levelIds.length ? levelIds : undefined,
      requiredDocs: (input.requiredDocs ?? []) as unknown as Prisma.InputJsonValue,
      blockOnUnpaid: input.blockOnUnpaid ?? false,
      progressionOverrides:
        input.progressionOverrides && Object.keys(input.progressionOverrides).length
          ? (input.progressionOverrides as unknown as Prisma.InputJsonValue)
          : undefined,
      createdById: ctx.userId,
    },
    select: { id: true },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "reenrollment.campaign.create",
    entity: "ReenrollmentCampaign",
    entityId: campaign.id,
    metadata: { sourceYearId: input.sourceYearId, targetYearId: input.targetYearId },
  });
  return ok(campaign);
}

export async function updateReenrollmentCampaign(
  ctx: SchoolCtx,
  campaignId: string,
  input: Partial<Omit<ReenrollCampaignInput, "sourceYearId" | "targetYearId">>,
): Promise<ReenrollResult> {
  if (!(await hasPerm(ctx, "reenrollments.manage"))) return err("FORBIDDEN");
  const campaign = await prisma.reenrollmentCampaign.findFirst({
    where: { id: campaignId, schoolId: ctx.schoolId },
    select: { id: true, status: true, opensAt: true, closesAt: true },
  });
  if (!campaign) return err("NOT_FOUND");
  if (campaign.status === "ARCHIVED") return err("INVALID_STATE");

  const opensAt = input.opensAt ?? campaign.opensAt;
  const closesAt = input.closesAt ?? campaign.closesAt;
  if (opensAt >= closesAt) return err("INVALID_INPUT");

  await prisma.reenrollmentCampaign.update({
    where: { id: campaign.id },
    data: {
      ...(input.name !== undefined && input.name.trim() ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.instructions !== undefined ? { instructions: input.instructions?.trim() || null } : {}),
      ...(input.familyMessage !== undefined ? { familyMessage: input.familyMessage?.trim() || null } : {}),
      opensAt,
      closesAt,
      ...(input.targetLevelIds !== undefined
        ? { targetLevelIds: input.targetLevelIds.length ? input.targetLevelIds : Prisma.JsonNull }
        : {}),
      ...(input.requiredDocs !== undefined
        ? { requiredDocs: input.requiredDocs as unknown as Prisma.InputJsonValue }
        : {}),
      ...(input.blockOnUnpaid !== undefined ? { blockOnUnpaid: input.blockOnUnpaid } : {}),
      ...(input.progressionOverrides !== undefined
        ? {
            progressionOverrides: Object.keys(input.progressionOverrides).length
              ? (input.progressionOverrides as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          }
        : {}),
    },
  });
  return ok(undefined);
}

const CAMPAIGN_FLOW: Record<ReenrollmentCampaignStatus, ReenrollmentCampaignStatus[]> = {
  DRAFT: ["OPEN", "ARCHIVED"],
  OPEN: ["CLOSED", "ARCHIVED"],
  CLOSED: ["ARCHIVED"],
  ARCHIVED: [],
};

export async function setReenrollmentCampaignStatus(
  ctx: SchoolCtx,
  campaignId: string,
  status: ReenrollmentCampaignStatus,
): Promise<ReenrollResult> {
  if (!(await hasPerm(ctx, "reenrollments.manage"))) return err("FORBIDDEN");
  const campaign = await prisma.reenrollmentCampaign.findFirst({
    where: { id: campaignId, schoolId: ctx.schoolId },
    select: { id: true, status: true },
  });
  if (!campaign) return err("NOT_FOUND");
  if (!CAMPAIGN_FLOW[campaign.status].includes(status)) return err("INVALID_STATE");
  await prisma.reenrollmentCampaign.update({ where: { id: campaign.id }, data: { status } });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "reenrollment.campaign.status",
    entity: "ReenrollmentCampaign",
    entityId: campaign.id,
    metadata: { from: campaign.status, to: status },
  });
  return ok(undefined);
}

// ---------- Éligibilité et tableau de bord ----------

export type EligibleStudent = {
  studentId: string;
  matricule: string;
  firstName: string;
  lastName: string;
  sourceEnrollmentId: string | null;
  sourceClassroom: string | null;
  sourceLevelId: string | null;
  sourceLevelName: string | null;
  interrupted: boolean;
  annualDecision: string | null;
  suggestion: {
    progression: ReenrollmentProgression | null;
    targetLevelId: string | null;
    targetLevelName: string | null;
  };
  unpaidBalance: number;
  request: { id: string; status: ReenrollmentRequestStatus } | null;
  blockers: string[];
};

/**
 * Élèves éligibles à une campagne : ENROLLED sur l'année source
 * (filtre niveaux) + élèves ACTIVE sans inscription source mais avec
 * un historique (retour après interruption). Chaque ligne porte la
 * suggestion de progression (jamais appliquée sans décision humaine),
 * le solde impayé source et les blocages.
 */
export async function listEligibleStudents(
  ctx: SchoolCtx,
  campaignId: string,
): Promise<ReenrollResult<EligibleStudent[]>> {
  if (!(await hasPerm(ctx, "reenrollments.read"))) return err("FORBIDDEN");
  const campaign = await prisma.reenrollmentCampaign.findFirst({
    where: { id: campaignId, schoolId: ctx.schoolId },
  });
  if (!campaign) return err("NOT_FOUND");

  const levelIds = campaignLevelIds(campaign);

  const sourceEnrollments = await prisma.enrollment.findMany({
    where: {
      schoolId: ctx.schoolId,
      academicYearId: campaign.sourceYearId,
      status: "ENROLLED",
      student: { status: "ACTIVE" },
      ...(levelIds.length ? { classroom: { levelId: { in: levelIds } } } : {}),
    },
    select: {
      id: true,
      studentId: true,
      classroom: { select: { id: true, name: true, levelId: true, level: { select: { name: true } } } },
      student: { select: { id: true, matricule: true, firstName: true, lastName: true } },
    },
  });

  // Retours après interruption : ACTIVE, aucun ENROLLED sur l'année
  // source, mais au moins une inscription historique d'une autre année.
  const interrupted = await prisma.student.findMany({
    where: {
      schoolId: ctx.schoolId,
      status: "ACTIVE",
      enrollments: {
        some: { status: { in: ["ENROLLED", "TRANSFERRED", "WITHDRAWN", "COMPLETED"] } },
        none: { academicYearId: campaign.sourceYearId, status: "ENROLLED" },
      },
    },
    select: {
      id: true, matricule: true, firstName: true, lastName: true,
      enrollments: {
        where: { status: { in: ["ENROLLED", "COMPLETED", "TRANSFERRED", "WITHDRAWN"] } },
        orderBy: { academicYear: { startDate: "desc" } },
        take: 1,
        select: {
          id: true,
          classroom: { select: { name: true, levelId: true, level: { select: { name: true } } } },
        },
      },
    },
  });

  const studentIds = [
    ...sourceEnrollments.map((e) => e.studentId),
    ...interrupted.map((s) => s.id),
  ];
  const [requests, annuals, levelNames] = await Promise.all([
    prisma.reenrollmentRequest.findMany({
      where: { schoolId: ctx.schoolId, targetYearId: campaign.targetYearId, studentId: { in: studentIds } },
      select: { id: true, studentId: true, status: true },
    }),
    prisma.studentAnnualResult.findMany({
      where: {
        schoolId: ctx.schoolId,
        academicYearId: campaign.sourceYearId,
        studentId: { in: studentIds },
        status: { in: ["PUBLISHED", "RECTIFIED"] },
      },
      select: { studentId: true, decision: true },
    }),
    prisma.level.findMany({
      where: { schoolId: ctx.schoolId },
      select: { id: true, name: true },
    }),
  ]);
  const reqByStudent = new Map(requests.map((r) => [r.studentId, r]));
  const annualByStudent = new Map(annuals.map((a) => [a.studentId, a]));
  const levelName = new Map(levelNames.map((l) => [l.id, l.name]));

  const rows: EligibleStudent[] = [];
  for (const e of sourceEnrollments) {
    const sug = await suggestProgression(campaign, e.studentId, e.classroom.levelId);
    const balance = await studentYearBalance(e.studentId, campaign.sourceYearId, ctx.schoolId);
    const blockers: string[] = [];
    if (campaign.blockOnUnpaid && balance > 0) blockers.push("impayes");
    rows.push({
      studentId: e.studentId,
      matricule: e.student.matricule,
      firstName: e.student.firstName,
      lastName: e.student.lastName,
      sourceEnrollmentId: e.id,
      sourceClassroom: e.classroom.name,
      sourceLevelId: e.classroom.levelId,
      sourceLevelName: e.classroom.level.name,
      interrupted: false,
      annualDecision: annualByStudent.get(e.studentId)?.decision ?? null,
      suggestion: {
        progression: sug.progression,
        targetLevelId: sug.targetLevelId,
        targetLevelName: sug.targetLevelId ? (levelName.get(sug.targetLevelId) ?? null) : null,
      },
      unpaidBalance: balance,
      request: reqByStudent.get(e.studentId) ?? null,
      blockers,
    });
  }
  for (const s of interrupted) {
    const last = s.enrollments[0];
    const sug = await suggestProgression(campaign, s.id, last?.classroom.levelId ?? null);
    const blockers: string[] = ["interruption"];
    rows.push({
      studentId: s.id,
      matricule: s.matricule,
      firstName: s.firstName,
      lastName: s.lastName,
      sourceEnrollmentId: last?.id ?? null,
      sourceClassroom: last?.classroom.name ?? null,
      sourceLevelId: last?.classroom.levelId ?? null,
      sourceLevelName: last?.classroom.level.name ?? null,
      interrupted: true,
      annualDecision: annualByStudent.get(s.id)?.decision ?? null,
      suggestion: {
        progression: "RETURN",
        targetLevelId: sug.targetLevelId,
        targetLevelName: sug.targetLevelId ? (levelName.get(sug.targetLevelId) ?? null) : null,
      },
      unpaidBalance: 0,
      request: reqByStudent.get(s.id) ?? null,
      blockers,
    });
  }
  rows.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  return ok(rows);
}

export async function reenrollmentDashboard(ctx: SchoolCtx, campaignId: string) {
  if (!(await hasPerm(ctx, "reenrollments.read"))) return null;
  const campaign = await prisma.reenrollmentCampaign.findFirst({
    where: { id: campaignId, schoolId: ctx.schoolId },
    select: { id: true, name: true, status: true },
  });
  if (!campaign) return null;
  const groups = await prisma.reenrollmentRequest.groupBy({
    by: ["status"],
    where: { campaignId, schoolId: ctx.schoolId },
    _count: { _all: true },
  });
  const byStatus = Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
  return {
    campaign,
    total: groups.reduce((s, g) => s + g._count._all, 0),
    submitted: byStatus["SUBMITTED"] ?? 0,
    underReview: byStatus["UNDER_REVIEW"] ?? 0,
    infoRequired: byStatus["ADDITIONAL_INFO_REQUIRED"] ?? 0,
    approved: byStatus["APPROVED"] ?? 0,
    rejected: byStatus["REJECTED"] ?? 0,
    completed: byStatus["COMPLETED"] ?? 0,
    cancelled: byStatus["CANCELLED"] ?? 0,
  };
}

// ---------- Demandes (back-office) ----------

export async function listReenrollmentRequests(
  ctx: SchoolCtx,
  opts: { campaignId?: string; status?: ReenrollmentRequestStatus; q?: string } = {},
) {
  if (!(await hasPerm(ctx, "reenrollments.read"))) return [];
  return prisma.reenrollmentRequest.findMany({
    where: {
      schoolId: ctx.schoolId,
      ...(opts.campaignId ? { campaignId: opts.campaignId } : {}),
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.q
        ? {
            student: {
              OR: [
                { lastName: { contains: opts.q, mode: "insensitive" } },
                { firstName: { contains: opts.q, mode: "insensitive" } },
                { matricule: { contains: opts.q, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    },
    include: {
      student: { select: { id: true, matricule: true, firstName: true, lastName: true } },
      campaign: { select: { id: true, name: true, targetYear: { select: { name: true } } } },
      sourceEnrollment: {
        select: { classroom: { select: { name: true, level: { select: { name: true } } } } },
      },
      targetClassroom: { select: { name: true } },
      guardian: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 500,
  });
}

export async function getReenrollmentRequest(ctx: SchoolCtx, id: string) {
  const canReview = await hasPerm(ctx, "reenrollments.review");
  if (!(await hasPerm(ctx, "reenrollments.read"))) return null;
  const req = await prisma.reenrollmentRequest.findFirst({
    where: { id, schoolId: ctx.schoolId },
    include: {
      campaign: {
        include: {
          sourceYear: { select: { name: true } },
          targetYear: { select: { name: true, status: true } },
        },
      },
      student: {
        select: { id: true, matricule: true, firstName: true, lastName: true, birthDate: true, status: true },
      },
      guardian: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, address: true } },
      submittedBy: { select: { firstName: true, lastName: true } },
      sourceEnrollment: {
        select: {
          id: true,
          classroom: { select: { name: true, levelId: true, level: { select: { name: true, order: true } } } },
          academicYear: { select: { name: true } },
        },
      },
      desiredLevel: { select: { id: true, name: true } },
      desiredClassroom: { select: { id: true, name: true } },
      targetClassroom: { select: { id: true, name: true, level: { select: { name: true } } } },
      newEnrollment: { select: { id: true } },
      decidedBy: { select: { firstName: true, lastName: true } },
      completedBy: { select: { firstName: true, lastName: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        ...(canReview
          ? {}
          : { where: { visibleToParent: true } }),
        include: { createdBy: { select: { firstName: true, lastName: true } } },
      },
    },
  });
  if (!req) return null;
  // Pièces : visibles uniquement avec `reenrollments.review`.
  const documents = canReview
    ? await prisma.document.findMany({
        where: { ownerType: "REENROLLMENT", ownerId: req.id, status: "ACTIVE" },
        select: { id: true, label: true, category: true, originalName: true, sizeBytes: true, createdAt: true },
      })
    : [];
  // Classes de l'année cible avec places restantes.
  const classrooms = await prisma.classroom.findMany({
    where: { schoolId: ctx.schoolId, academicYearId: req.campaign.targetYearId, status: "ACTIVE" },
    select: {
      id: true, name: true, capacity: true,
      level: { select: { id: true, name: true } },
      _count: { select: { enrollments: { where: { status: "ENROLLED" } } } },
    },
    orderBy: [{ level: { order: "asc" } }, { name: "asc" }],
  });
  const unpaidBalance = await studentYearBalance(req.studentId, req.campaign.sourceYearId, ctx.schoolId);
  const docs = await prisma.document.findMany({
    where: { ownerType: "REENROLLMENT", ownerId: req.id, status: "ACTIVE" },
    select: { label: true, category: true },
  });
  const missingDocs = requiredDocsOfCampaign(req.campaign)
    .filter((rd) => rd.required !== false)
    .filter((rd) => !docs.some((d) => d.label === rd.key || d.label === rd.label))
    .map((rd) => rd.label);
  const blockers: string[] = [];
  if (missingDocs.length && req.kind === "REENROLL") blockers.push("pieces_manquantes");
  if (req.campaign.blockOnUnpaid && unpaidBalance > 0) blockers.push("impayes");

  return {
    ...req,
    documents: canReview ? documents : undefined,
    classrooms: classrooms.map((c) => ({
      id: c.id,
      name: c.name,
      levelName: c.level.name,
      levelId: c.level.id,
      capacity: c.capacity,
      enrolled: c._count.enrollments,
      seatsLeft: c.capacity == null ? null : c.capacity - c._count.enrollments,
    })),
    unpaidBalance,
    missingDocs,
    blockers,
  };
}

export async function reviewReenrollmentRequest(
  ctx: SchoolCtx,
  requestId: string,
): Promise<ReenrollResult> {
  if (!(await hasPerm(ctx, "reenrollments.review"))) return err("FORBIDDEN");
  const updated = await prisma.reenrollmentRequest.updateMany({
    where: {
      id: requestId,
      schoolId: ctx.schoolId,
      status: { in: ["SUBMITTED", "ADDITIONAL_INFO_REQUIRED"] },
    },
    data: { status: "UNDER_REVIEW" },
  });
  if (!updated.count) return err("INVALID_STATE");
  return ok(undefined);
}

export async function requestReenrollmentInfo(
  ctx: SchoolCtx,
  requestId: string,
  message: string,
): Promise<ReenrollResult> {
  if (!(await hasPerm(ctx, "reenrollments.review"))) return err("FORBIDDEN");
  if (!message.trim()) return err("INVALID_INPUT");
  const req = await prisma.reenrollmentRequest.findFirst({
    where: { id: requestId, schoolId: ctx.schoolId },
    select: { id: true, status: true },
  });
  if (!req) return err("NOT_FOUND");
  if (!["SUBMITTED", "UNDER_REVIEW"].includes(req.status)) return err("INVALID_STATE");
  await prisma.$transaction([
    prisma.reenrollmentRequest.update({
      where: { id: req.id },
      data: { status: "ADDITIONAL_INFO_REQUIRED" },
    }),
    prisma.reenrollmentMessage.create({
      data: {
        schoolId: ctx.schoolId,
        requestId: req.id,
        kind: "INFO_REQUEST",
        body: message.trim(),
        createdById: ctx.userId,
        visibleToParent: true,
      },
    }),
  ]);
  return ok(undefined);
}

export async function addReenrollmentInternalNote(
  ctx: SchoolCtx,
  requestId: string,
  message: string,
): Promise<ReenrollResult> {
  if (!(await hasPerm(ctx, "reenrollments.review"))) return err("FORBIDDEN");
  if (!message.trim()) return err("INVALID_INPUT");
  const req = await prisma.reenrollmentRequest.findFirst({
    where: { id: requestId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!req) return err("NOT_FOUND");
  await prisma.reenrollmentMessage.create({
    data: {
      schoolId: ctx.schoolId,
      requestId: req.id,
      kind: "INTERNAL_NOTE",
      body: message.trim(),
      createdById: ctx.userId,
      visibleToParent: false,
    },
  });
  return ok(undefined);
}

export async function decideReenrollmentRequest(
  ctx: SchoolCtx,
  requestId: string,
  input: {
    decision: "APPROVED" | "REJECTED";
    reason?: string;
    targetClassroomId?: string;
    progression?: ReenrollmentProgression;
  },
): Promise<ReenrollResult> {
  if (!(await hasPerm(ctx, "reenrollments.decide"))) return err("FORBIDDEN");
  const req = await prisma.reenrollmentRequest.findFirst({
    where: { id: requestId, schoolId: ctx.schoolId },
    include: {
      campaign: {
        select: {
          targetYearId: true,
          blockOnUnpaid: true,
          sourceYearId: true,
          requiredDocs: true,
        },
      },
      sourceEnrollment: { select: { classroom: { select: { level: { select: { order: true } } } } } },
      student: { select: { status: true } },
    },
  });
  if (!req) return err("NOT_FOUND");
  if (req.status !== "UNDER_REVIEW" && req.status !== "ADDITIONAL_INFO_REQUIRED") {
    return err("INVALID_STATE");
  }
  if (req.student.status !== "ACTIVE") return err("STUDENT_INACTIVE");
  if (req.kind === "DEPARTURE" && input.decision === "APPROVED") {
    // Un départ n'a pas de classe cible : approbation = simple
    // acquittement administratif, finalisé comme COMPLETED directement.
    await prisma.reenrollmentRequest.update({
      where: { id: req.id },
      data: {
        status: "COMPLETED",
        decidedById: ctx.userId,
        decidedAt: new Date(),
        completedById: ctx.userId,
        completedAt: new Date(),
        decisionReason: input.reason?.trim() || null,
      },
    });
    await prisma.reenrollmentMessage.create({
      data: {
        schoolId: ctx.schoolId,
        requestId: req.id,
        kind: "DECISION",
        body: "Départ acté — l'élève ne sera pas réinscrit pour l'année prochaine.",
        createdById: ctx.userId,
        visibleToParent: true,
      },
    });
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "reenrollment.departure.ack",
      entity: "ReenrollmentRequest",
      entityId: req.id,
    });
    return ok(undefined);
  }
  if (input.decision === "REJECTED") {
    if (!input.reason?.trim()) return err("INVALID_INPUT");
    const updated = await prisma.reenrollmentRequest.updateMany({
      where: { id: req.id, status: { in: ["UNDER_REVIEW", "ADDITIONAL_INFO_REQUIRED"] } },
      data: {
        status: "REJECTED",
        decisionReason: input.reason.trim(),
        decidedById: ctx.userId,
        decidedAt: new Date(),
      },
    });
    if (!updated.count) return err("INVALID_STATE");
    await prisma.reenrollmentMessage.create({
      data: {
        schoolId: ctx.schoolId,
        requestId: req.id,
        kind: "DECISION",
        body: `Réinscription refusée : ${input.reason.trim()}`,
        createdById: ctx.userId,
        visibleToParent: true,
      },
    });
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "reenrollment.reject",
      entity: "ReenrollmentRequest",
      entityId: req.id,
      metadata: { reason: input.reason.trim() },
    });
    return ok(undefined);
  }

  // APPROVED — classe cible obligatoire, dans l'année cible, non archivée.
  if (!input.targetClassroomId) return err("INVALID_INPUT");
  const classroom = await prisma.classroom.findFirst({
    where: { id: input.targetClassroomId, schoolId: ctx.schoolId },
    select: { id: true, academicYearId: true, status: true, level: { select: { order: true } } },
  });
  if (!classroom) return err("NOT_FOUND");
  if (classroom.status === "ARCHIVED") return err("CLASSROOM_ARCHIVED");
  if (classroom.academicYearId !== req.campaign.targetYearId) return err("CROSS_YEAR");

  if (req.campaign.blockOnUnpaid) {
    const balance = await studentYearBalance(req.studentId, req.campaign.sourceYearId, ctx.schoolId);
    if (balance > 0) return err("UNPAID_BLOCKED");
  }
  const docs = await prisma.document.findMany({
    where: { ownerType: "REENROLLMENT", ownerId: req.id, status: "ACTIVE" },
    select: { label: true },
  });
  const missing = requiredDocsOfCampaign(req.campaign)
    .filter((rd) => rd.required !== false)
    .filter((rd) => !docs.some((d) => d.label === rd.key || d.label === rd.label));
  if (missing.length) return err("MISSING_DOCS");

  const progression = deriveProgression(
    req.sourceEnrollment?.classroom.level.order ?? null,
    classroom.level.order,
    input.progression,
  );
  const updated = await prisma.reenrollmentRequest.updateMany({
    where: { id: req.id, status: { in: ["UNDER_REVIEW", "ADDITIONAL_INFO_REQUIRED"] } },
    data: {
      status: "APPROVED",
      targetClassroomId: classroom.id,
      progression,
      decidedById: ctx.userId,
      decidedAt: new Date(),
    },
  });
  if (!updated.count) return err("INVALID_STATE");
  await prisma.reenrollmentMessage.create({
    data: {
      schoolId: ctx.schoolId,
      requestId: req.id,
      kind: "DECISION",
      body: "Réinscription approuvée — l'inscription sera finalisée par l'administration.",
      createdById: ctx.userId,
      visibleToParent: true,
    },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "reenrollment.approve",
    entity: "ReenrollmentRequest",
    entityId: req.id,
    metadata: { targetClassroomId: classroom.id, progression },
  });
  return ok(undefined);
}

export async function cancelReenrollmentRequest(
  ctx: SchoolCtx,
  requestId: string,
): Promise<ReenrollResult> {
  if (!(await hasPerm(ctx, "reenrollments.review"))) return err("FORBIDDEN");
  const updated = await prisma.reenrollmentRequest.updateMany({
    where: {
      id: requestId,
      schoolId: ctx.schoolId,
      status: { in: ["SUBMITTED", "UNDER_REVIEW", "ADDITIONAL_INFO_REQUIRED", "APPROVED"] },
    },
    data: { status: "CANCELLED" },
  });
  if (!updated.count) return err("INVALID_STATE");
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "reenrollment.cancel",
    entity: "ReenrollmentRequest",
    entityId: requestId,
  });
  return ok(undefined);
}

// ---------- Finalisation (inscription annuelle) ----------

/**
 * Transforme une demande APPROVED en Enrollment de l'année cible.
 * Transaction : advisory lock demande → advisory lock classe →
 * `enrollStudent(tx)` → demande COMPLETED + coordonnées appliquées.
 * Créances générées après commit (`generateStudentCharges`, idempotent).
 * Rejeu : COMPLETED → renvoie les références (alreadyFinalized) et
 * retente les créances si elles avaient échoué.
 */
export async function finalizeReenrollment(
  ctx: SchoolCtx,
  requestId: string,
): Promise<
  ReenrollResult<{
    enrollmentId: string;
    alreadyFinalized?: boolean;
    chargesError?: string;
    charges?: { created: number; existing: number; skipped: number };
  }>
> {
  if (
    !(await hasPerm(ctx, "reenrollments.decide")) ||
    !(await hasPerm(ctx, "enrollment.create"))
  ) {
    return err("FORBIDDEN");
  }

  const req = await prisma.reenrollmentRequest.findFirst({
    where: { id: requestId, schoolId: ctx.schoolId },
    include: {
      campaign: { select: { id: true, targetYearId: true, sourceYearId: true, blockOnUnpaid: true } },
      guardian: { select: { id: true } },
    },
  });
  if (!req) return err("NOT_FOUND");

  let enrollmentId = req.newEnrollmentId ?? "";

  if (req.status !== "COMPLETED") {
    if (req.status !== "APPROVED" || !req.targetClassroomId) return err("INVALID_STATE");
    try {
      enrollmentId = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"reenroll:" + req.id}))`;

        const fresh = await tx.reenrollmentRequest.findUnique({ where: { id: req.id } });
        if (!fresh) throw new ReenrollAbort("NOT_FOUND");
        if (fresh.status === "COMPLETED" && fresh.newEnrollmentId) {
          return fresh.newEnrollmentId; // rejeu concurrent → idempotent
        }
        if (fresh.status !== "APPROVED" || !fresh.targetClassroomId) {
          throw new ReenrollAbort("INVALID_STATE");
        }

        // Verrou capacité : advisory sur la classe avant enrollStudent.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cls:" + fresh.targetClassroomId}))`;
        const classroom = await tx.classroom.findFirst({
          where: { id: fresh.targetClassroomId, schoolId: ctx.schoolId },
          select: { id: true, capacity: true, status: true, academicYearId: true },
        });
        if (!classroom) throw new ReenrollAbort("NOT_FOUND");
        if (classroom.status === "ARCHIVED") throw new ReenrollAbort("CLASSROOM_ARCHIVED");
        if (classroom.academicYearId !== req.campaign.targetYearId) {
          throw new ReenrollAbort("CROSS_YEAR");
        }
        if (classroom.capacity != null) {
          const enrolled = await tx.enrollment.count({
            where: {
              schoolId: ctx.schoolId,
              classroomId: classroom.id,
              status: "ENROLLED",
            },
          });
          if (enrolled >= classroom.capacity) throw new ReenrollAbort("CLASSROOM_FULL");
        }
        if (req.campaign.blockOnUnpaid) {
          const balance = await studentYearBalance(req.studentId, req.campaign.sourceYearId, ctx.schoolId);
          if (balance > 0) throw new ReenrollAbort("UNPAID_BLOCKED");
        }

        const enrolledRes = await enrollStudent(
          ctx,
          {
            studentId: fresh.studentId,
            classroomId: classroom.id,
            academicYearId: req.campaign.targetYearId,
          },
          tx,
        );
        if (!enrolledRes.ok) {
          throw new ReenrollAbort(
            enrolledRes.error === "ALREADY_ENROLLED"
              ? "ALREADY_ENROLLED"
              : enrolledRes.error === "CLASSROOM_ARCHIVED"
                ? "CLASSROOM_ARCHIVED"
                : enrolledRes.error === "CROSS_YEAR"
                  ? "CROSS_YEAR"
                  : enrolledRes.error === "YEAR_CLOSED"
                    ? "YEAR_CLOSED"
                    : enrolledRes.error === "STUDENT_INACTIVE"
                      ? "STUDENT_INACTIVE"
                      : enrolledRes.error === "LIMIT_REACHED"
                        ? "LIMIT_REACHED"
                        : enrolledRes.error === "NOT_FOUND"
                          ? "NOT_FOUND"
                          : "CREATE_FAILED",
          );
        }

        // Coordonnées actualisées par la famille → appliquées au
        // responsable déposant (champs non vides uniquement).
        const cu = fresh.contactUpdate as { phone?: string; email?: string; address?: string } | null;
        if (cu && fresh.guardianId) {
          const data: Record<string, string> = {};
          if (cu.phone?.trim()) data.phone = cu.phone.trim();
          if (cu.email?.trim()) data.email = cu.email.trim().toLowerCase();
          if (cu.address?.trim()) data.address = cu.address.trim();
          if (Object.keys(data).length) {
            await tx.guardian.update({ where: { id: fresh.guardianId }, data });
          }
        }

        await tx.reenrollmentRequest.update({
          where: { id: fresh.id },
          data: {
            status: "COMPLETED",
            newEnrollmentId: enrolledRes.result.id,
            completedById: ctx.userId,
            completedAt: new Date(),
          },
        });
        await tx.reenrollmentMessage.create({
          data: {
            schoolId: ctx.schoolId,
            requestId: fresh.id,
            kind: "DECISION",
            body: "Inscription finalisée pour l'année prochaine.",
            createdById: ctx.userId,
            visibleToParent: true,
          },
        });
        await logAudit({
          actorId: ctx.userId,
          schoolId: ctx.schoolId,
          action: "reenrollment.finalize",
          entity: "ReenrollmentRequest",
          entityId: fresh.id,
          metadata: {
            studentId: fresh.studentId,
            enrollmentId: enrolledRes.result.id,
            targetYearId: req.campaign.targetYearId,
          },
          tx,
        });
        return enrolledRes.result.id;
      });
    } catch (e) {
      if (e instanceof ReenrollAbort) return err(e.code);
      if ((e as { code?: string }).code === "P2002") return err("ALREADY_ENROLLED");
      throw e;
    }
  }

  const alreadyFinalized = req.status === "COMPLETED";

  // Créances de l'année cible — après commit, idempotentes (clé unique
  // student/année/catégorie + reprise P2002 dans applyTariff).
  const charges = await generateStudentCharges(ctx, {
    studentId: req.studentId,
    academicYearId: req.campaign.targetYearId,
  });
  return ok({
    enrollmentId,
    alreadyFinalized,
    chargesError: charges.ok ? undefined : charges.error,
    charges: charges.ok ? charges.result : undefined,
  });
}

export type BatchItemResult = {
  requestId: string;
  studentName: string;
  matricule: string;
  outcome: "SUCCESS" | "ALREADY" | "BLOCKED" | "FAILED";
  error?: ReenrollError;
  enrollmentId?: string;
};

/**
 * Traitement en masse borné (max 50 demandes) : chaque finalisation est
 * indépendante — un échec n'annule ni ne masque les autres.
 */
export async function batchFinalizeReenrollments(
  ctx: SchoolCtx,
  requestIds: string[],
): Promise<ReenrollResult<BatchItemResult[]>> {
  if (
    !(await hasPerm(ctx, "reenrollments.decide")) ||
    !(await hasPerm(ctx, "enrollment.create"))
  ) {
    return err("FORBIDDEN");
  }
  const ids = [...new Set(requestIds)].slice(0, 50);
  const results: BatchItemResult[] = [];
  const reqs = await prisma.reenrollmentRequest.findMany({
    where: { id: { in: ids }, schoolId: ctx.schoolId },
    select: {
      id: true,
      student: { select: { matricule: true, firstName: true, lastName: true } },
    },
  });
  const byId = new Map(reqs.map((r) => [r.id, r]));
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) {
      results.push({
        requestId: id,
        studentName: "—",
        matricule: "—",
        outcome: "BLOCKED",
        error: "NOT_FOUND",
      });
      continue;
    }
    const res = await finalizeReenrollment(ctx, id);
    results.push({
      requestId: id,
      studentName: `${r.student.lastName} ${r.student.firstName}`,
      matricule: r.student.matricule,
      outcome: !res.ok
        ? res.error === "ALREADY_ENROLLED" ||
          res.error === "MISSING_DOCS" ||
          res.error === "UNPAID_BLOCKED" ||
          res.error === "CLASSROOM_FULL" ||
          res.error === "INVALID_STATE"
          ? "BLOCKED"
          : "FAILED"
        : res.result.alreadyFinalized
          ? "ALREADY"
          : "SUCCESS",
      error: res.ok ? res.result.chargesError ? "CREATE_FAILED" : undefined : res.error,
      enrollmentId: res.ok ? res.result.enrollmentId : undefined,
    });
  }
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "reenrollment.batch_finalize",
    entity: "ReenrollmentRequest",
    metadata: {
      count: results.length,
      success: results.filter((r) => r.outcome === "SUCCESS").length,
      blocked: results.filter((r) => r.outcome === "BLOCKED").length,
      failed: results.filter((r) => r.outcome === "FAILED").length,
    },
  });
  return ok(results);
}

// ---------- Portail parent ----------

/**
 * Vue parent : campagnes ouvertes et dans leur fenêtre + pour chaque
 * enfant habilité, l'éligibilité (inscription source ou retour), la
 * demande existante, ses messages publics et ses pièces.
 */
export async function parentReenrollmentView(ctx: SchoolCtx) {
  const children = await prisma.studentGuardian.findMany({
    where: {
      schoolId: ctx.schoolId,
      guardian: { userId: ctx.userId, status: "ACTIVE", user: { status: "ACTIVE" } },
      student: { status: "ACTIVE" },
    },
    select: {
      student: {
        select: { id: true, matricule: true, firstName: true, lastName: true },
      },
      relation: true,
    },
  });
  if (!children.length) return { children: [], campaigns: [] };

  const now = new Date();
  const campaigns = await prisma.reenrollmentCampaign.findMany({
    where: { schoolId: ctx.schoolId, status: "OPEN", opensAt: { lte: now }, closesAt: { gte: now } },
    orderBy: { closesAt: "asc" },
  });
  if (!campaigns.length) return { children: [], campaigns: [] };

  const childIds = children.map((c) => c.student.id);
  const [enrollments, requests, levels] = await Promise.all([
    prisma.enrollment.findMany({
      where: {
        schoolId: ctx.schoolId,
        studentId: { in: childIds },
        status: { in: ["ENROLLED", "COMPLETED", "TRANSFERRED", "WITHDRAWN"] },
      },
      select: {
        studentId: true,
        academicYearId: true,
        status: true,
        classroom: { select: { name: true, levelId: true, level: { select: { name: true } } } },
        academicYear: { select: { name: true, startDate: true } },
      },
      orderBy: { academicYear: { startDate: "desc" } },
    }),
    prisma.reenrollmentRequest.findMany({
      where: {
        schoolId: ctx.schoolId,
        studentId: { in: childIds },
        campaignId: { in: campaigns.map((c) => c.id) },
      },
      include: {
        campaign: { select: { id: true } },
        messages: {
          where: { visibleToParent: true },
          orderBy: { createdAt: "asc" },
          select: { kind: true, body: true, createdAt: true },
        },
      },
    }),
    prisma.level.findMany({ where: { schoolId: ctx.schoolId, status: "ACTIVE" }, select: { id: true, name: true } }),
  ]);

  const out = campaigns.map((campaign) => {
    const levelIds = campaignLevelIds(campaign);
    const docs = requiredDocsOfCampaign(campaign);
    const perChild = children.map(({ student, relation }) => {
      const srcEnr = enrollments.find(
        (e) => e.studentId === student.id && e.academicYearId === campaign.sourceYearId && e.status === "ENROLLED",
      );
      const pastEnr = enrollments.find((e) => e.studentId === student.id);
      const eligible = !!srcEnr || !!pastEnr;
      const levelOk = !srcEnr || !levelIds.length || levelIds.includes(srcEnr.classroom.levelId);
      const request = requests.find(
        (r) => r.studentId === student.id && r.campaignId === campaign.id,
      );
      return {
        student,
        relation,
        eligible: eligible && levelOk,
        interrupted: !srcEnr && !!pastEnr,
        sourceClassroom: srcEnr?.classroom.name ?? pastEnr?.classroom.name ?? null,
        sourceYear: srcEnr?.academicYear.name ?? pastEnr?.academicYear.name ?? null,
        request: request
          ? {
              id: request.id,
              status: request.status,
              kind: request.kind,
              progression: request.progression,
              decisionReason: request.decisionReason,
              targetClassroom: null as string | null,
              messages: request.messages,
              createdAt: request.createdAt,
            }
          : null,
      };
    });
    return {
      id: campaign.id,
      name: campaign.name,
      description: campaign.description,
      familyMessage: campaign.familyMessage,
      instructions: campaign.instructions,
      closesAt: campaign.closesAt,
      sourceYearId: campaign.sourceYearId,
      requiredDocs: docs,
      levels,
      children: perChild,
    };
  });
  return { children: [], campaigns: out };
}

/**
 * Dépôt d'une demande par un parent : lien vérifié côté serveur,
 * campagne ouverte + fenêtre, élève éligible, unicité (élève, année
 * cible) garantie par la contrainte + contrôle préalable.
 */
export async function submitParentReenrollment(
  ctx: SchoolCtx,
  input: {
    campaignId: string;
    studentId: string;
    kind: ReenrollmentKind;
    desiredLevelId?: string;
    contactUpdate?: { phone?: string; email?: string; address?: string };
    note?: string;
  },
): Promise<ReenrollResult<{ id: string }>> {
  if (!(await verifyChildAccess(ctx, input.studentId))) return err("FORBIDDEN");
  const now = new Date();
  const campaign = await prisma.reenrollmentCampaign.findFirst({
    where: { id: input.campaignId, schoolId: ctx.schoolId, status: "OPEN" },
  });
  if (!campaign) return err("CAMPAIGN_CLOSED");
  if (campaign.opensAt > now || campaign.closesAt < now) return err("CAMPAIGN_OUT_OF_WINDOW");

  const guardian = await prisma.guardian.findFirst({
    where: { schoolId: ctx.schoolId, userId: ctx.userId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!guardian) return err("FORBIDDEN");

  // Éligibilité : ENROLLED sur l'année source, ou retour après
  // interruption (ACTIVE + historique d'inscription).
  const sourceEnr = await prisma.enrollment.findFirst({
    where: {
      schoolId: ctx.schoolId,
      studentId: input.studentId,
      academicYearId: campaign.sourceYearId,
      status: "ENROLLED",
    },
    select: { id: true, classroom: { select: { levelId: true } } },
  });
  let interrupted = false;
  let sourceEnrollmentId = sourceEnr?.id ?? null;
  if (!sourceEnr) {
    const past = await prisma.enrollment.findFirst({
      where: {
        schoolId: ctx.schoolId,
        studentId: input.studentId,
        status: { in: ["ENROLLED", "COMPLETED", "TRANSFERRED", "WITHDRAWN"] },
      },
      orderBy: { academicYear: { startDate: "desc" } },
      select: { id: true },
    });
    if (!past) return err("NOT_ELIGIBLE");
    interrupted = true;
    sourceEnrollmentId = past.id;
  }
  const levelIds = campaignLevelIds(campaign);
  if (sourceEnr && levelIds.length && !levelIds.includes(sourceEnr.classroom.levelId)) {
    return err("NOT_ELIGIBLE");
  }
  if (input.desiredLevelId) {
    const lvl = await prisma.level.findFirst({
      where: { id: input.desiredLevelId, schoolId: ctx.schoolId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!lvl) return err("NOT_FOUND");
  }

  try {
    const request = await prisma.reenrollmentRequest.create({
      data: {
        schoolId: ctx.schoolId,
        campaignId: campaign.id,
        targetYearId: campaign.targetYearId,
        studentId: input.studentId,
        sourceEnrollmentId,
        guardianId: guardian.id,
        submittedById: ctx.userId,
        kind: input.kind,
        status: "SUBMITTED",
        desiredLevelId: input.desiredLevelId ?? null,
        contactUpdate:
          input.contactUpdate &&
          Object.values(input.contactUpdate).some((v) => v?.trim())
            ? (input.contactUpdate as unknown as Prisma.InputJsonValue)
            : undefined,
        parentNote: input.note?.trim() || null,
        progression: interrupted ? "RETURN" : null,
      },
      select: { id: true },
    });
    await notifyReviewers(ctx, "REENROLLMENT_SUBMITTED", request.id);
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "reenrollment.submit",
      entity: "ReenrollmentRequest",
      entityId: request.id,
      metadata: { campaignId: campaign.id, studentId: input.studentId, kind: input.kind },
    });
    return ok(request);
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return err("ALREADY_SUBMITTED");
    throw e;
  }
}

/** Notification interne aux instructeurs — sans données nominatives. */
async function notifyReviewers(ctx: SchoolCtx, kind: string, requestId: string) {
  const members = await prisma.schoolMembership.findMany({
    where: {
      schoolId: ctx.schoolId,
      status: "ACTIVE",
      role: { rolePermissions: { some: { permission: { key: "reenrollments.review" } } } },
    },
    select: { userId: true },
  });
  if (!members.length) return;
  await notifyUsers({
    schoolId: ctx.schoolId,
    userIds: members.map((m) => m.userId),
    type: "ADMIN_MESSAGE",
    title:
      kind === "REENROLLMENT_SUBMITTED"
        ? "Nouvelle demande de réinscription"
        : "Réponse à une demande de réinscription",
    body: "Une demande de réinscription nécessite une instruction.",
    link: `/app/reinscriptions?req=${requestId}`,
  });
}

/** Réponse du parent à une demande de complément. */
export async function replyParentReenrollment(
  ctx: SchoolCtx,
  requestId: string,
  body: string,
): Promise<ReenrollResult> {
  if (!body.trim()) return err("INVALID_INPUT");
  const req = await prisma.reenrollmentRequest.findFirst({
    where: { id: requestId, schoolId: ctx.schoolId },
    select: { id: true, studentId: true, status: true },
  });
  if (!req) return err("NOT_FOUND");
  if (!(await verifyChildAccess(ctx, req.studentId))) return err("FORBIDDEN");
  if (!["ADDITIONAL_INFO_REQUIRED", "SUBMITTED", "UNDER_REVIEW"].includes(req.status)) {
    return err("INVALID_STATE");
  }
  await prisma.$transaction([
    prisma.reenrollmentMessage.create({
      data: {
        schoolId: ctx.schoolId,
        requestId: req.id,
        kind: "APPLICANT_REPLY",
        body: body.trim(),
        createdById: ctx.userId,
        visibleToParent: true,
      },
    }),
    ...(req.status === "ADDITIONAL_INFO_REQUIRED"
      ? [
          prisma.reenrollmentRequest.update({
            where: { id: req.id },
            data: { status: "UNDER_REVIEW" },
          }),
        ]
      : []),
  ]);
  await notifyReviewers(ctx, "REENROLLMENT_REPLY", req.id);
  return ok(undefined);
}

/** Dépôt d'une pièce par le parent sur sa demande. */
export async function uploadParentReenrollmentDoc(
  ctx: SchoolCtx,
  requestId: string,
  input: {
    buffer: Buffer;
    originalName: string;
    docKey: string;
    ip?: string;
  },
): Promise<ReenrollResult<{ id: string }>> {
  const req = await prisma.reenrollmentRequest.findFirst({
    where: { id: requestId, schoolId: ctx.schoolId },
    include: { campaign: true },
  });
  if (!req) return err("NOT_FOUND");
  if (!(await verifyChildAccess(ctx, req.studentId))) return err("FORBIDDEN");
  if (!["SUBMITTED", "UNDER_REVIEW", "ADDITIONAL_INFO_REQUIRED"].includes(req.status)) {
    return err("INVALID_STATE");
  }
  const required = requiredDocsOfCampaign(req.campaign);
  const doc = required.find((d) => d.key === input.docKey);
  if (!doc) return err("INVALID_INPUT");
  const count = await prisma.document.count({
    where: { ownerType: "REENROLLMENT", ownerId: req.id, status: "ACTIVE" },
  });
  if (count >= MAX_APPLICATION_DOCS) return err("TOO_MANY_DOCS");
  const res = await uploadDocument(
    { userId: ctx.userId, schoolId: ctx.schoolId },
    {
      buffer: input.buffer,
      originalName: input.originalName,
      category: doc.category,
      ownerType: "REENROLLMENT",
      ownerId: req.id,
      label: doc.key,
    },
    input.ip,
  );
  if (!res.ok) return err("INVALID_INPUT");
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "reenrollment.document.upload",
    entity: "Document",
    entityId: res.result.id,
    metadata: { requestId: req.id, docKey: doc.key },
  });
  return ok({ id: res.result.id });
}

/** Pièces déposées par le parent sur sa propre demande. */
export async function listParentReenrollmentDocs(ctx: SchoolCtx, requestId: string) {
  const req = await prisma.reenrollmentRequest.findFirst({
    where: { id: requestId, schoolId: ctx.schoolId },
    select: { studentId: true },
  });
  if (!req) return [];
  if (!(await verifyChildAccess(ctx, req.studentId))) return [];
  return prisma.document.findMany({
    where: { ownerType: "REENROLLMENT", ownerId: requestId, status: "ACTIVE" },
    select: { id: true, label: true, originalName: true, sizeBytes: true, createdAt: true },
  });
}

/**
 * Dépôt administratif d'une demande (élève sans compte parent actif) :
 * même validation métier, `submittedById` = l'agent.
 */
export async function submitAdminReenrollment(
  ctx: SchoolCtx,
  input: {
    campaignId: string;
    studentId: string;
    kind: ReenrollmentKind;
    desiredLevelId?: string;
    note?: string;
  },
): Promise<ReenrollResult<{ id: string }>> {
  if (!(await hasPerm(ctx, "reenrollments.manage"))) return err("FORBIDDEN");
  const campaign = await prisma.reenrollmentCampaign.findFirst({
    where: { id: input.campaignId, schoolId: ctx.schoolId },
  });
  if (!campaign) return err("NOT_FOUND");
  if (!["OPEN", "CLOSED"].includes(campaign.status)) return err("CAMPAIGN_CLOSED");

  const sourceEnr = await prisma.enrollment.findFirst({
    where: {
      schoolId: ctx.schoolId,
      studentId: input.studentId,
      academicYearId: campaign.sourceYearId,
      status: "ENROLLED",
    },
    select: { id: true, classroom: { select: { levelId: true } } },
  });
  let sourceEnrollmentId = sourceEnr?.id ?? null;
  let interrupted = false;
  if (!sourceEnr) {
    const past = await prisma.enrollment.findFirst({
      where: {
        schoolId: ctx.schoolId,
        studentId: input.studentId,
        status: { in: ["ENROLLED", "COMPLETED", "TRANSFERRED", "WITHDRAWN"] },
      },
      orderBy: { academicYear: { startDate: "desc" } },
      select: { id: true },
    });
    if (!past) return err("NOT_ELIGIBLE");
    sourceEnrollmentId = past.id;
    interrupted = true;
  }
  const levelIds = campaignLevelIds(campaign);
  if (sourceEnr && levelIds.length && !levelIds.includes(sourceEnr.classroom.levelId)) {
    return err("NOT_ELIGIBLE");
  }
  const student = await prisma.student.findFirst({
    where: { id: input.studentId, schoolId: ctx.schoolId },
    select: { status: true },
  });
  if (!student) return err("NOT_FOUND");
  if (student.status !== "ACTIVE") return err("STUDENT_INACTIVE");

  try {
    const request = await prisma.reenrollmentRequest.create({
      data: {
        schoolId: ctx.schoolId,
        campaignId: campaign.id,
        targetYearId: campaign.targetYearId,
        studentId: input.studentId,
        sourceEnrollmentId,
        submittedById: ctx.userId,
        kind: input.kind,
        status: "SUBMITTED",
        desiredLevelId: input.desiredLevelId ?? null,
        parentNote: input.note?.trim() || null,
        progression: interrupted ? "RETURN" : null,
      },
      select: { id: true },
    });
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "reenrollment.submit_admin",
      entity: "ReenrollmentRequest",
      entityId: request.id,
      metadata: { campaignId: campaign.id, studentId: input.studentId, kind: input.kind },
    });
    return ok(request);
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return err("ALREADY_SUBMITTED");
    throw e;
  }
}
