import { prisma } from "@/lib/db/prisma";
import {
  installmentStatus,
  listAccounts,
} from "@/lib/services/finance/accounts";
import {
  listPayments,
  listUnpaid,
} from "@/lib/services/finance/payments";
import type { PaymentMethod, PaymentStatus } from "@prisma/client";

/**
 * Exports financiers — lecture seule, AUCUN recalcul parallèle :
 * - comptes élèves  → listAccounts (charges/remises/dû/payé/solde)
 * - échéances       → même vue que getStudentAccount (allocations
 *   VALIDATED + installmentStatus), sans consommation de remises
 * - impayés         → listUnpaid (reste après FIFO des remises,
 *   jours de retard, exigible)
 * - paiements       → listPayments paginé par curseur (le service
 *   plafonne à 500 par appel : l'export boucle jusqu'à épuisement)
 * Montants en entiers XOF — les cellules XLSX reçoivent des nombres.
 */

type SchoolCtx = { userId: string; schoolId: string };

const MAX_ROWS = 50_000;
const PAGE = 500;

export const ACCOUNTS_HEADERS = [
  "matricule",
  "nom",
  "prenom",
  "classe",
  "charges_xof",
  "remises_xof",
  "du_xof",
  "paye_xof",
  "solde_xof",
] as const;

export const INSTALLMENTS_HEADERS = [
  "matricule",
  "nom",
  "prenom",
  "classe",
  "categorie",
  "echeance",
  "date_echeance",
  "montant_xof",
  "paye_xof",
  "reste_xof",
  "statut",
] as const;

export const UNPAID_HEADERS = [
  "matricule",
  "nom",
  "prenom",
  "classe",
  "niveau",
  "categorie",
  "echeance",
  "date_echeance",
  "montant_xof",
  "paye_xof",
  "reste_xof",
  "retard_jours",
  "statut",
] as const;

export const PAYMENTS_HEADERS = [
  "date",
  "recu",
  "matricule",
  "nom",
  "prenom",
  "mode",
  "reference",
  "montant_xof",
  "statut",
  "motif_annulation",
] as const;

export const ALLOCATIONS_HEADERS = [
  "date_paiement",
  "recu",
  "matricule",
  "nom",
  "prenom",
  "categorie",
  "echeance",
  "date_echeance",
  "montant_alloue_xof",
  "statut_paiement",
] as const;

const INSTALLMENT_STATUS: Record<string, string> = {
  UPCOMING: "À venir",
  PARTIAL: "Partielle",
  PAID: "Payée",
  LATE: "En retard",
  CANCELLED: "Annulée",
};
const PAYMENT_STATUS: Record<string, string> = {
  VALIDATED: "Validé",
  CANCELLED: "Annulé",
};
const METHOD: Record<string, string> = {
  CASH: "Espèces",
  BANK_TRANSFER: "Virement",
  CHECK: "Chèque",
  MOBILE_MONEY: "Mobile Money",
  OTHER: "Autre",
};

const iso = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : "";

type Rows = (string | number | null)[][];
export type FinanceExport = { rows: Rows; truncated: boolean };

/** Situation financière par élève — mêmes montants que listAccounts. */
export async function buildAccountsExport(
  ctx: SchoolCtx,
  filters: {
    academicYearId: string;
    classroomId?: string;
    studentId?: string;
  },
): Promise<FinanceExport> {
  const accounts = await listAccounts(ctx, {
    academicYearId: filters.academicYearId,
    classroomId: filters.classroomId,
  });
  const scoped = filters.studentId
    ? accounts.filter((a) => a.student.id === filters.studentId)
    : accounts;
  return {
    truncated: scoped.length > MAX_ROWS,
    rows: scoped.slice(0, MAX_ROWS).map((a) => [
      a.student.matricule,
      a.student.lastName,
      a.student.firstName,
      a.classroom.name,
      a.charges,
      a.discounts,
      a.due,
      a.paid,
      a.balance,
    ]),
  };
}

/**
 * Toutes les échéances (payées ou non) — vue getStudentAccount :
 * reste = montant − allocations VALIDATED (remises NON imputées ici,
 * conformément à l'écran compte élève).
 */
