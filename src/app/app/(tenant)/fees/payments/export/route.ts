import { NextRequest } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  ALLOCATIONS_HEADERS,
  buildPaymentsExport,
  PAYMENTS_HEADERS,
} from "@/lib/export/finance";
import { exportFile } from "@/lib/export/respond";
import type { PaymentMethod, PaymentStatus } from "@prisma/client";

/**
 * GET /app/fees/payments/export?format=csv|xlsx&year&classroom&student
 *   &from&to&method&status=VALIDATED|CANCELLED&view=allocations
 * Journal des paiements — finance.reports.read uniquement.
 * XLSX : feuille « Paiements » + feuille « Ventilations ».
 * CSV : journal par défaut ; view=allocations → ventilations seules.
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
    ? (p("status") as PaymentStatus)
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
    format: p("format") === "xlsx" ? "xlsx" : "csv",
    filename: ventilations ? "ventilations-paiements" : "journal-paiements",
    sheets: ventilations
      ? [
          {
            name: "Ventilations",
            headers: ALLOCATIONS_HEADERS,
            rows: allocations,
          },
        ]
      : [
          { name: "Paiements", headers: PAYMENTS_HEADERS, rows: payments },
          {
            name: "Ventilations",
            headers: ALLOCATIONS_HEADERS,
            rows: allocations,
          },
        ],
    truncated,
  });
}
