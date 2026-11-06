/**
 * G3 manuel — encaissement Mobile Money au guichet (vérification
 * manuelle). Un agent saisit la référence opérateur observée sur le
 * compte marchand de l'établissement ; un second agent habilité
 * (`finance.payments.validate`) confirme explicitement — seule la
 * validation comptabilise (reçu + allocations + trésorerie via le
 * moteur partagé `postPaymentTx`).
 *
 * Garanties :
 * - `PENDING` n'a aucun effet financier : tous les agrégats filtrent
 *   `VALIDATED`.
 * - Anti-doublon : index unique partiel (schoolId, opérateur,
 *   référence). Une référence déjà comptabilisée reste occupée même
 *   après annulation (`receiptNumber` non nul) — impossible de
 *   comptabiliser deux fois la même transaction opérateur. Seul un
 *   rejet avant validation libère la référence pour ressaisie.
 * - Séparation des rôles : l'agent qui a saisi ne peut pas valider
 *   (SELF_APPROVAL), sauf école mono-validateur — exception consignée
 *   dans l'audit comme pour les remboursements.
 * - `MOBILE_MONEY_MANUAL` reste structurellement distinct de
 *   `MOBILE_MONEY` (prestataire vérifié) — jamais de confusion.
 * - Aucune prétention de vérification auprès d'Orange Money ou Moov :
 *   la confirmation est un acte humain explicite, auditée.
 * - Aucun PIN, OTP ou secret de paiement n'est demandé ni stocké.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import {
  userHasSchoolPermission,
} from "@/lib/permissions/rbac";
import {
  postPaymentTx,
  type PaymentsError,
} from "./payments";
import type { MobileMoneyOperator } from "@prisma/client";

type SchoolCtx = { userId: string; schoolId: string };

export type ManualMomoError =
  | PaymentsError
  | "DUPLICATE_REFERENCE"
  | "NOT_PENDING"
  | "SELF_APPROVAL"
  | "HUMAN_CHECK_REQUIRED";

export type ManualMomoResult<T> =
  | { ok: true; result: T }
  | { ok: false; error: ManualMomoError };

export const OPERATOR_LABELS: Record<MobileMoneyOperator, string> = {
  ORANGE_MONEY: "Orange Money",
  MOOV_MONEY: "Moov Money",
};

function dayBounds(d: Date) {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * Saisie d'un encaissement Mobile Money reçu sur le compte marchand de
 * l'établissement. Crée un `Payment` `PENDING` — aucun reçu, aucune
 * allocation, aucun impact sur les soldes tant qu'un agent habilité
 * n'a pas confirmé la transaction sur le compte marchand.
 * La référence externe de transaction est obligatoire.
 */
export async function recordManualMobileMoney(
  ctx: SchoolCtx,
  input: {
    studentId: string;
    academicYearId: string;
    amount: number;
    operator: MobileMoneyOperator;
    reference: string;
    paidAt?: Date;
    merchantAccount?: string;
    observation?: string;
    idempotencyKey?: string;
  },
): Promise<ManualMomoResult<{ id: string }>> {
  if (
    !(await userHasSchoolPermission({
      userId: ctx.userId,
      schoolId: ctx.schoolId,
      permissionKey: "finance.payments.create",
    }))
  ) {
    return { ok: false, error: "FORBIDDEN" };
  }
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  const reference = input.reference.trim();
  if (!reference) return { ok: false, error: "INVALID_INPUT" };
  if (!["ORANGE_MONEY", "MOOV_MONEY"].includes(input.operator)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const paidAt = input.paidAt ?? new Date();
  const { start, end } = dayBounds(paidAt);
  const [student, year, closure, dupe] = await Promise.all([
    prisma.student.findFirst({
      where: { id: input.studentId, schoolId: ctx.schoolId, status: "ACTIVE" },
      select: { id: true },
    }),
    prisma.academicYear.findFirst({
      where: { id: input.academicYearId, schoolId: ctx.schoolId },
      select: { id: true },
    }),
    prisma.cashClosure.findFirst({
      where: { schoolId: ctx.schoolId, date: { gte: start, lt: end } },
      select: { id: true },
    }),
    prisma.payment.findFirst({
      where: {
        schoolId: ctx.schoolId,
        mobileMoneyOperator: input.operator,
        reference,
        OR: [
          { status: { not: "CANCELLED" } },
          { receiptNumber: { not: null } },
        ],
      },
      select: { id: true },
    }),
  ]);
  if (!student || !year) return { ok: false, error: "NOT_FOUND" };
  if (closure) return { ok: false, error: "CLOSED_DAY" };
  if (dupe) return { ok: false, error: "DUPLICATE_REFERENCE" };

  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  if (input.idempotencyKey) {
    const existing = await prisma.payment.findFirst({
      where: { schoolId: ctx.schoolId, idempotencyKey },
      select: { id: true },
    });
    if (existing) return { ok: true, result: { id: existing.id } };
  }

  try {
    const p = await prisma.payment.create({
      data: {
        schoolId: ctx.schoolId,
        studentId: input.studentId,
        academicYearId: input.academicYearId,
        amount: input.amount,
        paidAt,
        method: "MOBILE_MONEY_MANUAL",
        status: "PENDING",
        reference,
        observation: input.observation?.trim() || null,
        merchantAccount: input.merchantAccount?.trim() || null,
        mobileMoneyOperator: input.operator,
        receivedById: ctx.userId,
        idempotencyKey,
      },
      select: { id: true },
    });
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "finance.payment_manual.record",
      entity: "Payment",
      entityId: p.id,
      metadata: {
        amount: input.amount,
        operator: input.operator,
        reference,
        paidAt: paidAt.toISOString(),
      },
    });
    return { ok: true, result: { id: p.id } };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "P2002") return { ok: false, error: "DUPLICATE_REFERENCE" };
    return { ok: false, error: "CREATE_FAILED" };
  }
}

