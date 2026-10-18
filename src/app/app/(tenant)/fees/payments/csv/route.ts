import { NextRequest, NextResponse } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  ALLOCATIONS_HEADERS,
  buildAllocationRows,
  listAllPayments,
} from "@/lib/export/finance";
import { exportFile } from "@/lib/export/respond";
import type { PaymentMethod, PaymentStatus } from "@prisma/client";

/**
 * GET /app/fees/payments/csv?year&from&to&method&classroom&student
 *   &status=VALIDATED|CANCELLED&view=allocations
 *
 * URL historique conservée — CONTRAT D'ORIGINE RESTAURÉ :
 *   en-têtes « date;reçu;matricule;élève;mode;référence;montant;statut;
 *   motif_annulation », une seule colonne élève « Prénom Nom », valeurs
 *   brutes (enums method/status non traduits), cellules systématiquement
 *   quotées, BOM UTF-8, séparateur « ; », CRLF, nom de fichier fixe.
 * Durcissements ajoutés sans changer le contrat :
 *   - neutralisation des formules (préfixe « ' » avant = + - @) ;
 *   - pagination curseur : plus de plafond silencieux à 500 lignes ;
 *   - dépassement du plafond global → erreur 413 explicite ;
 *   - view=allocations → export des ventilations (nouveau, en-têtes socle).
 */
const FORMULA_PREFIX = /^[\s]*[=+\-@]/;
const esc = (v: string | null | undefined) => {
  let s = String(v ?? "");
  if (FORMULA_PREFIX.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export async function GET(req: NextRequest) {
  const tenant = await requireSchoolPermission("finance.reports.read");
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const url = new URL(req.url);
  const p = (k: string) => url.searchParams.get(k) || undefined;

  const date = (k: string) => {
    const v = p(k);
    return v && !Number.isNaN(new Date(v).getTime())
      ? new Date(v)
      : undefined;
  };
  const method = ["CASH", "BANK_TRANSFER", "CHECK", "MOBILE_MONEY", "OTHER"]
    .includes(p("method") ?? "")
    ? (p("method") as PaymentMethod)
    : undefined;
  const status = ["VALIDATED", "CANCELLED"].includes(p("status") ?? "")
    ? (p("status") as PaymentStatus)
    : undefined;

  const { payments, truncated } = await listAllPayments(ctx, {
    academicYearId: p("year"),
    classroomId: p("classroom"),
    studentId: p("student"),
    from: date("from"),
    to: date("to"),
    method,
    status,
    receivedById: p("cashier"),
    query: p("q"),
  });
  if (truncated) {
    return new NextResponse(
      "Export trop volumineux — réduisez les filtres ou la période, puis réessayez.",
      { status: 413 },
    );
  }

  if (p("view") === "allocations") {
    const allocations = await buildAllocationRows(ctx, payments);
    return exportFile({
      format: "csv",
      filename: "ventilations-paiements",
      sheets: [
        { name: "Ventilations", headers: ALLOCATIONS_HEADERS, rows: allocations },
      ],
    });
  }

  // Contrat historique : une ligne par paiement, champs quotés, enums bruts.
  const lines = payments.map((pay) =>
    [
      pay.paidAt.toISOString().slice(0, 10),
      pay.receiptNumber ?? "",
      pay.student.matricule,
      `${pay.student.firstName} ${pay.student.lastName}`,
      pay.method,
      pay.reference ?? "",
      String(pay.amount),
      pay.status,
      pay.cancelReason ?? "",
    ]
      .map(esc)
      .join(";"),
  );
  const csv =
    [
      "date;reçu;matricule;élève;mode;référence;montant;statut;motif_annulation",
      ...lines,
    ].join("\r\n");

  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="journal-paiements.csv"',
    },
  });
}
