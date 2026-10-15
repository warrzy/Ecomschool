import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";
import { prisma } from "./helpers";

/**
 * P5b — exports des référentiels scolaires : élèves, inscriptions,
 * classes/niveaux, enseignants, personnel, emplois du temps.
 * Vérifie : formats CSV/XLSX, filtres, minimisation des données
 * personnelles, périmètre enseignant, isolation tenant, permissions,
 * exports vides et intégrité des fichiers.
 */

const demoCtx = async () => {
  const school = await prisma.school.findUniqueOrThrow({
    where: { code: "DEMO-ECOLE" },
  });
  const year = await prisma.academicYear.findFirstOrThrow({
    where: { schoolId: school.id, isCurrent: true },
  });
  const classroom = await prisma.classroom.findFirstOrThrow({
    where: { schoolId: school.id, academicYearId: year.id },
  });
  return { school, year, classroom };
};

const rows = (csv: string) =>
  csv.replace("﻿", "").trim().split("\r\n").slice(1);

const header = (csv: string) =>
  csv.replace("﻿", "").split("\r\n")[0];

async function xlsxOf(res: { body: () => Promise<Buffer> }) {
  const buf = await res.body();
  expect(buf.subarray(0, 2).toString()).toBe("PK");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  return wb;
}

test.describe("Exports élèves et inscriptions — admin", () => {
  test.use({ storageState: "e2e/.auth/demoAdmin.json" });

  test("élèves standard : en-têtes pédagogiques, aucune donnée personnelle", async ({
    request,
  }) => {
    const res = await request.get("/app/students/export?format=csv");
    expect(res.status()).toBe(200);
    const csv = await res.text();
    const h = header(csv);
    for (const col of ["matricule", "nom", "prenom", "sexe", "classe", "annee", "statut"])
      expect(h).toContain(col);
    for (const col of ["telephone", "email", "adresse", "naissance"])
      expect(h).not.toContain(col);
    expect(csv).toContain("DEMO-");
    expect(csv).toMatch(/[éèà]/u);
  });

  test("élèves complet : colonnes administratives pour student.manage", async ({
    request,
  }) => {
    const res = await request.get("/app/students/export?format=csv&full=1");
    expect(res.status()).toBe(200);
    const h = header(await res.text());
    for (const col of ["date_naissance", "telephone", "email", "adresse"])
      expect(h).toContain(col);
  });

  test("élèves : filtre classe → toutes les lignes de la même classe", async ({
    request,
  }) => {
    const { year, classroom } = await demoCtx();
    const res = await request.get(
      `/app/students/export?format=csv&year=${year.id}&classroom=${classroom.id}`,
    );
    expect(res.status()).toBe(200);
    const lines = rows(await res.text());
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l.split(";")[4]).toBe(classroom.name);
  });

  test("élèves : filtre statut ARCHIVED → uniquement des archivés", async ({
    request,
  }) => {
    const res = await request.get(
      "/app/students/export?format=csv&status=ARCHIVED",
    );
    expect(res.status()).toBe(200);
    for (const l of rows(await res.text()))
      expect(l.endsWith("Archivé")).toBe(true);
  });

  test("élèves XLSX : feuille nommée + autofiltre + intégrité zip", async ({
    request,
  }) => {
    const res = await request.get("/app/students/export?format=xlsx");
    expect(res.status()).toBe(200);
    const wb = await xlsxOf(res);
    const ws = wb.worksheets[0];
    expect(ws.name).toBe("Élèves");
    expect(ws.getRow(1).getCell(1).value).toBe("matricule");
    expect(ws.autoFilter).toBeTruthy();
  });

  test("inscriptions : historique par année + statuts traduits", async ({
    request,
  }) => {
    const { year } = await demoCtx();
    const res = await request.get(
      `/app/enrollments/export?format=csv&year=${year.id}`,
    );
    expect(res.status()).toBe(200);
    const csv = await res.text();
    const h = header(csv);
    for (const col of [
      "matricule",
      "classe",
      "annee",
      "statut_inscription",
      "date_inscription",
    ])
      expect(h).toContain(col);
    const lines = rows(csv);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toContain("Inscrit");
  });

  test("inscriptions : filtre classe inexistante → export vide (en-têtes seuls)", async ({
    request,
  }) => {
    const res = await request.get(
      "/app/enrollments/export?format=csv&classroom=cmx_inexistant",
    );
    expect(res.status()).toBe(200);
    expect(rows(await res.text()).length).toBe(0);
  });
});