/**
 * Validation explicite par un agent habilité
 * (`finance.payments.validate`) : la transaction a été vérifiée à la
 * main sur le compte marchand — comptabilisation via le moteur
 * partagé (reçu + allocations + surpaiement + snapshot). Atomique :
 * updateMany conditionnel sur `PENDING` — une double validation est
 * impossible.
 *
 * `humanCheckConfirmed` matérialise l'acte humain de vérification :
 * l'appelant (action serveur) ne le transmet à `true` que si l'agent
 * a confirmé explicitement dans le formulaire.
 *
 * Séparation des rôles : l'agent qui a saisi l'encaissement ne peut
 * pas le valider (SELF_APPROVAL). Exception documentée : école
 * mono-validateur — si le saisisseur est le SEUL membre actif
 * détenteur de `finance.payments.validate`, l'auto-validation est
 * tolérée mais consignée dans l'audit (`selfApproval: true,
 * exception: "MONO_VALIDATOR"`).
 */
export async function validateManualPayment(
  ctx: SchoolCtx,
  paymentId: string,
  opts: { humanCheckConfirmed: boolean },
): Promise<ManualMomoResult<{ id: string; receiptNumber: string }>> {
  if (
    !(await userHasSchoolPermission({
      userId: ctx.userId,
      schoolId: ctx.schoolId,
      permissionKey: "finance.payments.validate",
    }))
  ) {
    return { ok: false, error: "FORBIDDEN" };
  }
  if (!opts.humanCheckConfirmed) {
    return { ok: false, error: "HUMAN_CHECK_REQUIRED" };
  }

  const pending = await prisma.payment.findFirst({
    where: {
      id: paymentId,
      schoolId: ctx.schoolId,
      method: "MOBILE_MONEY_MANUAL",
    },
    select: {
      id: true,
      studentId: true,
      academicYearId: true,
      amount: true,
      paidAt: true,
      status: true,
      mobileMoneyOperator: true,
      reference: true,
      merchantAccount: true,
      observation: true,
      receivedById: true,
    },
  });
  if (!pending) return { ok: false, error: "NOT_FOUND" };
  if (pending.status !== "PENDING") return { ok: false, error: "NOT_PENDING" };

  let selfApproval = false;
  if (pending.receivedById === ctx.userId) {
    const validators = await prisma.schoolMembership.count({
      where: {
        schoolId: ctx.schoolId,
        status: "ACTIVE",
        user: { status: "ACTIVE" },
        role: {
          scope: "SCHOOL",
          OR: [{ schoolId: null }, { schoolId: ctx.schoolId }],
          rolePermissions: {
            some: { permission: { key: "finance.payments.validate" } },
          },
        },
      },
    });
    if (validators > 1) return { ok: false, error: "SELF_APPROVAL" };
    selfApproval = true;
  }

  const { start, end } = dayBounds(pending.paidAt);
  const [closure, student, year, school, agent] = await Promise.all([
    prisma.cashClosure.findFirst({
      where: { schoolId: ctx.schoolId, date: { gte: start, lt: end } },
      select: { id: true },
    }),
    prisma.student.findFirst({
      where: { id: pending.studentId, schoolId: ctx.schoolId },
      select: {
        matricule: true,
        firstName: true,
        lastName: true,
        enrollments: {
          where: { academicYearId: pending.academicYearId, status: "ENROLLED" },
          select: { classroom: { select: { name: true } } },
          take: 1,
        },
      },
    }),
    prisma.academicYear.findFirst({
      where: { id: pending.academicYearId, schoolId: ctx.schoolId },
      select: { name: true },
    }),
    prisma.school.findUnique({
      where: { id: ctx.schoolId },
      select: { name: true, logoUrl: true, address: true, city: true, phone: true, currency: true },
    }),
    prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { firstName: true, lastName: true, email: true },
    }),
  ]);
  if (closure) return { ok: false, error: "CLOSED_DAY" };
  if (!student || !year) return { ok: false, error: "NOT_FOUND" };

  const runTransaction = () =>
    prisma.$transaction(
      (tx) =>
        postPaymentTx(tx, {
          ctx,
          studentId: pending.studentId,
          academicYearId: pending.academicYearId,
          amount: pending.amount,
          paidAt: pending.paidAt,
          method: "MOBILE_MONEY_MANUAL",
          reference: pending.reference,
          observation: pending.observation,
          student,
          yearName: year.name,
          school: school ?? null,
          agent: agent ?? null,
          snapshotExtras: {
            operator: pending.mobileMoneyOperator
              ? OPERATOR_LABELS[pending.mobileMoneyOperator]
              : null,
            merchantAccount: pending.merchantAccount,
            verification: "MANUAL",
          },
          paymentId: pending.id,
          verifiedById: ctx.userId,
        }),
      { isolationLevel: "Serializable" },
    );

  try {
    let posted: { id: string; receiptNumber: string } | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 4 && !posted; attempt++) {
      try {
        posted = await runTransaction();
      } catch (e) {
        lastError = e;
        const code = (e as { code?: string })?.code;
        if (code === "P2002") continue; // collision de numéro de reçu → retry
        if (code !== "P2034") throw e;
      }
    }
    if (!posted) throw lastError;
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "finance.payment_manual.validate",
      entity: "Payment",
      entityId: posted.id,
      metadata: {
        amount: pending.amount,
        operator: pending.mobileMoneyOperator,
        reference: pending.reference,
        receiptNumber: posted.receiptNumber,
        humanCheckConfirmed: true,
        ...(selfApproval
          ? { selfApproval: true, exception: "MONO_VALIDATOR" }
          : {}),
      },
    });
    return { ok: true, result: posted };
  } catch (e) {
    const msg = (e as Error)?.message;
    if (msg === "OVERPAYMENT") return { ok: false, error: "OVERPAYMENT" };
    if (msg === "NOT_PENDING") return { ok: false, error: "NOT_PENDING" };
    return { ok: false, error: "CREATE_FAILED" };
  }
}

