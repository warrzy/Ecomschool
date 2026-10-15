import { test, expect, type APIRequestContext } from "@playwright/test";
import ExcelJS from "exceljs";
import { prisma } from "./helpers";

/**
 * P5a — exports pédagogiques (notes détaillées + moyennes enregistrées).
 * Vérifie : génération CSV/XLSX, encodage/accents, injection de formules,
 * statuts de notes, filtres, périmètre enseignant, isolation tenant,
 * permissions, résultats manquants et absence de recalcul.
 */

const demoCtx = async () => {
  const school = await prisma.school.findUniqueOrThrow({
    where: { code: "DEMO-ECOLE" },
  });
  const year = await prisma.academicYear.findFirstOrThrow({
    where: { schoolId: school.id, isCurrent: true },
  });
  const period = await prisma.academicPeriod.findFirstOrThrow({
    where: { schoolId: school.id, academicYearId: year.id },
    orderBy: { number: "asc" },
  });
  return { school, year, period };
};

const teacherIds = async (schoolId: string) => {
  const u = await prisma.user.findUniqueOrThrow({
    where: { email: "enseignant@demo.local" },
  });
  // Même résolution que teacherIdForUser : la fiche la plus récente.
  return prisma.teacher.findFirstOrThrow({
    where: { schoolId, userId: u.id },
    orderBy: { createdAt: "desc" },
  });
};

async function csvOf(req: APIRequestContext, qs: string) {
  const res = await req.get(`/app/grades/export?format=csv&${qs}`);
  expect(res.status()).toBe(200);
  return res.text();
}

test.describe("Exports notes — admin", () => {
  test.use({ storageState: "e2e/.auth/demoAdmin.json" });

  test("CSV : BOM, en-têtes, accents, statuts distincts", async ({
    request,
  }) => {
    const csv = await csvOf(request, "");
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM Excel
    const head = csv.split("\r\n")[0];
    for (const h of [
      "matricule",
      "statut",
      "note",
      "bareme",
      "coef_matiere",
      "observation",
    ]) {
      expect(head).toContain(h);
    }
    expect(csv).toMatch(/[éèà]/u); // accents lisibles
    expect(csv).toContain("Saisie");
    // Une note manquante n'est jamais un zéro.
    const missing = csv
      .split("\r\n")
      .find((l) => l.includes(";Manquante;"));
    if (missing) {
      const cells = missing.split(";");
      const noteIdx = cells.indexOf("Manquante") + 1;
      expect(cells[noteIdx]).toBe("");
    }
  });

  test("CSV : neutralisation de l'injection de formules", async ({
    request,
  }) => {
    const { school } = await demoCtx();
    const assessment = await prisma.assessment.findFirstOrThrow({
      where: { schoolId: school.id },
      select: { id: true, classroomId: true },
    });
    const enr = await prisma.enrollment.findFirstOrThrow({
      where: { schoolId: school.id, classroomId: assessment.classroomId, status: "ENROLLED" },
      select: { studentId: true },
    });
    await prisma.grade.upsert({
      where: {
        assessmentId_studentId: {
          assessmentId: assessment.id,
          studentId: enr.studentId,
        },
      },
      update: { observation: '=HYPERLINK("https://exemple.test")', status: "ENTERED", value: 10 },
      create: {
        schoolId: school.id,
        assessmentId: assessment.id,
        studentId: enr.studentId,
        value: 10,
        status: "ENTERED",
        observation: '=HYPERLINK("https://exemple.test")',
      },
    });
    // Variante avec espace préfixe sur un autre élève.
    const enr2 = await prisma.enrollment.findFirstOrThrow({
      where: {
        schoolId: school.id,
        classroomId: assessment.classroomId,
        status: "ENROLLED",
        studentId: { not: enr.studentId },
      },
      select: { studentId: true },
    });
    await prisma.grade.upsert({
      where: {
        assessmentId_studentId: {
          assessmentId: assessment.id,
          studentId: enr2.studentId,
        },
      },
      update: { observation: "   =1+1", status: "ENTERED", value: 8 },
      create: {
        schoolId: school.id,
        assessmentId: assessment.id,
        studentId: enr2.studentId,
        value: 8,
        status: "ENTERED",
        observation: "   =1+1",
      },
    });
    const csv = await csvOf(request, `assessment=${assessment.id}`);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toContain(';"=HYPERLINK');
    expect(csv).toContain("'   =1+1");
  });

  test("XLSX : feuille nommée, en-têtes, filtre auto", async ({ request }) => {
    const res = await request.get("/app/grades/export?format=xlsx");
    expect(res.status()).toBe(200);
    const buf = await res.body();
    expect(buf.subarray(0, 2).toString()).toBe("PK"); // zip/xlsx
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("Notes");
    expect(ws).toBeTruthy();
    const head = ws!.getRow(1).values as string[];
    expect(head).toContain("matricule");
    expect(head).toContain("statut");
    expect(ws!.autoFilter).toBeTruthy();
  });

  test("filtres : classe + évaluation ciblée", async ({ request }) => {
    const { school } = await demoCtx();
    const cl = await prisma.classroom.findFirstOrThrow({
      where: { schoolId: school.id },
      select: { id: true, name: true },
    });
    const csv = await csvOf(request, `classroom=${cl.id}`);
    const lines = csv.split("\r\n").slice(1).filter(Boolean);
    for (const l of lines) {
      const cells = l.split(";");
      expect(cells[3]).toBe(cl.name); // colonne classe
    }
  });

  test("isolation : aucun élève d'un autre établissement", async ({
    request,
  }) => {
    const { school } = await demoCtx();
    const demoStudents = new Set(
      (
        await prisma.student.findMany({
          where: { schoolId: school.id },
          select: { matricule: true },
        })
      ).map((s) => s.matricule),
    );
    const csv = await csvOf(request, "");
    const lines = csv.split("\r\n").slice(1).filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      const mat = l.split(";")[0].replace(/^\uFEFF/, "");
      expect(demoStudents.has(mat)).toBe(true);
    }
  });

  test("moyennes : lit les résultats enregistrés, sans recalcul", async ({
    request,
  }) => {
    const { school, period } = await demoCtx();
    const stored = await prisma.studentPeriodResult.findFirstOrThrow({
      where: {
        schoolId: school.id,
        academicPeriodId: period.id,
        generalAverage: { not: null },
      },
      select: { classroomId: true, generalAverage: true },
    });
    const before = await prisma.studentPeriodResult.count({
      where: { schoolId: school.id },
    });
    const res = await request.get(
      `/app/results/export?format=xlsx&period=${period.id}&classroom=${stored.classroomId}`,
    );
    expect(res.status()).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await res.body()) as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("Synthèse");
    expect(ws).toBeTruthy();
    // La moyenne enregistrée apparaît telle quelle dans l'export.
    let found = false;
    ws!.eachRow((row) => {
      const v = row.getCell(6).value;
      if (typeof v === "number" && Math.abs(v - stored.generalAverage!) < 0.001)
        found = true;
    });
    expect(found).toBe(true);
    // Aucun résultat n'a été créé par l'export.
    expect(
      await prisma.studentPeriodResult.count({ where: { schoolId: school.id } }),
    ).toBe(before);
  });

  test("moyennes : élève sans résultat → « Non calculé » explicite", async ({
    request,
  }) => {
    const { year } = await demoCtx();
    const res = await request.get(
      `/app/results/export?format=csv&year=${year.id}`,
    );
    expect(res.status()).toBe(200);
    const csv = await res.text();
    // Aucun résultat annuel en local → toutes les lignes « Non calculé ».
    expect(csv).toContain("Non calculé");
    expect(csv.split("\r\n")[0]).toContain("moyenne_annuelle");
  });
});

