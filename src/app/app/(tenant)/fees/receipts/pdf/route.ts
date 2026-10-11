import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import { renderReceipt, type ReceiptSnapshot } from "@/lib/pdf/receipt";

export async function GET(req: NextRequest) {
  const tenant = await requireSchoolPermission("finance.receipts.print");
  const url = new URL(req.url);
  const paymentId = url.searchParams.get("payment");
  const format = url.searchParams.get("format") === "A4" ? "A4" : "A5";
  if (!paymentId) return new NextResponse("Paramètre manquant", { status: 400 });

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, schoolId: tenant.schoolId, status: "VALIDATED" },
    select: { receiptSnapshot: true, receiptNumber: true },
  });
  if (!payment?.receiptSnapshot) {
    return new NextResponse("Reçu introuvable", { status: 404 });
  }

  const doc = new PDFDocument({ size: format, margin: 40 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks))),
  );
  renderReceipt(doc, payment.receiptSnapshot as unknown as ReceiptSnapshot, { format });
  doc.end();
  const pdf = await done;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="recu-${payment.receiptNumber ?? paymentId}.pdf"`,
    },
  });
}
