import { NextRequest, NextResponse } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { listPayments } from "@/lib/services/finance/payments";
import type { PaymentMethod } from "@prisma/client";

export async function GET(req: NextRequest) {
  const tenant = await requireSchoolPermission("finance.reports.read");
  const url = new URL(req.url);
  const year = url.searchParams.get("year") || undefined;
  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;
  const method = (url.searchParams.get("method") || undefined) as PaymentMethod | undefined;

  const payments = await listPayments(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    {
      academicYearId: year,
      from: from ? new Date(`${from}T00:00:00Z`) : undefined,
      to: to ? new Date(`${to}T23:59:59Z`) : undefined,
      method,
      includeCancelled: true,
    },
  );

  const esc = (v: string | null | undefined) =>
    `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = payments.map((p) =>
    [
      p.paidAt.toISOString().slice(0, 10),
      p.receiptNumber ?? "",
      p.student.matricule,
      `${p.student.firstName} ${p.student.lastName}`,
      p.method,
      p.reference ?? "",
      String(p.amount),
      p.status,
      p.cancelReason ?? "",
    ]
      .map(esc)
      .join(";"),
  );
  const csv =
    ["date;reçu;matricule;élève;mode;référence;montant;statut;motif_annulation", ...rows].join(
      "\r\n",
    );

  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="journal-paiements.csv"',
    },
  });
}
