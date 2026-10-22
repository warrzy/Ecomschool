import { prisma } from "@/lib/db/prisma";
import type { PaymentMethod } from "@prisma/client";

/**
 * Tableau de bord de trésorerie — lecture seule, aucune écriture.
 *
 * Règles de calcul (F3-C, validées) :
 * - Entrées : Payment `status = VALIDATED`, comptabilisés à `paidAt`
 *   (date réelle de l'encaissement, pas createdAt).
 *   Les paiements CANCELLED sont exclus : une annulation est une
 *   correction administrative motivée, pas un remboursement matérialisé.
 *   Le modèle n'a aucune écriture de remboursement — si l'argent a
 *   été restitué, aucun flux inverse n'existe en base. La limite est
 *   signalée à l'utilisateur via `cancelledPayments`.
 * - Sorties : Expense `paidAt IS NOT NULL` — que le statut soit PAID
 *   ou CANCELLED : un décaissement réel reste une sortie ; annuler une
 *   dépense payée n'efface pas l'argent décaissé (pas de remboursement
 *   implicite). DRAFT n'est jamais comptabilisé.
 * - Période : filtre sur `paidAt` des deux côtés — les dates des
 *   mouvements réels, pas les dates de saisie.
 * - Filtre année scolaire : les paiements ont toujours une année
 *   (champ obligatoire) ; les dépenses peuvent ne pas en avoir. Les
 *   dépenses non rattachées sont alors exclues des totaux MAIS leur
 *   montant décaissé est exposé dans `unlinkedDisbursed` pour que
 *   l'exclusion soit explicite et jamais silencieuse.
 * - Isolation : toutes les requêtes sont scopées `schoolId`.
 * - Aucune double comptabilisation : les allocations ne sont pas
 *   resommées — le flux est le paiement lui-même.
 */

type SchoolCtx = { userId: string; schoolId: string };

export type TreasuryFilters = {
  from?: Date;
  to?: Date;
  method?: PaymentMethod;
  academicYearId?: string;
};

export type TreasuryMonth = {
  key: string; // "2026-10"
  label: string; // "oct. 26"
  collected: number;
  disbursed: number;
};

export type TreasuryOperation = {
  kind: "IN" | "OUT";
  date: Date;
  label: string;
  detail: string | null;
  amount: number;
  method: PaymentMethod | null;
  /** Dépense annulée après paiement : décaissement conservé. */
  cancelledAfterPayment: boolean;
};

export type TreasuryDashboard = {
  range: { from: Date; to: Date };
  collectedTotal: number;
  collectedCount: number;
  cancelledPaymentsCount: number;
  cancelledPaymentsTotal: number;
  disbursedTotal: number;
  disbursedCount: number;
  net: number;
  months: TreasuryMonth[];
  expensesByCategory: { label: string; value: number }[];
  collectedByMethod: { label: string; value: number }[];
  /** Décaissé des dépenses sans rattachement — > 0 seulement si un
   *  filtre année scolaire les a exclues. */
  unlinkedDisbursed: number;
  recent: TreasuryOperation[];
};

const MONTHS_FR_SHORT = [
  "janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
];

export const TREASURY_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Espèces",
  BANK_TRANSFER: "Virement",
  CHECK: "Chèque",
  MOBILE_MONEY: "Mobile Money",
  OTHER: "Autre",
};

