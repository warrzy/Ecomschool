import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import { verifyChildAccess } from "@/lib/services/portal/parent";
import { renderReceipt, type ReceiptSnapshot } from "@/lib/pdf/receipt";

/** PDF d'un reçu validé — restreint au parent rattaché à l'élève. */
export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const tenant = await requireSchoolPermission("portal.parent");
  const { id } = await props.params;

  const payment = await prisma.payment.findFirst({
    where: { id, schoolId: tenant.schoolId, status: "VALIDATED" },
    select: { studentId: true, receiptSnapshot: true, receiptNumber: true },
  });
  if (!payment?.receiptSnapshot) {
    return new NextResponse("Reçu introuvable", { status: 404 });
  }

  const allowed = await verifyChildAccess(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    payment.studentId,
  );
  if (!allowed) return new NextResponse("Accès refusé", { status: 403 });

  const doc = new PDFDocument({ size: "A5", margin: 40 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks))),
  );
  renderReceipt(doc, payment.receiptSnapshot as unknown as ReceiptSnapshot, {
    format: "A5",
  });
  doc.end();
  const pdf = await done;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="recu-${payment.receiptNumber ?? id}.pdf"`,
    },
  });
}
