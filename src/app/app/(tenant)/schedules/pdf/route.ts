import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import { getWeekTimetable, weekStart, minutesToLabel } from "@/lib/services/schedules";

const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const DAY_KEYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

const PALETTE = [
  "#dbeafe",
  "#dcfce7",
  "#fef3c7",
  "#ffe4e6",
  "#ede9fe",
  "#cffafe",
  "#ecfccb",
  "#ffedd5",
];

function subjectColor(name: string | null) {
  if (!name) return "#f4f4f5";
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997;
  return PALETTE[h % PALETTE.length];
}

export async function GET(req: NextRequest) {
  const tenant = await requireSchoolPermission("schedules.print");
  const url = new URL(req.url);

  const view = url.searchParams.get("view") ?? "classroom";
  const id = url.searchParams.get("id") ?? undefined;
  const weekParam = url.searchParams.get("week") ?? undefined;
  const ws = weekStart(weekParam ? new Date(weekParam) : new Date());
  const we = new Date(ws);
  we.setDate(we.getDate() + 6);

  const school = await prisma.school.findFirst({
    where: { id: tenant.schoolId },
    select: { name: true, logoUrl: true },
  });

  // Cibles : une vue = un ou plusieurs tableaux
  type Target = { title: string; classroomId?: string; teacherId?: string; roomId?: string };
  const targets: Target[] = [];

  if (view === "classroom" && id) {
    const c = await prisma.classroom.findFirst({
      where: { id, schoolId: tenant.schoolId },
      select: { name: true },
    });
    if (!c) return new NextResponse("Not found", { status: 404 });
    targets.push({ title: `Classe : ${c.name}`, classroomId: id });
  } else if (view === "teacher" && id) {
    const t = await prisma.teacher.findFirst({
      where: { id, schoolId: tenant.schoolId },
      select: { firstName: true, lastName: true },
    });
    if (!t) return new NextResponse("Not found", { status: 404 });
    targets.push({
      title: `Enseignant : ${t.lastName} ${t.firstName}`,
      teacherId: id,
    });
  } else if (view === "room" && id) {
    const r = await prisma.room.findFirst({
      where: { id, schoolId: tenant.schoolId },
      select: { name: true, code: true },
    });
    if (!r) return new NextResponse("Not found", { status: 404 });
    targets.push({ title: `Salle : ${r.code} — ${r.name}`, roomId: id });
  } else {
    // Vue établissement : un tableau par classe de l'année filtrée
    const yearId = url.searchParams.get("year") ?? undefined;
    const classes = await prisma.classroom.findMany({
      where: {
        schoolId: tenant.schoolId,
        status: "ACTIVE",
        ...(yearId ? { academicYearId: yearId } : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    for (const c of classes) {
      targets.push({ title: `Classe : ${c.name}`, classroomId: c.id });
    }
    if (targets.length === 0) {
      return new NextResponse("Aucune classe", { status: 400 });
    }
  }

  const yearId = url.searchParams.get("year") ?? undefined;
  const year = yearId
    ? await prisma.academicYear.findFirst({
        where: { id: yearId, schoolId: tenant.schoolId },
        select: { name: true },
      })
    : null;

  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks))),
  );

  const fmt = (d: Date) =>
    `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

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

  for (let ti = 0; ti < targets.length; ti++) {
    if (ti > 0) doc.addPage();
    const target = targets[ti];

    // En-tête
    if (logo) {
      try {
        doc.image(logo, 36, 28, { height: 36 });
      } catch {
        /* logo illisible : on continue sans */
      }
    }
    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .text(school?.name ?? "", logo ? 84 : 36, 32);
    doc
      .fontSize(9)
      .font("Helvetica")
      .text(
        `Emploi du temps — semaine du ${fmt(ws)} au ${fmt(we)}${year ? ` — ${year.name}` : ""}`,
        logo ? 84 : 36,
        50,
      );
    doc.fontSize(9).text(`Généré le ${fmt(new Date())}`, logo ? 84 : 36, 62);
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(target.title, 36, 84);

    const slots = await getWeekTimetable(
      { schoolId: tenant.schoolId },
      {
        weekStart: ws,
        academicYearId: yearId,
        classroomId: target.classroomId,
        teacherId: target.teacherId,
        roomId: target.roomId,
      },
    );

    // Grille : lignes = heures uniques
    const hours = [...new Set(slots.map((s) => Math.floor(s.startMin / 60)))].sort(
      (a, b) => a - b,
    );
    if (hours.length === 0) {
      doc.fontSize(10).font("Helvetica").text("Aucun cours cette semaine.", 36, 110);
      doc
        .fontSize(8)
        .text(`Page ${ti + 1}/${targets.length}`, 760, 570, { align: "right" });
      continue;
    }

    const tableTop = 105;
    const labelW = 50;
    const colW = (770 - labelW) / DAYS.length;
    const rowH = 34;

    // En-tête colonnes
    doc.fontSize(8).font("Helvetica-Bold");
    DAYS.forEach((d, i) => {
      doc.text(d, labelW + 36 + i * colW + 4, tableTop + 4, { width: colW - 8 });
    });
    doc
      .moveTo(36, tableTop)
      .lineTo(806, tableTop)
      .moveTo(36, tableTop + 16)
      .lineTo(806, tableTop + 16)
      .stroke();

    doc.font("Helvetica");
    hours.forEach((h, ri) => {
      const y = tableTop + 16 + ri * rowH;
      doc.fontSize(8).fillColor("#52525b").text(`${String(h).padStart(2, "0")}h`, 40, y + 4);
      doc
        .moveTo(36, y + rowH)
        .lineTo(806, y + rowH)
        .strokeColor("#e4e4e7")
        .stroke();

      DAY_KEYS.forEach((dk, di) => {
        const cell = slots.filter(
          (s) => s.weekday === dk && Math.floor(s.startMin / 60) === h,
        );
        cell.forEach((s, ci) => {
          const x = 36 + labelW + di * colW + 2;
          const cy = y + 2 + ci * (rowH - 4);
          doc
            .rect(x, cy, colW - 4, rowH - 4)
            .fillAndStroke(subjectColor(s.subjectName), "#d4d4d8");
          doc
            .fillColor("#18181b")
            .fontSize(7)
            .text(
              `${s.subjectName ?? "Cours"} ${minutesToLabel(s.startMin)}–${minutesToLabel(s.endMin)}`,
              x + 3,
              cy + 3,
              { width: colW - 10 },
            )
            .fontSize(6.5)
            .fillColor("#3f3f46")
            .text(
              `${s.classroomName} — ${s.teacherName}${s.roomName ? ` — ${s.roomName}` : ""}${s.status === "CANCELLED" ? " (ANNULÉ)" : s.status === "POSTPONED" ? " (REPORTÉ)" : ""}`,
              x + 3,
              cy + 14,
              { width: colW - 10 },
            );
        });
      });
    });

    // Pied de page
    doc
      .fontSize(8)
      .fillColor("#71717a")
      .text(`Édité le ${fmt(new Date())}`, 36, 570)
      .text(`Page ${ti + 1}/${targets.length}`, 760, 570, {
        align: "right",
      });
  }

  doc.end();
  const pdf = await done;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="emploi-du-temps-${fmt(ws).replaceAll("/", "-")}.pdf"`,
    },
  });
}
