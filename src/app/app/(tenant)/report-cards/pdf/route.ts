import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";

type Payload = {
  school: { name: string; logoUrl: string | null; address: string | null; city: string | null; phone: string | null; email: string | null };
  student: { matricule: string; firstName: string; lastName: string; birthDate: string | null };
  classroom: { name: string; level?: { name: string } | null };
  period: { name: string; number: number; academicYear: { name: string } };
  classSize: number;
  generalAverage: number | null;
  rank: number | null;
  mention: string | null;
  absences: number;
  lates: number;
  subjects: {
    name: string;
    average: number | null;
    coefficient: number | null;
    weightedPoints: number | null;
    rank: number | null;
    appreciation: string | null;
  }[];
};

const fmt = (d: Date | string) => {
  const dt = typeof d === "string" ? new Date(d) : d;
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
};

function renderCard(
  doc: PDFKit.PDFDocument,
  payload: Payload,
  meta: { identifier: string; version: number; status: string; publishedAt: Date | null },
  logo: Buffer | null,
) {
  const L = 40;
  const W = 515; // A4 portrait ~595pt - marges

  // En-tête établissement
  if (logo) {
    try {
      doc.image(logo, L, 36, { height: 40 });
    } catch {
      /* logo illisible : on continue sans */
    }
  }
  doc
    .fontSize(14)
    .font("Helvetica-Bold")
    .text(payload.school.name, logo ? L + 52 : L, 40);
  doc.fontSize(8).font("Helvetica");
  const contact = [payload.school.address, payload.school.city, payload.school.phone, payload.school.email]
    .filter(Boolean)
    .join(" — ");
  if (contact) doc.text(contact, logo ? L + 52 : L, 58, { width: W - 52 });
  doc
    .fontSize(12)
    .font("Helvetica-Bold")
    .text("BULLETIN SCOLAIRE", L, 92, { width: W, align: "center" });
  doc
    .fontSize(9)
    .font("Helvetica")
    .text(`${payload.period.academicYear.name} — ${payload.period.name}`, L, 110, {
      width: W,
      align: "center",
    });

  // Bloc élève
  let y = 132;
  doc.rect(L, y, W, 44).strokeColor("#d4d4d8").stroke();
  doc.fontSize(9).font("Helvetica-Bold")
    .text(`${payload.student.lastName} ${payload.student.firstName}`, L + 8, y + 6);
  doc.font("Helvetica").fontSize(8)
    .text(`Matricule : ${payload.student.matricule}`, L + 8, y + 20)
    .text(
      payload.student.birthDate ? `Né(e) le : ${fmt(payload.student.birthDate)}` : "",
      L + 8, y + 30,
    )
    .text(`Classe : ${payload.classroom.name}`, L + 300, y + 6)
    .text(`Effectif : ${payload.classSize}`, L + 300, y + 20);

  // Tableau matières
  y += 56;
  const cols = { subject: 170, avg: 60, coef: 50, pts: 60, rank: 50, appr: W - 390 };
  doc.fontSize(8).font("Helvetica-Bold");
  doc.text("Matière", L + 4, y + 4);
  doc.text("Moyenne", L + 4 + cols.subject, y + 4);
  doc.text("Coef.", L + 4 + cols.subject + cols.avg, y + 4);
  doc.text("Points", L + 4 + cols.subject + cols.avg + cols.coef, y + 4);
  doc.text("Rang", L + 4 + cols.subject + cols.avg + cols.coef + cols.pts, y + 4);
  doc.text("Appréciation", L + 4 + cols.subject + cols.avg + cols.coef + cols.pts + cols.rank, y + 4);
  doc.moveTo(L, y + 16).lineTo(L + W, y + 16).stroke();
  y += 18;
  doc.font("Helvetica");
  for (const s of payload.subjects) {
    doc.fontSize(8).text(s.name, L + 4, y, { width: cols.subject - 8 });
    doc.text(s.average != null ? s.average.toFixed(2) : "—", L + 4 + cols.subject, y);
    doc.text(s.coefficient != null ? String(s.coefficient) : "—", L + 4 + cols.subject + cols.avg, y);
    doc.text(s.weightedPoints != null ? s.weightedPoints.toFixed(2) : "—", L + 4 + cols.subject + cols.avg + cols.coef, y);
    doc.text(s.rank != null ? String(s.rank) : "—", L + 4 + cols.subject + cols.avg + cols.coef + cols.pts, y);
    doc.text(s.appreciation ?? "", L + 4 + cols.subject + cols.avg + cols.coef + cols.pts + cols.rank, y, { width: cols.appr - 8 });
    y += 14;
    doc.moveTo(L, y).lineTo(L + W, y).strokeColor("#e4e4e7").stroke();
    y += 2;
  }

  // Synthèse
  y += 12;
  doc.rect(L, y, W, 78).strokeColor("#d4d4d8").stroke();
  doc.fontSize(9).font("Helvetica-Bold")
    .text("Synthèse", L + 8, y + 6);
  doc.font("Helvetica").fontSize(8)
    .text(`Moyenne générale : ${payload.generalAverage != null ? `${payload.generalAverage.toFixed(2)}/20` : "—"}`, L + 8, y + 22)
    .text(`Rang : ${payload.rank != null ? `${payload.rank} / ${payload.classSize}` : "—"}`, L + 8, y + 34)
    .text(`Mention : ${payload.mention ?? "—"}`, L + 8, y + 46)
    .text(`Absences : ${payload.absences} · Retards : ${payload.lates}`, L + 8, y + 58)
    .text("Décision de la direction : ______________________________", L + 260, y + 22)
    .text("Appréciation générale :", L + 260, y + 34)
    .text("_________________________________________", L + 260, y + 46)
    .text("Signature :", L + 260, y + 62);

  // Pied : identifiant + version + date
  doc.fontSize(7).fillColor("#71717a")
    .text(
      `Bulletin ${meta.identifier} · v${meta.version} · ${meta.status}${meta.publishedAt ? ` · publié le ${fmt(meta.publishedAt)}` : ""} · édité le ${fmt(new Date())}`,
      L,
      812,
      { width: W, align: "center" },
    );
  doc.fillColor("#18181b");
}

