import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import { resolveStudent } from "@/lib/services/portal/student";
import { templateFor } from "@/lib/services/grading/reportcards";
import {
  loadSchoolLogo,
  renderReportCard,
  type ReportCardLayout,
  type ReportCardPayload,
} from "@/lib/pdf/report-card";

/** PDF d'un bulletin publié — accès restreint à l'élève propriétaire. */
export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const tenant = await requireSchoolPermission("portal.student");
  const { id } = await props.params;

  const student = await resolveStudent({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
  });
  if (!student) return new NextResponse("Accès refusé", { status: 403 });

  const card = await prisma.reportCard.findFirst({
    where: {
      id,
      schoolId: tenant.schoolId,
      studentId: student.id,
      status: { in: ["PUBLISHED", "RECTIFIED"] },
    },
    include: {
      versions: { orderBy: { version: "desc" }, take: 1 },
      classroom: { select: { levelId: true } },
    },
  });
  if (!card) return new NextResponse("Bulletin introuvable", { status: 404 });
  const version = card.versions[0];
  if (!version) return new NextResponse("Aucune version", { status: 404 });

  const school = await prisma.school.findUnique({
    where: { id: tenant.schoolId },
    select: { logoUrl: true },
  });
  const templateKey = await templateFor(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    card.classroom?.levelId,
  );
  const template = await prisma.reportCardTemplate.findFirst({
    where: { schoolId: tenant.schoolId, key: templateKey },
    select: { layout: true },
  });

  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks))),
  );

  renderReportCard(doc, version.payload as unknown as ReportCardPayload, {
    identifier: card.identifier,
    version: version.version,
    status: card.status,
    publishedAt: card.publishedAt,
  }, {
    templateKey,
    layout: (template?.layout as ReportCardLayout | null) ?? null,
    logo: loadSchoolLogo(school?.logoUrl),
  });

  doc.end();
  const pdf = await done;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${card.identifier}.pdf"`,
    },
  });
}
