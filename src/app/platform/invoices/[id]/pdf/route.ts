import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { requirePlatformPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import { renderInvoice, type InvoiceSnapshot } from "@/lib/pdf/invoice";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requirePlatformPermission("platform.invoices.read");
  const { id } = await ctx.params;
  const invoice = await prisma.platformInvoice.findUnique({
    where: { id },
    select: { invoiceNumber: true, snapshot: true },
  });
  if (!invoice?.snapshot) {
    return new NextResponse("Facture introuvable", { status: 404 });
  }

  const doc = new PDFDocument({ size: "A4", margin: 45 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks))),
  );
  renderInvoice(doc, invoice.snapshot as unknown as InvoiceSnapshot);
  doc.end();
  const pdf = await done;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.invoiceNumber}.pdf"`,
    },
  });
}