export async function GET(req: NextRequest) {
  const tenant = await requireSchoolPermission("reportcards.print");
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const classroomId = url.searchParams.get("classroom");
  const periodId = url.searchParams.get("period");

  const cards = await prisma.reportCard.findMany({
    where: {
      schoolId: tenant.schoolId,
      ...(id ? { id } : {}),
      ...(classroomId ? { classroomId } : {}),
      ...(periodId ? { academicPeriodId: periodId } : {}),
    },
    include: {
      versions: { orderBy: { version: "desc" }, take: 1 },
      student: { select: { lastName: true, firstName: true } },
    },
    orderBy: { student: { lastName: "asc" } },
  });
  if (cards.length === 0) return new NextResponse("Aucun bulletin", { status: 404 });

  const school = await prisma.school.findUnique({
    where: { id: tenant.schoolId },
    select: { logoUrl: true },
  });
  let logo: Buffer | null = null;
  if (school?.logoUrl?.startsWith("/")) {
    const p = join(process.cwd(), "public", school.logoUrl);
    if (existsSync(p)) {
      try {
        logo = readFileSync(p);
      } catch {
        logo = null;
      }
    }
  }

  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  cards.forEach((card, i) => {
    if (i > 0) doc.addPage();
    const version = card.versions[0];
    if (!version) {
      doc.fontSize(10).text("Aucune version générée pour ce bulletin.", 40, 40);
      return;
    }
    renderCard(doc, version.payload as unknown as Payload, {
      identifier: card.identifier,
      version: version.version,
      status: card.status,
      publishedAt: card.publishedAt,
    }, logo);
  });

  doc.end();
  const pdf = await done;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="bulletins.pdf"`,
    },
  });
}
