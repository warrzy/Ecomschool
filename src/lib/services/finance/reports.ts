import { prisma } from "@/lib/db/prisma";
import {
  buildPaymentsExport,
  PAYMENTS_HEADERS,
  listAllPayments,
} from "@/lib/export/finance";
import { getTreasuryDashboard } from "@/lib/services/finance/treasury";
import type { ExpenseStatus, PaymentMethod } from "@prisma/client";

/**
 * Rapports financiers — lecture seule, mêmes règles que F3-C :
 * - encaissements = Payment VALIDATED (les CANCELLED restent visibles
 *   dans le journal avec leur motif, exclus des totaux) ;
 * - décaissements = Expense paidAt IS NOT NULL (PAID ou CANCELLED) ;
 * - DRAFT jamais décaissé ; aucune annulation n'est un remboursement.
 * Tous les accès sont scopés schoolId ; les volumes sont paginés par
 * curseur et plafonnés à MAX_ROWS — au-delà, `truncated` est signalé
 * et la route refuse (jamais de fichier partiel présenté comme complet).
 */

type SchoolCtx = { userId: string; schoolId: string };

export type ReportType =
  | "payments"
  | "expenses"
  | "treasury"
  | "summary"
  | "expenses-by-category"
  | "payments-by-method";

export const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: "payments", label: "Journal des encaissements" },
  { value: "expenses", label: "Journal des dépenses" },
  { value: "treasury", label: "État de trésorerie" },
  { value: "summary", label: "Synthèse financière" },
  { value: "expenses-by-category", label: "Dépenses par catégorie" },
  { value: "payments-by-method", label: "Encaissements par mode de paiement" },
];

export type ReportFilters = {
  from?: Date;
  to?: Date;
  academicYearId?: string;
  method?: PaymentMethod;
  categoryId?: string;
  /** Journal des dépenses : filtrer par statut. */
  status?: ExpenseStatus;
};

export type ReportSheet = {
  name: string;
  headers: string[];
  rows: (string | number | null)[][];
  /** Ligne de total ajoutée en pied (gras / encadré selon le format). */
  totals?: (string | number | null)[];
};

export type BuiltReport = {
  title: string;
  /** Lignes de contexte affichées/en-tête : période, filtres, notes. */
  meta: string[];
  notes: string[];
  sheets: ReportSheet[];
  rowCount: number;
  truncated: boolean;
  /** KPIs pour l'aperçu écran. */
  kpis: { label: string; value: string }[];
};

const MAX_ROWS = 50_000;
const PAGE = 500;

const fmtXof = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
const iso = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : "";

const METHOD: Record<string, string> = {
  CASH: "Espèces",
  BANK_TRANSFER: "Virement",
  CHECK: "Chèque",
  MOBILE_MONEY: "Mobile Money",
  OTHER: "Autre",
};
const EXPENSE_STATUS: Record<string, string> = {
  DRAFT: "Brouillon",
  PAID: "Payée",
  CANCELLED: "Annulée",
};

const TREASURY_NOTES = [
  "Encaissements = paiements validés uniquement ; les paiements annulés sont des corrections administratives, pas des remboursements matérialisés.",
  "Décaissements = dépenses effectivement payées (paidAt renseigné) — une dépense annulée après paiement reste comptée : l'argent a été décaissé.",
  "Le solde net est un indicateur calculé à partir des opérations retenues — il ne constitue pas un solde bancaire certifié.",
];

export const EXPENSES_HEADERS = [
  "date_depense",
  "date_paiement",
  "categorie",
  "libelle",
  "beneficiaire",
  "montant_xof",
  "mode",
  "statut",
  "motif_annulation",
  "annee_scolaire",
] as const;