test.describe("Exports classes et niveaux — admin", () => {
  test.use({ storageState: "e2e/.auth/demoAdmin.json" });

  test("classes : effectifs réels cohérents avec la BDD", async ({
    request,
  }) => {
    const { school, year } = await demoCtx();
    const res = await request.get(
      `/app/classrooms/export?format=csv&year=${year.id}`,
    );
    expect(res.status()).toBe(200);
    const lines = rows(await res.text());
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      const cells = l.split(";");
      const expected = await prisma.enrollment.count({
        where: {
          schoolId: school.id,
          status: "ENROLLED",
          classroom: { schoolId: school.id, name: cells[2] },
        },
      });
      expect(Number(cells[6])).toBe(expected);
    }
  });

  test("classes XLSX : feuilles Classes + Niveaux", async ({ request }) => {
    const res = await request.get("/app/classrooms/export?format=xlsx");
    const wb = await xlsxOf(res);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Classes",
      "Niveaux",
    ]);
  });

  test("classes : filtre niveau → un seul niveau", async ({ request }) => {
    const { school } = await demoCtx();
    const level = await prisma.level.findFirstOrThrow({
      where: { schoolId: school.id },
    });
    const res = await request.get(
      `/app/classrooms/export?format=csv&level=${level.id}`,
    );
    for (const l of rows(await res.text()))
      expect(l.split(";")[1]).toBe(level.name);
  });
});

test.describe("Exports enseignants et personnel — admin", () => {
  test.use({ storageState: "e2e/.auth/demoAdmin.json" });

  test("enseignants standard : identité seule, pas de coordonnées", async ({
    request,
  }) => {
    const res = await request.get("/app/teachers/export?format=csv");
    const h = header(await res.text());
    expect(h).toContain("nom");
    expect(h).not.toContain("email");
    expect(h).not.toContain("telephone");
  });

  test("enseignants complet : coordonnées pour teacher.manage", async ({
    request,
  }) => {
    const res = await request.get("/app/teachers/export?format=csv&full=1");
    expect(res.status()).toBe(200);
    const h = header(await res.text());
    expect(h).toContain("email");
    expect(h).toContain("telephone");
  });

  test("enseignants XLSX : feuille Affectations", async ({ request }) => {
    const { year } = await demoCtx();
    const res = await request.get(
      `/app/teachers/export?format=xlsx&year=${year.id}`,
    );
    const wb = await xlsxOf(res);
    expect(wb.worksheets.map((w) => w.name)).toContain("Affectations");
    const sheet = wb.getWorksheet("Affectations")!;
    expect(sheet.rowCount).toBeGreaterThan(1);
  });

  test("personnel : comptes et rôles, aucun secret", async ({ request }) => {
    const res = await request.get("/app/users/export?format=csv");
    expect(res.status()).toBe(200);
    const csv = await res.text();
    const h = header(csv);
    for (const col of ["email", "role", "statut_compte"])
      expect(h).toContain(col);
    expect(csv).toContain("admin@demo.local");
    expect(csv).not.toContain("$2"); // jamais de hash
    expect(csv).not.toContain("password");
  });
});

test.describe("Exports emplois du temps — admin", () => {
  test.use({ storageState: "e2e/.auth/demoAdmin.json" });

  test("créneaux récurrents : jour/heure/classe/enseignant/validité", async ({
    request,
  }) => {
    const res = await request.get("/app/schedules/export?format=csv");
    expect(res.status()).toBe(200);
    const csv = await res.text();
    const h = header(csv);
    for (const col of ["jour", "debut", "fin", "classe", "enseignant", "validite_debut"])
      expect(h).toContain(col);
    const lines = rows(csv);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toMatch(/Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche/);
    expect(lines[0]).toMatch(/\d{2}h\d{2}/);
  });

  test("semaine : dates réelles et statuts de séances", async ({ request }) => {
    const res = await request.get(
      "/app/schedules/export?format=csv&week=2026-01-12",
    );
    expect(res.status()).toBe(200);
    const csv = await res.text();
    expect(header(csv)).toContain("date");
    expect(header(csv)).toContain("statut");
  });
});