export async function getTreasuryDashboard(
  ctx: SchoolCtx,
  filters: TreasuryFilters,
): Promise<TreasuryDashboard> {
  const to = filters.to ?? new Date();
  const from = filters.from ?? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  const rangeWhere = { gte: from, lt: to };

  const [payments, cancelledAgg, expenses, unlinkedAgg] = await Promise.all([
    prisma.payment.findMany({
      where: {
        schoolId: ctx.schoolId,
        status: "VALIDATED",
        paidAt: rangeWhere,
        ...(filters.method ? { method: filters.method } : {}),
        ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
      },
      select: {
        id: true,
        amount: true,
        paidAt: true,
        method: true,
        receiptNumber: true,
        student: { select: { firstName: true, lastName: true } },
      },
      orderBy: { paidAt: "desc" },
      take: 20000,
    }),
    prisma.payment.groupBy({
      by: ["status"],
      where: {
        schoolId: ctx.schoolId,
        status: "CANCELLED",
        paidAt: rangeWhere,
        ...(filters.method ? { method: filters.method } : {}),
        ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
      },
      _count: true,
      _sum: { amount: true },
    }),
    prisma.expense.findMany({
      where: {
        schoolId: ctx.schoolId,
        paidAt: { not: null, ...rangeWhere },
        ...(filters.method ? { method: filters.method } : {}),
        ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
      },
      select: {
        id: true,
        label: true,
        amount: true,
        paidAt: true,
        method: true,
        status: true,
        beneficiary: true,
        category: { select: { label: true } },
      },
      orderBy: { paidAt: "desc" },
      take: 20000,
    }),
    // Exclusion explicite : dépenses décaissées sans rattachement,
    // comptées à part quand un filtre année scolaire est actif.
    filters.academicYearId
      ? prisma.expense.aggregate({
          where: {
            schoolId: ctx.schoolId,
            academicYearId: null,
            paidAt: { not: null, ...rangeWhere },
            ...(filters.method ? { method: filters.method } : {}),
          },
          _sum: { amount: true },
          _count: true,
        })
      : Promise.resolve(null),
  ]);

  const collectedTotal = payments.reduce((s, p) => s + p.amount, 0);
  const disbursedTotal = expenses.reduce((s, e) => s + e.amount, 0);

  // Buckets mensuels bornés par la période affichée.
  const monthMap = new Map<string, TreasuryMonth>();
  {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
    // `to` est une borne exclusive : le dernier mois est celui de to−1ms.
    const lastInclusive = new Date(to.getTime() - 1);
    const last = new Date(Date.UTC(lastInclusive.getUTCFullYear(), lastInclusive.getUTCMonth(), 1));
    while (d <= last && monthMap.size < 36) {
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      monthMap.set(key, {
        key,
        label: `${MONTHS_FR_SHORT[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`,
        collected: 0,
        disbursed: 0,
      });
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
  }
  const monthKeyOf = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  for (const p of payments) {
    const b = monthMap.get(monthKeyOf(p.paidAt));
    if (b) b.collected += p.amount;
  }
  for (const e of expenses) {
    const b = monthMap.get(monthKeyOf(e.paidAt!));
    if (b) b.disbursed += e.amount;
  }

  const catMap = new Map<string, number>();
  for (const e of expenses) {
    catMap.set(e.category.label, (catMap.get(e.category.label) ?? 0) + e.amount);
  }
  const expensesByCategory = [...catMap.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const methodMap = new Map<PaymentMethod, number>();
  for (const p of payments) {
    methodMap.set(p.method, (methodMap.get(p.method) ?? 0) + p.amount);
  }
  const collectedByMethod = [...methodMap.entries()]
    .map(([m, value]) => ({ label: TREASURY_METHOD_LABELS[m], value }))
    .sort((a, b) => b.value - a.value);

  const recent: TreasuryOperation[] = [
    ...payments.map((p): TreasuryOperation => ({
      kind: "IN",
      date: p.paidAt,
      label: `Encaissement ${p.receiptNumber ?? ""}`.trim(),
      detail: `${p.student.firstName} ${p.student.lastName}`.trim() || null,
      amount: p.amount,
      method: p.method,
      cancelledAfterPayment: false,
    })),
    ...expenses.map((e): TreasuryOperation => ({
      kind: "OUT",
      date: e.paidAt!,
      label: e.label,
      detail: e.beneficiary,
      amount: e.amount,
      method: e.method,
      cancelledAfterPayment: e.status === "CANCELLED",
    })),
  ]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 10);

  const cancelled = cancelledAgg[0];
  return {
    range: { from, to },
    collectedTotal,
    collectedCount: payments.length,
    cancelledPaymentsCount: cancelled?._count ?? 0,
    cancelledPaymentsTotal: cancelled?._sum.amount ?? 0,
    disbursedTotal,
    disbursedCount: expenses.length,
    net: collectedTotal - disbursedTotal,
    months: [...monthMap.values()],
    expensesByCategory,
    collectedByMethod,
    unlinkedDisbursed: unlinkedAgg?._sum.amount ?? 0,
    recent,
  };
}