export async function buildInstallmentsExport(
  ctx: SchoolCtx,
  filters: {
    academicYearId: string;
    classroomId?: string;
    studentId?: string;
    status?: string;
    from?: Date;
    to?: Date;
  },
): Promise<FinanceExport> {
  const installments = await prisma.feeInstallment.findMany({
    where: {
      schoolId: ctx.schoolId,
      academicYearId: filters.academicYearId,
      status: "ACTIVE",
      charge: { status: "ACTIVE" },
      ...(filters.studentId ? { studentId: filters.studentId } : {}),
      ...(filters.from || filters.to
        ? {
            dueDate: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lt: filters.to } : {}),
            },
          }
        : {}),
      ...(filters.classroomId
        ? {
            student: {
              enrollments: {
                some: {
                  academicYearId: filters.academicYearId,
                  classroomId: filters.classroomId,
                  status: "ENROLLED",
                },
              },
            },
          }
        : {}),
    },
    include: {
      student: {
        select: {
          matricule: true,
          firstName: true,
          lastName: true,
          enrollments: {
            where: {
              academicYearId: filters.academicYearId,
              status: "ENROLLED",
            },
            select: { classroom: { select: { name: true } } },
            take: 1,
          },
        },
      },
      charge: { select: { category: { select: { label: true } } } },
      allocations: {
        where: { payment: { status: "VALIDATED" } },
        select: { amount: true },
      },
    },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    take: MAX_ROWS + 1,
  });

  const today = new Date();
  const views = installments.map((i) => {
    const paid = i.allocations.reduce((s, a) => s + a.amount, 0);
    const st = installmentStatus({
      amount: i.amount,
      paid,
      dueDate: i.dueDate,
      cancelled: false,
      today,
    });
    return { i, paid, remaining: Math.max(0, i.amount - paid), st };
  });
  const filtered = filters.status
    ? views.filter((v) => v.st === filters.status)
    : views;

  return {
    truncated: filtered.length > MAX_ROWS,
    rows: filtered.slice(0, MAX_ROWS).map(({ i, paid, remaining, st }) => [
      i.student.matricule,
      i.student.lastName,
      i.student.firstName,
      i.student.enrollments[0]?.classroom.name ?? "",
      i.charge.category.label,
      i.label ?? "",
      iso(i.dueDate),
      i.amount,
      paid,
      remaining,
      INSTALLMENT_STATUS[st] ?? st,
    ]),
  };
}

/** Impayés — listUnpaid (reste après FIFO des remises + retard). */
export async function buildUnpaidExport(
  ctx: SchoolCtx,
  filters: {
    academicYearId: string;
    classroomId?: string;
    studentId?: string;
    lateOnly?: boolean;
  },
): Promise<FinanceExport> {
  const items = await listUnpaid(ctx, {
    academicYearId: filters.academicYearId,
    classroomId: filters.classroomId,
  });
  const scoped = items
    .filter((i) => !filters.studentId || i.student.id === filters.studentId)
    .filter((i) => !filters.lateOnly || i.late);
  return {
    truncated: scoped.length > MAX_ROWS,
    rows: scoped.slice(0, MAX_ROWS).map((i) => [
      i.student.matricule,
      i.student.lastName,
      i.student.firstName,
      i.classroomName ?? "",
      i.levelName ?? "",
      i.category,
      i.label ?? "",
      iso(i.dueDate),
      i.amount,
      i.paid,
      i.remaining,
      i.daysLate,
      i.late ? "En retard" : i.exigible ? "Exigible" : "À venir",
    ]),
  };
}

export interface PaymentsExportFilters {
  academicYearId?: string;
  classroomId?: string;
  studentId?: string;
  from?: Date;
  to?: Date;
  method?: PaymentMethod;
  status?: PaymentStatus;
}

/** Journal des paiements — pagination curseur au-delà du cap service. */
export async function buildPaymentsExport(
  ctx: SchoolCtx,
  filters: PaymentsExportFilters,
): Promise<{ payments: Rows; allocations: Rows; truncated: boolean }> {
  const all: Awaited<ReturnType<typeof listPayments>> = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await listPayments(
      ctx,
      { ...filters, includeCancelled: true },
      { take: PAGE, cursor },
    );
    all.push(...page);
    if (page.length < PAGE || all.length >= MAX_ROWS + 1) break;
    cursor = page[page.length - 1].id;
  }
  const truncated = all.length > MAX_ROWS;
  const payments = all.slice(0, MAX_ROWS);

  const paymentsRows = payments.map((p) => [
    iso(p.paidAt),
    p.receiptNumber ?? "",
    p.student.matricule,
    p.student.lastName,
    p.student.firstName,
    METHOD[p.method] ?? p.method,
    p.reference ?? "",
    p.amount,
    PAYMENT_STATUS[p.status] ?? p.status,
    p.cancelReason ?? "",
  ]);

  const allocationRows: Rows = payments.length
    ? (
        await prisma.paymentAllocation.findMany({
          where: {
            payment: {
              schoolId: ctx.schoolId,
              id: { in: payments.map((p) => p.id) },
            },
          },
          include: {
            payment: {
              select: {
                paidAt: true,
                receiptNumber: true,
                status: true,
                student: {
                  select: {
                    matricule: true,
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
            installment: {
              select: {
                label: true,
                dueDate: true,
                charge: {
                  select: { category: { select: { label: true } } },
                },
              },
            },
          },
          orderBy: { id: "asc" },
        })
      ).map((a) => [
        iso(a.payment.paidAt),
        a.payment.receiptNumber ?? "",
        a.payment.student.matricule,
        a.payment.student.lastName,
        a.payment.student.firstName,
        a.installment.charge.category.label,
        a.installment.label ?? "",
        iso(a.installment.dueDate),
        a.amount,
        PAYMENT_STATUS[a.payment.status] ?? a.payment.status,
      ])
    : [];

  return { payments: paymentsRows, allocations: allocationRows, truncated };
}