test.describe("Exports — périmètre enseignant (P5b)", () => {
  test.use({ storageState: "e2e/.auth/demoTeacher.json" });

  test("élèves : export standard autorisé, complet refusé", async ({
    request,
  }) => {
    const std = await request.get("/app/students/export?format=csv");
    expect(std.status()).toBe(200);
    expect(header(await std.text())).not.toContain("telephone");
    const full = await request.get("/app/students/export?format=csv&full=1", {
      maxRedirects: 0,
    });
    expect(full.status()).toBe(403);
  });

  test("enseignants : route réservée (pas de teacher.read)", async ({
    request,
  }) => {
    const res = await request.get("/app/teachers/export?format=csv", {
      maxRedirects: 0,
    });
    expect([301, 302, 303, 307, 403]).toContain(res.status());
  });

  test("EDT : uniquement ses propres créneaux", async ({ request }) => {
    const { school } = await demoCtx();
    const u = await prisma.user.findUniqueOrThrow({
      where: { email: "enseignant@demo.local" },
    });
    const me = await prisma.teacher.findFirstOrThrow({
      where: { schoolId: school.id, userId: u.id },
      orderBy: { createdAt: "desc" },
    });
    const res = await request.get("/app/schedules/export?format=csv");
    expect(res.status()).toBe(200);
    const lines = rows(await res.text());
    expect(lines.length).toBeGreaterThan(0);
    const myName = `${me.lastName} ${me.firstName}`;
    for (const l of lines) expect(l.split(";")[5]).toBe(myName);
  });

  test("EDT : teacher=<autre> falsifié → 403", async ({ request }) => {
    const { school } = await demoCtx();
    const u = await prisma.user.findUniqueOrThrow({
      where: { email: "enseignant@demo.local" },
    });
    const mine = await prisma.teacher.findMany({
      where: { schoolId: school.id, userId: u.id },
      select: { id: true },
    });
    const other = await prisma.teacher.findFirst({
      where: {
        schoolId: school.id,
        id: { notIn: mine.map((t) => t.id) },
      },
    });
    if (!other) test.skip();
    const res = await request.get(
      `/app/schedules/export?format=csv&teacher=${other!.id}`,
      { maxRedirects: 0 },
    );
    expect(res.status()).toBe(403);
  });
});

test.describe("Exports référentiels — isolation et permissions", () => {
  test.use({ storageState: "e2e/.auth/demoAdmin.json" });

  test("isolation : 100 % des matricules ∈ établissement courant", async ({
    request,
  }) => {
    const { school } = await demoCtx();
    const mine = new Set(
      (
        await prisma.student.findMany({
          where: { schoolId: school.id },
          select: { matricule: true },
        })
      ).map((s) => s.matricule),
    );
    for (const path of [
      "/app/students/export?format=csv",
      "/app/enrollments/export?format=csv",
    ]) {
      const csv = await (await request.get(path)).text();
      const mats = rows(csv).map((l) => l.split(";")[0]);
      expect(mats.length).toBeGreaterThan(0);
      for (const m of mats) expect(mine.has(m)).toBe(true);
    }
  });

  test("isolation : classroom=<autre école> → export vide", async ({
    request,
  }) => {
    const { school } = await demoCtx();
    const cls = await prisma.classroom.findFirst({
      where: { schoolId: { not: school.id } },
    });
    if (!cls) test.skip();
    const res = await request.get(
      `/app/students/export?format=csv&classroom=${cls!.id}`,
    );
    expect(res.status()).toBe(200);
    expect(rows(await res.text()).length).toBe(0);
  });
});

test.describe("Exports référentiels — permissions refusées", () => {
  test.use({ storageState: "e2e/.auth/demoFinance.json" });

  for (const path of [
    "/app/students/export?format=csv",
    "/app/enrollments/export?format=csv",
    "/app/classrooms/export?format=csv",
    "/app/teachers/export?format=csv",
    "/app/users/export?format=csv",
    "/app/schedules/export?format=csv",
  ]) {
    test(`finance : ${path} refusé`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      expect([301, 302, 303, 307, 403]).toContain(res.status());
    });
  }
});
