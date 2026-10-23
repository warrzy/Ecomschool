import { NextRequest, NextResponse } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { toCsv } from "@/lib/export/csv";
import {
  listDiscrepancies,
  listReconciliations,
  listSettlements,
} from "@/lib/services/payments/reconciliation";
import { listRefunds } from "@/lib/services/payments/refunds";

/**
 * GET /app/paiements-mobile/export?type=reconciliations|settlements|refunds|discrepancies
 *
 * Exports CSV du module de rapprochement G3-D — lecture
 * `mobilepayments.reconcile` requise, isolée par école. BOM UTF-8,
 * séparateur « ; », neutralisation des formules (helper commun).
 */
const dt = (d: Date | null | undefined) => (d ? d.toISOString() : "");

export async function GET(req: NextRequest) {
  const tenant = await requireSchoolPermission("mobilepayments.reconcile");
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const type = new URL(req.url).searchParams.get("type") ?? "reconciliations";

  let headers: string[];
  let rows: (string | number | null)[][];
  let name: string;

  if (type === "reconciliations") {
    const list = await listReconciliations(ctx, { limit: 500 });
    headers = [
      "eleve", "brut", "montant_confirme", "commission", "supportee_par",
      "net_attendu", "recu", "reversement", "statut", "notes", "cree_le",
    ];
    rows = list.map((r) => [
      `${r.intent.student.matricule} ${r.intent.student.lastName} ${r.intent.student.firstName}`,
      r.grossAmount,
      r.confirmedAmount,
      r.feeAmount,
      r.feeBearer,
      r.netExpected,
      r.payment?.receiptNumber ?? null,
      r.settlement?.reference ?? null,
      r.status,
      r.notes,
      dt(r.createdAt),
    ]);
    name = "rapprochements";
  } else if (type === "settlements") {
    const list = await listSettlements(ctx, { limit: 300 });
    headers = [
      "reference", "prestataire", "periode_debut", "periode_fin", "brut",
      "commissions", "net_attendu", "net_declare", "recu_le", "statut",
      "operations", "declaration",
    ];
    rows = list.map((s) => [
      s.reference,
      s.provider.label,
      dt(s.periodStart),
      dt(s.periodEnd),
      s.grossTotal,
      s.feeTotal,
      s.netExpected,
      s.netDeclared,
      dt(s.receivedAt),
      s.status,
      s._count.reconciliations,
      s.declared ? "manuelle" : "prestataire",
    ]);
    name = "reversements";
  } else if (type === "refunds") {
    const list = await listRefunds(ctx, { limit: 300 });
    headers = [
      "recu", "montant", "motif", "statut", "reference", "demande_par",
      "approuve_par", "cree_le", "confirme_le",
    ];
    rows = list.map((r) => [
      r.payment?.receiptNumber ?? null,
      r.amount,
      r.reason,
      r.status,
      r.providerRef,
      r.requestedBy ? `${r.requestedBy.firstName ?? ""} ${r.requestedBy.lastName ?? ""}`.trim() || r.requestedBy.email : null,
      r.approvedBy ? `${r.approvedBy.firstName ?? ""} ${r.approvedBy.lastName ?? ""}`.trim() || r.approvedBy.email : null,
      dt(r.createdAt),
      dt(r.confirmedAt),
    ]);
    name = "remboursements";
  } else if (type === "discrepancies") {
    const list = await listDiscrepancies(ctx, { limit: 500 });
    headers = [
      "type", "description", "attendu", "constate", "statut",
      "resolu_par", "resolu_le", "cree_le",
    ];
    rows = list.map((d) => [
      d.type,
      d.description,
      d.expectedAmount,
      d.actualAmount,
      d.status,
      d.resolvedBy ? `${d.resolvedBy.firstName ?? ""} ${d.resolvedBy.lastName ?? ""}`.trim() || d.resolvedBy.email : null,
      dt(d.resolvedAt),
      dt(d.createdAt),
    ]);
    name = "anomalies";
  } else {
    return NextResponse.json({ error: "type inconnu" }, { status: 400 });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv(headers, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
