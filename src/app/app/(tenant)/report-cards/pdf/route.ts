import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import {
  loadSchoolLogo,
  renderReportCard,
  type ReportCardLayout,
  type ReportCardPayload,
} from "@/lib/pdf/report-card";
import { templateFor } from "@/lib/services/grading/reportcards";
import type { ResultStatus } from "@prisma/client";

export async function GET(req: NextRequest) {
  const tenant = await requireSchoolPermission("reportcards.print");
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const classroomId = url.searchParams.get("classroom");
  const periodId = url.searchParams.get("period");
  const templateOverride = url.searchParams.get("template");
  const statusRaw = url.searchParams.get("status");
  const STATUS: ResultStatus[] = [
    "DRAFT",
    "CALCULATED",
    "PENDING_VALIDATION",
    "VALIDATED",
    "PUBLISHED",
    "RECTIFIED",
  ];
  const status = STATUS.includes(statusRaw as ResultStatus)
    ? (statusRaw as ResultStatus)
    : undefined;

  const cards = await prisma.reportCard.findMany({
    where: {
      schoolId: tenant.schoolId,
      ...(id ? { id } : {}),
      ...(classroomId ? { classroomId } : {}),
      ...(periodId ? { academicPeriodId: periodId } : {}),
      ...(status ? { status } : {}),
    },
    include: {
      versions: { orderBy: { version: "desc" }, take: 1 },
      student: { select: { lastName: true, firstName: true } },
      classroom: { select: { levelId: true } },
    },
    orderBy: { student: { lastName: "asc" } },
  });
  if (cards.length === 0) return new NextResponse("Aucun bulletin", { status: 404 });

  const school = await prisma.school.findUnique({
    where: { id: tenant.schoolId },
    select: { logoUrl: true },
  });
  const logo = loadSchoolLogo(school?.logoUrl);

  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (i > 0) doc.addPage();
    const version = card.versions[0];
    if (!version) {
      doc.fontSize(10).text("Aucune version générée pour ce bulletin.", 40, 40);
      continue;
    }
    const templateKey =
      templateOverride ??
      (await templateFor({ userId: tenant.userId, schoolId: tenant.schoolId }, card.classroom?.levelId));
    const template = await prisma.reportCardTemplate.findFirst({
      where: { schoolId: tenant.schoolId, key: templateKey },
      select: { layout: true },
    });
    renderReportCard(doc, version.payload as unknown as ReportCardPayload, {
      identifier: card.identifier,
      version: version.version,
      status: card.status,
      publishedAt: card.publishedAt,
    }, {
      templateKey,
      layout: (template?.layout as ReportCardLayout | null) ?? null,
      logo,
    });
  }

  doc.end();
  const pdf = await done;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="bulletins.pdf"`,
    },
  });
}
