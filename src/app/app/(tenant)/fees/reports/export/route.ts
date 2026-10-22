import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import {
  buildReport,
  REPORT_TYPES,
  type ReportType,
} from "@/lib/services/finance/reports";
import { renderFinanceReport } from "@/lib/pdf/finance-report";
import { exportFile } from "@/lib/export/respond";
import type { ExpenseStatus, PaymentMethod } from "@prisma/client";

/**
 * GET /app/fees/reports/export?type=…&format=csv|xlsx|pdf&from&to&year&method&category&status
 * finance.reports.read uniquement — vérifié à chaque téléchargement.
 * CSV = première feuille ; XLSX = toutes les feuilles ; PDF = A4 paysage paginé.
 */
export async function GET(req: NextRequest) {
  const tenant = await requireSchoolPermission("finance.reports.read");
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const url = new URL(req.url);
  const p = (k: string) => url.searchParams.get(k) || undefined;

  const type = p("type") as ReportType;
  if (!REPORT_TYPES.some((t) => t.value === type)) {
    return new NextResponse("Type de rapport inconnu", { status: 400 });
  }
  const format = p("format") ?? "csv";
  if (!["csv", "xlsx", "pdf"].includes(format)) {
    return new NextResponse("Format inconnu", { status: 400 });
  }
  const date = (k: string) => {
    const v = p(k);
    return v && !Number.isNaN(new Date(v).getTime()) ? new Date(v) : undefined;
  };
  const method = ["CASH", "BANK_TRANSFER", "CHECK", "MOBILE_MONEY", "OTHER"]
    .includes(p("method") ?? "")
    ? (p("method") as PaymentMethod)
    : undefined;
  const status = ["DRAFT", "PAID", "CANCELLED"].includes(p("status") ?? "")
    ? (p("status") as ExpenseStatus)
    : undefined;

  const report = await buildReport(ctx, type, {
    from: date("from"),
    to: date("to") && new Date(date("to")!.getTime() + 24 * 60 * 60 * 1000),
    academicYearId: p("year"),
    method,
    categoryId: p("category"),
    status,
  });

  if (report.truncated) {
    return new NextResponse(
      "Export trop volumineux — réduisez les filtres ou la période, puis réessayez.",
      { status: 413 },
    );
  }

  const filename = `rapport-${type}`;

  if (format === "pdf") {
    const school = await prisma.school.findUnique({
      where: { id: tenant.schoolId },
      select: { name: true },
    });
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) =>
      doc.on("end", () => resolve(Buffer.concat(chunks))),
    );
    renderFinanceReport(doc, {
      schoolName: school?.name ?? "Établissement",
      title: report.title,
      meta: report.meta,
      notes: report.notes,
      sheets: report.sheets,
    });
    doc.end();
    const pdf = await done;
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}-${new Date().toISOString().slice(0, 10)}.pdf"`,
      },
    });
  }

  return exportFile({
    format: format as "csv" | "xlsx",
    filename,
    sheets: report.sheets.map((s) => ({
      name: s.name,
      headers: s.headers,
      rows: s.totals ? [...s.rows, s.totals] : s.rows,
    })),
  });
}