test.describe("Exports — périmètre enseignant", () => {
  test.use({ storageState: "e2e/.auth/demoTeacher.json" });

  test("notes : uniquement ses affectations", async ({ request }) => {
    const { school } = await demoCtx();
    const teacher = await teacherIds(school.id);
    const assigned = new Set(
      (
        await prisma.teachingAssignment.findMany({
          where: { schoolId: school.id, teacherId: teacher.id },
          select: { classroomId: true },
        })
      ).map((a) => a.classroomId),
    );
    const classNames = new Map(
      (
        await prisma.classroom.findMany({
          where: { schoolId: school.id },
          select: { id: true, name: true },
        })
      ).map((c) => [c.id, c.name]),
    );
    const csv = await csvOf(request, "");
    const lines = csv.split("\r\n").slice(1).filter(Boolean);
    for (const l of lines) {
      const classe = l.split(";")[3];
      for (const [id, name] of classNames) {
        if (name === classe) expect(assigned.has(id)).toBe(true);
      }
    }
  });

  test("notes : falsification teacher=<autre> → refus", async ({
    request,
  }) => {
    const { school } = await demoCtx();
    const teacher = await teacherIds(school.id);
    const other = await prisma.teacher.findFirst({
      where: { schoolId: school.id, id: { not: teacher.id } },
    });
    if (!other) test.skip();
    const res = await request.get(
      `/app/grades/export?format=csv&teacher=${other!.id}`,
      { maxRedirects: 0 },
    );
    expect(res.status()).toBe(403);
  });

  test("moyennes : classe hors affectation → refus", async ({ request }) => {
    const { school, period } = await demoCtx();
    const teacher = await teacherIds(school.id);
    const assigned = new Set(
      (
        await prisma.teachingAssignment.findMany({
          where: { schoolId: school.id, teacherId: teacher.id },
          select: { classroomId: true },
        })
      ).map((a) => a.classroomId),
    );
    const foreign = await prisma.classroom.findFirst({
      where: { schoolId: school.id, id: { notIn: [...assigned] } },
    });
    if (!foreign) test.skip();
    const res = await request.get(
      `/app/results/export?format=csv&period=${period.id}&classroom=${foreign!.id}`,
      { maxRedirects: 0 },
    );
    expect(res.status()).toBe(403);
  });
});

test.describe("Exports — permissions", () => {
  test.use({ storageState: "e2e/.auth/demoFinance.json" });

  test("finance : export notes refusé", async ({ request }) => {
    const res = await request.get("/app/grades/export?format=csv", {
      maxRedirects: 0,
    });
    expect([301, 302, 303, 307, 403]).toContain(res.status());
  });

  test("finance : export moyennes refusé", async ({ request }) => {
    const res = await request.get("/app/results/export?format=csv&year=x", {
      maxRedirects: 0,
    });
    expect([301, 302, 303, 307, 403]).toContain(res.status());
  });
});

test.describe("Exports — anonyme", () => {
  test("sans session → redirection", async ({ request }) => {
    const res = await request.get("/app/grades/export?format=csv", {
      maxRedirects: 0,
    });
    expect([301, 302, 303, 307]).toContain(res.status());
  });
});