/** Journal des dépenses paginé par curseur — toutes statuts, filtre sur expenseAt. */
async function listAllExpenses(
  ctx: SchoolCtx,
  filters: ReportFilters,
  cap = MAX_ROWS,
) {
  const where = {
    schoolId: ctx.schoolId,
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.academicYearId
      ? { academicYearId: filters.academicYearId }
      : {}),
    ...(filters.from || filters.to
      ? {
          expenseAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lt: filters.to } : {}),
          },
        }
      : {}),
  };
  const all: {
    id: string;
    expenseAt: Date;
    paidAt: Date | null;
    amount: number;
    label: string;
    beneficiary: string;
    method: PaymentMethod | null;
    status: ExpenseStatus;
    cancelReason: string | null;
    category: { label: string };
    academicYear: { name: string } | null;
  }[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.expense.findMany({
      where,
      select: {
        id: true,
        expenseAt: true,
        paidAt: true,
        amount: true,
        label: true,
        beneficiary: true,
        method: true,
        status: true,
        cancelReason: true,
        category: { select: { label: true } },
        academicYear: { select: { name: true } },
      },
      orderBy: [{ expenseAt: "desc" }, { id: "asc" }],
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    all.push(...page);
    if (page.length < PAGE || all.length > cap) break;
    cursor = page[page.length - 1].id;
  }
  return { expenses: all.slice(0, cap), truncated: all.length > cap };
}

export async function buildReport(
  ctx: SchoolCtx,
  type: ReportType,
  filters: ReportFilters,
): Promise<BuiltReport> {
  const meta: string[] = [];
  if (filters.from || filters.to) {
    meta.push(
      `Période : ${filters.from ? iso(filters.from) : "…"} → ${filters.to ? iso(new Date(filters.to.getTime() - 1)) : "…"}`,
    );
  }
  if (filters.academicYearId) {
    const y = await prisma.academicYear.findFirst({
      where: { id: filters.academicYearId, schoolId: ctx.schoolId },
      select: { name: true },
    });
    if (y) meta.push(`Année scolaire : ${y.name}`);
  }
  if (filters.method) meta.push(`Mode de paiement : ${METHOD[filters.method]}`);

  switch (type) {
    case "payments": {
      const { payments, truncated } = await buildPaymentsExport(ctx, {
        academicYearId: filters.academicYearId,
        from: filters.from,
        to: filters.to,
        method: filters.method,
      });
      const validatedTotal = payments
        .filter((r) => r[9] === "Validé")
        .reduce((s, r) => s + (r[8] as number), 0);
      const cancelledCount = payments.filter((r) => r[9] === "Annulé").length;
      if (cancelledCount) {
        meta.push(`${cancelledCount} paiement(s) annulé(s) inclus pour traçabilité — exclus des totaux.`);
      }
      return {
        title: "Journal des encaissements",
        meta,
        notes: [
          "Les paiements « Annulé » sont des corrections administratives motivées — ils ne représentent pas nécessairement des remboursements réels.",
        ],
        sheets: [{
          name: "Encaissements",
          headers: [...PAYMENTS_HEADERS],
          rows: payments,
          totals: ["", "", "", "", "", "", "", "Total validé", validatedTotal, "", ""],
        }],
        rowCount: payments.length,
        truncated,
        kpis: [
          { label: "Encaissements validés", value: fmtXof(validatedTotal) },
          { label: "Lignes", value: String(payments.length) },
          { label: "Annulés", value: String(cancelledCount) },
        ],
      };
    }

    case "expenses": {
      const { expenses, truncated } = await listAllExpenses(ctx, filters);
      const rows = expenses.map((e) => [
        iso(e.expenseAt),
        iso(e.paidAt),
        e.category.label,
        e.label,
        e.beneficiary,
        e.amount,
        e.method ? (METHOD[e.method] ?? e.method) : "",
        EXPENSE_STATUS[e.status] ?? e.status,
        e.cancelReason ?? "",
        e.academicYear?.name ?? "",
      ]);
      const disbursed = expenses
        .filter((e) => e.paidAt)
        .reduce((s, e) => s + e.amount, 0);
      return {
        title: "Journal des dépenses",
        meta,
        notes: [
          "« Payée » et « Annulée » avec date de paiement = argent effectivement décaissé ; « Brouillon » n'a jamais quitté la caisse.",
        ],
        sheets: [{
          name: "Dépenses",
          headers: [...EXPENSES_HEADERS],
          rows,
          totals: ["", "", "", "", "Total décaissé", disbursed, "", "", "", ""],
        }],
        rowCount: rows.length,
        truncated,
        kpis: [
          { label: "Décaissé", value: fmtXof(disbursed) },
          { label: "Lignes", value: String(rows.length) },
        ],
      };
    }

    case "treasury": {
      const d = await getTreasuryDashboard(ctx, {
        from: filters.from,
        to: filters.to,
        method: filters.method,
        academicYearId: filters.academicYearId,
      });
      const summaryRows: (string | number | null)[][] = [
        ["Encaissements validés", d.collectedTotal, `${d.collectedCount} opération(s)`],
        ["Dépenses décaissées", d.disbursedTotal, `${d.disbursedCount} opération(s)`],
        ["Solde net des flux", d.net, "indicateur calculé"],
        ["Paiements annulés (exclus)", d.cancelledPaymentsTotal, `${d.cancelledPaymentsCount} opération(s)`],
      ];
      if (d.unlinkedDisbursed > 0) {
        summaryRows.push([
          "Décaissé non rattaché à l'année (exclu des totaux)",
          d.unlinkedDisbursed,
          "",
        ]);
      }
      const monthRows = d.months.map((m) => [
        m.key, m.label, m.collected, m.disbursed, m.collected - m.disbursed,
      ]);
      return {
        title: "État de trésorerie",
        meta,
        notes: TREASURY_NOTES,
        sheets: [
          {
            name: "Synthèse",
            headers: ["indicateur", "montant_xof", "détail"],
            rows: summaryRows,
          },
          {
            name: "Mensuel",
            headers: ["mois", "libellé", "encaissé_xof", "décaissé_xof", "solde_xof"],
            rows: monthRows,
            totals: ["", "Total", d.collectedTotal, d.disbursedTotal, d.net],
          },
        ],
        rowCount: summaryRows.length + monthRows.length,
        truncated: false,
        kpis: [
          { label: "Encaissements validés", value: fmtXof(d.collectedTotal) },
          { label: "Décaissé", value: fmtXof(d.disbursedTotal) },
          { label: "Solde net", value: fmtXof(d.net) },
        ],
      };
    }

    case "summary": {
      const d = await getTreasuryDashboard(ctx, {
        from: filters.from, to: filters.to,
        method: filters.method, academicYearId: filters.academicYearId,
      });
      // Période de comparaison : la fenêtre identique juste avant `from`.
      let prevRows: (string | number | null)[][] = [];
      if (filters.from && filters.to) {
        const len = filters.to.getTime() - filters.from.getTime();
        const prev = await getTreasuryDashboard(ctx, {
          from: new Date(filters.from.getTime() - len),
          to: filters.from,
          method: filters.method,
          academicYearId: filters.academicYearId,
        });
        prevRows = [
          ["Encaissements validés", prev.collectedTotal, d.collectedTotal, d.collectedTotal - prev.collectedTotal],
          ["Dépenses décaissées", prev.disbursedTotal, d.disbursedTotal, d.disbursedTotal - prev.disbursedTotal],
          ["Solde net des flux", prev.net, d.net, d.net - prev.net],
        ];
      }
      const rows: (string | number | null)[][] = [
        ["Encaissements validés", d.collectedTotal, d.collectedCount],
        ["Dépenses décaissées", d.disbursedTotal, d.disbursedCount],
        ["Solde net des flux", d.net, d.collectedCount + d.disbursedCount],
      ];
      return {
        title: "Synthèse financière",
        meta,
        notes: TREASURY_NOTES,
        sheets: [
          {
            name: "Synthèse",
            headers: ["indicateur", "montant_xof", "opérations"],
            rows,
          },
          ...(prevRows.length
            ? [{
                name: "Comparaison",
                headers: ["indicateur", "période_précédente_xof", "période_xof", "écart_xof"],
                rows: prevRows,
              }]
            : []),
        ],
        rowCount: rows.length + prevRows.length,
        truncated: false,
        kpis: [
          { label: "Solde net", value: fmtXof(d.net) },
          { label: "Opérations", value: String(d.collectedCount + d.disbursedCount) },
          { label: "Comparaison", value: prevRows.length ? "période précédente" : "—" },
        ],
      };
    }

    case "expenses-by-category": {
      const groups = await prisma.expense.groupBy({
        by: ["categoryId"],
        where: {
          schoolId: ctx.schoolId,
          paidAt: {
            not: null,
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lt: filters.to } : {}),
          },
          ...(filters.method ? { method: filters.method } : {}),
          ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
          ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
        },
        _sum: { amount: true },
        _count: true,
      });
      const cats = await prisma.expenseCategory.findMany({
        where: { schoolId: ctx.schoolId, id: { in: groups.map((g) => g.categoryId) } },
        select: { id: true, label: true },
      });
      const labelBy = new Map(cats.map((c) => [c.id, c.label]));
      const total = groups.reduce((s, g) => s + (g._sum.amount ?? 0), 0);
      const rows = groups
        .map((g) => {
          const v = g._sum.amount ?? 0;
          return [
            labelBy.get(g.categoryId) ?? g.categoryId,
            g._count,
            v,
            total > 0 ? `${Math.round((v / total) * 100)} %` : "0 %",
          ] as (string | number | null)[];
        })
        .sort((a, b) => (b[2] as number) - (a[2] as number));
      return {
        title: "Dépenses par catégorie",
        meta,
        notes: [
          "Montants effectivement décaissés (paidAt renseigné), dépenses annulées après paiement incluses.",
        ],
        sheets: [{
          name: "Par catégorie",
          headers: ["categorie", "nb_decaissements", "montant_xof", "part"],
          rows,
          totals: ["Total", groups.reduce((s, g) => s + g._count, 0), total, ""],
        }],
        rowCount: rows.length,
        truncated: false,
        kpis: [
          { label: "Décaissé", value: fmtXof(total) },
          { label: "Catégories", value: String(rows.length) },
        ],
      };
    }

    case "payments-by-method": {
      const groups = await prisma.payment.groupBy({
        by: ["method"],
        where: {
          schoolId: ctx.schoolId,
          status: "VALIDATED",
          paidAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lt: filters.to } : {}),
          },
          ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
        },
        _sum: { amount: true },
        _count: true,
      });
      const total = groups.reduce((s, g) => s + (g._sum.amount ?? 0), 0);
      const rows = groups
        .map((g) => {
          const v = g._sum.amount ?? 0;
          return [
            METHOD[g.method] ?? g.method,
            g._count,
            v,
            total > 0 ? `${Math.round((v / total) * 100)} %` : "0 %",
          ] as (string | number | null)[];
        })
        .sort((a, b) => (b[2] as number) - (a[2] as number));
      return {
        title: "Encaissements par mode de paiement",
        meta,
        notes: ["Paiements validés uniquement ; les annulés sont exclus."],
        sheets: [{
          name: "Par mode",
          headers: ["mode", "nb_encaissements", "montant_xof", "part"],
          rows,
          totals: ["Total", groups.reduce((s, g) => s + g._count, 0), total, ""],
        }],
        rowCount: rows.length,
        truncated: false,
        kpis: [
          { label: "Encaissé", value: fmtXof(total) },
          { label: "Modes", value: String(rows.length) },
        ],
      };
    }
  }
}

/** Utilisé par la recette : liste brute des paiements du journal. */
export { listAllPayments };
