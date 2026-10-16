import { NextRequest } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  ALLOCATIONS_HEADERS,
  buildPaymentsExport,
  PAYMENTS_HEADERS,
} from "@/lib/export/finance";
import { exportFile } from "@/lib/export/respond";
import type { PaymentMethod } from "@prisma/client";

/**
 * GET /app/fees/payments/csv?year&from&to&method&classroom&student
 *   &status=VALIDATED|CANCELLED&view=allocations
 * URL historique conservée (rétrocompatibilité) — réécrite sur le socle :
 * BOM + anti-injection + pagination au-delà de 500 lignes + marqueur
 * de troncature explicite. Inclut les paiements annulés (statut distinct).
 * view=allocations → export distinct des ventilations.
 */
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
    ? (p("status") as "VALIDATED" | "CANCELLED")
    : undefined;

  const { payments, allocations, truncated } = await buildPaymentsExport(
    ctx,
    {
      academicYearId: p("year"),
      classroomId: p("classroom"),
      studentId: p("student"),
      from: date("from"),
      to: date("to"),
      method,
      status,
    },
  );

  const ventilations = p("view") === "allocations";
  return exportFile({
    format: "csv",
    filename: ventilations ? "ventilations-paiements" : "journal-paiements",
    sheets: [
      {
        name: ventilations ? "Ventilations" : "Paiements",
        headers: ventilations ? ALLOCATIONS_HEADERS : PAYMENTS_HEADERS,
        rows: ventilations ? allocations : payments,
      },
    ],
    truncated,
  });
}
