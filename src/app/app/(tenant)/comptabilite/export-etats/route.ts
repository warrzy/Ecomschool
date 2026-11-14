import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { statementCsv, balanceSheet, incomeStatement, exerciseOf } from "@/lib/services/accounting/statements";
import { renderFinanceReport } from "@/lib/pdf/finance-report";
import type { ReportSheet } from "@/lib/services/finance/reports";
import { prisma } from "@/lib/db/prisma";

/** CG-3 : export CSV/PDF bilan + compte de résultat. */
export async function GET(req: NextRequest) {
  const t = await requireSchoolPermission("accounting.export");
  const ctx = { userId: t.userId, schoolId: t.schoolId };
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "bilan";
  const format = url.searchParams.get("format") ?? "csv";
  const exerciseId = url.searchParams.get("exercise") ?? "";
  if (!exerciseId) return new NextResponse("exercise requis", { status: 400 });

  if (format === "csv") {
    if (kind !== "bilan" && kind !== "resultat") return new NextResponse("kind invalide", { status: 400 });
    const r = await statementCsv(ctx, kind, exerciseId);
    if (!r.ok) return new NextResponse(r.error, { status: 400 });
    return new NextResponse(r.result.csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${r.result.filename}"` },
    });
  }
  if (format !== "pdf") return new NextResponse("format invalide", { status: 400 });

  const [bs, is, ex, school] = await Promise.all([
    balanceSheet(ctx, exerciseId), incomeStatement(ctx, exerciseId),
    exerciseOf(ctx, exerciseId),
    prisma.school.findUnique({ where: { id: ctx.schoolId }, select: { name: true } }),
  ]);
  if (!bs.ok || !is.ok || !ex) return new NextResponse("État indisponible", { status: 400 });

  const toRows = (s: { lines: { code: string; name: string; amount: number }[] }) =>
    s.lines.map((l) => [l.code, l.name, l.amount]);
  const sheets: ReportSheet[] = [
    ...bs.result.actif.map((s) => ({ name: `ACTIF — ${s.label}`, headers: ["Compte", "Libellé", "Montant"], rows: toRows(s), totals: ["", `Total ${s.label}`, s.total] })),
    ...bs.result.passif.map((s) => ({ name: `PASSIF — ${s.label}`, headers: ["Compte", "Libellé", "Montant"], rows: toRows(s), totals: ["", `Total ${s.label}`, s.total] })),
    { name: "COMPTE DE RÉSULTAT — Charges", headers: ["Compte", "Libellé", "Montant"], rows: toRows(is.result.charges), totals: ["", "Total charges", is.result.charges.total] },
    { name: "COMPTE DE RÉSULTAT — Produits", headers: ["Compte", "Libellé", "Montant"], rows: toRows(is.result.produits), totals: ["", "Total produits", is.result.produits.total] },
  ];
  const doc = new PDFDocument({ size: "A4", margin: 36 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  renderFinanceReport(doc, {
    schoolName: school?.name ?? "", title: "États financiers SYSCOHADA",
    meta: [`Exercice : ${ex.name}`, `Total actif : ${bs.result.totalActif.toLocaleString("fr-FR")} — Total passif : ${bs.result.totalPassif.toLocaleString("fr-FR")}`, `Résultat : ${is.result.resultat.toLocaleString("fr-FR")}`],
    notes: ["Mapping par classes de comptes — à valider par le référent comptable."],
    sheets,
  });
  doc.end();
  const pdf = await done;
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="etats-${exerciseId}.pdf"` },
  });
}