/**
 * Rejet d'un encaissement manuel en attente (transaction non retrouvée
 * sur le compte marchand, saisie erronée…). PENDING → CANCELLED avec
 * motif obligatoire — trace complète, jamais de suppression.
 */
export async function rejectManualPayment(
  ctx: SchoolCtx,
  input: { paymentId: string; reason: string },
): Promise<ManualMomoResult<undefined>> {
  if (
    !(await userHasSchoolPermission({
      userId: ctx.userId,
      schoolId: ctx.schoolId,
      permissionKey: "finance.payments.validate",
    }))
  ) {
    return { ok: false, error: "FORBIDDEN" };
  }
  if (!input.reason.trim()) return { ok: false, error: "INVALID_INPUT" };

  const updated = await prisma.payment.updateMany({
    where: {
      id: input.paymentId,
      schoolId: ctx.schoolId,
      method: "MOBILE_MONEY_MANUAL",
      status: "PENDING",
    },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledById: ctx.userId,
      cancelReason: `Rejet vérification : ${input.reason.trim()}`,
    },
  });
  if (updated.count === 0) return { ok: false, error: "NOT_PENDING" };
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "finance.payment_manual.reject",
    entity: "Payment",
    entityId: input.paymentId,
    metadata: { reason: input.reason.trim() },
  });
  return { ok: true, result: undefined };
}

/** Encaissements manuels en attente de vérification (journal). */
export async function listPendingManualPayments(ctx: SchoolCtx) {
  return prisma.payment.findMany({
    where: { schoolId: ctx.schoolId, method: "MOBILE_MONEY_MANUAL", status: "PENDING" },
    include: {
      student: { select: { matricule: true, firstName: true, lastName: true } },
      academicYear: { select: { name: true } },
    },
    orderBy: { paidAt: "asc" },
    take: 200,
  });
}
