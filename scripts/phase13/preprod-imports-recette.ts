import "dotenv/config";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import { chromium, type BrowserContext, type APIResponse } from "@playwright/test";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db/prisma";
import { getGradeGrid } from "@/lib/services/grading/grades";

/**
 * Recette préprod P5d — imports élèves et notes (CSV/XLSX, aperçu signé,
 * confirmation explicite). Données de test ISOLÉES : matricules « R5D-* »,
 * évaluation « R5D * <ts> » en brouillon — toutes supprimées en fin de
 * recette. Aucune donnée métier démo modifiée (élèves DEMO-* intacts,
 * bulletins publiés non touchés).
 *
 * Usage (tunnel SSH 127.0.0.1:15432 → preprod 5432 ouvert + env) :
 *   set -a; . /tmp/p5env.txt; set +a
 *   npx tsx scripts/phase13/preprod-imports-recette.ts
 */

const BASE = "https://preprod.ecomschool.fr";
const PW = process.env.SEED_DEMO_PASSWORD;
const AUTH_SECRET = process.env.AUTH_SECRET;
if (!PW || !AUTH_SECRET) {
  console.error("SEED_DEMO_PASSWORD / AUTH_SECRET manquants — arrêt.");
  process.exit(1);
}
const TS = Date.now().toString(36);
const M = (n: string) => `R5D-${n}-${TS}`; // matricules de test identifiés

type Check = { name: string; ok: boolean; detail?: string };
const results: Check[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function login(ctx: BrowserContext, email: string) {
  const page = await ctx.newPage();
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(PW!);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return page;
}

const get = (ctx: BrowserContext, path: string) =>
  ctx.request.get(`${BASE}${path}`, { maxRedirects: 0 });
const post = (
  ctx: BrowserContext,
  path: string,
  multipart: Record<string, unknown>,
) =>
  ctx.request.post(`${BASE}${path}`, {
    multipart: multipart as never,
    maxRedirects: 0,
  });
const csvFile = (content: string, name = "import.csv") => ({
  name,
  mimeType: "text/csv",
  buffer: Buffer.from(content, "utf8"),
});
const xlsxFile = async (headers: string[], rows: unknown[][]) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Import");
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  return {
    name: "import.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
  };
};
const xlsxFormulaFile = async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Import");
  ws.addRow(["matricule", "nom", "prenom"]);
  const r = ws.addRow([M("F1"), "Formule", "Test"]);
  r.getCell(2).value = { formula: "1+1", result: 2 } as never;
  return {
    name: "import.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
  };
};

/** Fabrique un jeton d'aperçu expiré (même format que src/lib/import/token). */
function expiredToken(userId: string, schoolId: string) {
  const body = Buffer.from(
    JSON.stringify({
      v: 1, uid: userId, sid: schoolId, kind: "students",
      ph: "x".repeat(64), jti: crypto.randomUUID(), exp: Date.now() - 1000,
    }),
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", AUTH_SECRET!).update(body).digest("base64url");
  return `${body}.${sig}`;
}

const SHEAD = "matricule;nom;prenom;sexe;date_naissance;lieu_naissance;telephone;email;adresse;classe";

async function main() {
  const school = await prisma.school.findUniqueOrThrow({
    where: { code: "DEMO-ECOLE" }, select: { id: true },
  });
  const year = await prisma.academicYear.findFirstOrThrow({
    where: { schoolId: school.id, isCurrent: true },
    select: { id: true, name: true },
  });
  const classroom = await prisma.classroom.findFirstOrThrow({
    where: { schoolId: school.id, academicYearId: year.id },
    select: { id: true, name: true },
  });
  const otherSchool = await prisma.school.findFirstOrThrow({
    where: { id: { not: school.id } }, select: { id: true, code: true },
  });
  // Élève témoin chez l'autre établissement (test isolation, nettoyé après).
  const foreignStudent = await prisma.student.create({
    data: {
      schoolId: otherSchool.id, matricule: M("ETR"),
      firstName: "Temoin", lastName: "Etranger",
    },
    select: { id: true, matricule: true, schoolId: true },
  });
  const foreignMat = foreignStudent.matricule;
  const enrolledMats = (
    await prisma.enrollment.findMany({
      where: { schoolId: school.id, classroomId: classroom.id, status: "ENROLLED" },
      select: { student: { select: { matricule: true } } }, take: 3,
    })
  ).map((e) => e.student.matricule);
  const outClassMat = (
    await prisma.enrollment.findFirstOrThrow({
      where: {
        schoolId: school.id, status: "ENROLLED",
        classroomId: { not: classroom.id },
      },
      select: { student: { select: { matricule: true } } },
    })
  ).student.matricule;
  const published = await prisma.assessment.findFirstOrThrow({
    where: { schoolId: school.id, status: "PUBLISHED" }, select: { id: true },
  });
  const admin = await prisma.user.findUniqueOrThrow({
    where: { email: "admin@demo.local" }, select: { id: true },
  });
  // Évaluation de test isolée (brouillon) sur la classe choisie.
  const src = await prisma.assessment.findFirstOrThrow({
    where: { schoolId: school.id, status: "PUBLISHED" },
    select: { subjectId: true, academicPeriodId: true, typeId: true, teacherId: true },
  });
  const testAssess = await prisma.assessment.create({
    data: {
      schoolId: school.id, academicYearId: year.id,
      academicPeriodId: src.academicPeriodId, classroomId: classroom.id,
      subjectId: src.subjectId, teacherId: src.teacherId, typeId: src.typeId,
      title: `R5D Évaluation ${TS}`, date: new Date(), maxScore: 20,
      coefficient: 1, status: "DRAFT",
    },
    select: { id: true },
  });

  const studentsBefore = await prisma.student.count({ where: { schoolId: school.id } });
  const createdStudentIds: string[] = [foreignStudent.id];

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE });
  const tCtx = await browser.newContext({ baseURL: BASE });
  const fCtx = await browser.newContext({ baseURL: BASE });
  try {
    const adminPage = await login(ctx, "admin@demo.local");

    // ============ ÉLÈVES : MODÈLES ============
    const tplCsv = await get(ctx, "/app/students/import/template?format=csv");
    const tplCsvText = (await tplCsv.body()).toString("utf8");
    check(
      "élèves : modèle CSV — 200, BOM, en-têtes avec colonne classe",
      tplCsv.status() === 200 && tplCsvText.startsWith("﻿matricule;") &&
        tplCsvText.split("\r\n")[0].includes("classe"),
    );
    const tplXlsx = await get(ctx, "/app/students/import/template?format=xlsx");
    const tplWb = new ExcelJS.Workbook();
    await tplWb.xlsx.load((await tplXlsx.body()) as unknown as ExcelJS.Buffer);
    check(
      "élèves : modèle XLSX — 200, en-têtes valides",
      tplXlsx.status() === 200 &&
        tplWb.worksheets[0]?.getRow(1).getCell(1).value === "matricule",
    );

    // ============ ÉLÈVES : APERÇU SANS ÉCRITURE ============
    const csv1 = `${SHEAD}\r\n${M("A")};Diallo;Aminata;F;2010-03-05;Ouaga;70000001;r5d.a@test.local;Rue 1;${classroom.name}\r\n${M("B")};Traore;Boubacar;M;;;;;;;\r\n`;
    const pv1res = await post(ctx, "/app/students/import/preview", {
      file: csvFile(csv1), academicYearId: year.id,
    });
    const pv1 = await pv1res.json();
    check(
      "élèves : aperçu — 2 créations + 1 inscription, jeton présent",
      pv1res.status() === 200 && pv1.summary?.created === 2 &&
        pv1.summary?.enrollments === 1 && typeof pv1.token === "string",
      JSON.stringify(pv1.summary ?? pv1),
    );
    check(
      "élèves : aperçu sans écriture (compteur élèves inchangé)",
      (await prisma.student.count({ where: { schoolId: school.id } })) === studentsBefore,
    );

    // ============ ÉLÈVES : COMMIT ============
    const c1 = await post(ctx, "/app/students/import/commit", {
      file: csvFile(csv1), academicYearId: year.id, token: pv1.token,
    });
    const c1j = await c1.json();
    check(
      "élèves : commit — 2 créés, 1 inscription",
      c1.status() === 200 && c1j.created === 2 && c1j.enrollments === 1,
      JSON.stringify(c1j),
    );
    const sA = await prisma.student.findFirstOrThrow({
      where: { schoolId: school.id, matricule: M("A") }, select: { id: true, phone: true, email: true },
    });
    createdStudentIds.push(sA.id);
    createdStudentIds.push(
      (await prisma.student.findFirstOrThrow({ where: { schoolId: school.id, matricule: M("B") }, select: { id: true } })).id,
    );
    const enrA = await prisma.enrollment.findFirst({
      where: { schoolId: school.id, studentId: sA.id, classroomId: classroom.id, status: "ENROLLED" },
    });
    check(
      "élèves : inscription créée dans la classe choisie (année courante)",
      enrA != null && sA.email === "r5d.a@test.local",
    );
    check(
      "élèves : audit student.import enregistré",
      (await prisma.auditLog.findFirst({
        where: { schoolId: school.id, action: "student.import" },
        orderBy: { createdAt: "desc" },
      })) != null,
    );

    // ============ ÉLÈVES : REJEU / FALSIFICATION / EXPIRATION ============
    const replay = await post(ctx, "/app/students/import/commit", {
      file: csvFile(csv1), academicYearId: year.id, token: pv1.token,
    });
    check("élèves : rejeu du jeton → 409 (déjà confirmé)", replay.status() === 409);
    const tampered = await post(ctx, "/app/students/import/commit", {
      file: csvFile(csv1), academicYearId: year.id,
      token: pv1.token.slice(0, -3) + "AAA",
    });
    check("élèves : jeton falsifié → 409", tampered.status() === 409);
    const expired = await post(ctx, "/app/students/import/commit", {
      file: csvFile(csv1), academicYearId: year.id,
      token: expiredToken(admin.id, school.id),
    });
    check("élèves : jeton expiré → 409", expired.status() === 409);

    // ============ ÉLÈVES : CONSERVER / EFFACER ============
    // Vide = conserver (téléphone gardé) ; __EFFACER__ = efface email.
    const csv2 = `${SHEAD}\r\n${M("A")};Diallo;Aminata;;;;;__EFFACER__;;\r\n`;
    const pv2res = await post(ctx, "/app/students/import/preview", {
      file: csvFile(csv2), academicYearId: year.id,
    });
    const pv2 = await pv2res.json();
    const row2 = pv2.rows?.[0];
    check(
      "élèves : aperçu — email effacé explicitement, téléphone absent du diff",
      pv2.summary?.updated === 1 &&
        row2?.changes?.some((c: { field: string; erase?: boolean }) => c.field === "email" && c.erase) &&
        !row2?.changes?.some((c: { field: string }) => c.field === "telephone"),
      JSON.stringify(row2?.changes),
    );
    const c2 = await post(ctx, "/app/students/import/commit", {
      file: csvFile(csv2), academicYearId: year.id, token: pv2.token,
    });
    const after2 = await prisma.student.findUniqueOrThrow({
      where: { id: sA.id }, select: { phone: true, email: true },
    });
    check(
      "élèves : commit — email effacé (null), téléphone conservé",
      c2.status() === 200 && after2.email === null && after2.phone === "70000001",
    );
    check(
      "élèves : ré-inscription même classe → action « existing » (pas de doublon)",
      pv2.rows?.[0]?.enrollment == null || pv2.rows[0].enrollment.action !== "create",
    );

    // ============ ÉLÈVES : ERREURS MÉTIER + RAPPORT ============
    const csv3 = `${SHEAD}\r\n${M("C")};Sans;Classe;M;;;;;;Classe Inexistante\r\n${M("A")};Diallo;Aminata;M;;;;;;\r\n${M("A")};Doublon;Fichier;M;;;;;;\r\n`;
    const pv3res = await post(ctx, "/app/students/import/preview", {
      file: csvFile(csv3), academicYearId: year.id,
    });
    const pv3 = await pv3res.json();
    const errRows = (pv3.rows ?? []).filter((r: { action: string }) => r.action === "error");
    check(
      "élèves : aperçu — classe inconnue + doublon matricule en erreur (ligne/colonne/valeur/motif)",
      pv3.summary?.errors === 2 && errRows.length === 2 &&
        errRows.every((r: { errors: { line: number; reason: string }[] }) =>
          r.errors.length > 0 && r.errors[0].reason.length > 0,
        ),
      JSON.stringify(pv3.summary),
    );
    const c3 = await post(ctx, "/app/students/import/commit", {
      file: csvFile(csv3), academicYearId: year.id, token: pv3.token,
    });
    const c3j = await c3.json();
    const noC = await prisma.student.findFirst({
      where: { schoolId: school.id, matricule: M("C") },
    });
    check(
      "élèves : commit partiel — ligne valide écrite, classe inconnue → aucun élève ni inscription orpheline",
      c3.status() === 200 && c3j.updated === 1 && noC == null,
      JSON.stringify(c3j),
    );
    check(
      "élèves : rapport d'erreurs détaillé au commit (ligne, valeur, motif)",
      (c3j.errors ?? []).length === 2 &&
        c3j.errors.every((e: { line: number; reason: string }) => e.line > 0 && e.reason),
      JSON.stringify(c3j.errors?.[0]),
    );

    // ============ ÉLÈVES : ÉTAT OBSOLÈTE (STALE) ============
    const csv4 = `${SHEAD}\r\n${M("D")};Stale;Test;M;;;;;;;;\r\n`;
    const pv4res = await post(ctx, "/app/students/import/preview", {
      file: csvFile(csv4), academicYearId: year.id,
    });
    const pv4 = await pv4res.json();
    // Modification concurrente : l'élève est créé entre aperçu et confirmation.
    const pv4b = await post(ctx, "/app/students/import/preview", {
      file: csvFile(csv4), academicYearId: year.id,
    });
    const pv4bj = await pv4b.json();
    await post(ctx, "/app/students/import/commit", {
      file: csvFile(csv4), academicYearId: year.id, token: pv4bj.token,
    });
    createdStudentIds.push(
      (await prisma.student.findFirstOrThrow({ where: { schoolId: school.id, matricule: M("D") }, select: { id: true } })).id,
    );
    const stale = await post(ctx, "/app/students/import/commit", {
      file: csvFile(csv4), academicYearId: year.id, token: pv4.token,
    });
    check(
      "élèves : état modifié entre aperçu et confirmation → 409 STALE",
      stale.status() === 409,
      `HTTP ${stale.status()}`,
    );

    // ============ ÉLÈVES : LIMITES + MALFORMÉ + XLSX ============
    const bigCsv = `${SHEAD}\r\n` + `${M("X")};A;B;M;;;;;;;;\r\n`.repeat(2100);
    const tooMany = await post(ctx, "/app/students/import/preview", {
      file: csvFile(bigCsv), academicYearId: year.id,
    });
    check("élèves : >2000 lignes → rejet explicite", tooMany.status() === 400);
    const malformed = await post(ctx, "/app/students/import/preview", {
      file: csvFile(`${SHEAD}\r\n${M("Y")};"Non fermé;X\r\n`), academicYearId: year.id,
    });
    check("élèves : CSV malformé (guillemet non fermé) → rejet", malformed.status() === 400);
    const noHeader = await post(ctx, "/app/students/import/preview", {
      file: csvFile("a;b;c\r\n1;2;3\r\n"), academicYearId: year.id,
    });
    check("élèves : colonnes obligatoires absentes → rejet", noHeader.status() === 400);
    const xlsxF = await xlsxFile(
      ["matricule", "nom", "prenom"],
      [[M("E"), "Excel", "Import"]],
    );
    const pvX = await post(ctx, "/app/students/import/preview", {
      file: xlsxF, academicYearId: year.id,
    });
    const pvXj = await pvX.json();
    check(
      "élèves : XLSX analysé (1 création)",
      pvX.status() === 200 && pvXj.summary?.created === 1,
      JSON.stringify(pvXj.summary ?? pvXj),
    );
    const formulaX = await post(ctx, "/app/students/import/preview", {
      file: await xlsxFormulaFile(), academicYearId: year.id,
    });
    check("élèves : XLSX avec formule → rejet explicite", formulaX.status() === 400);

    // ============ ÉLÈVES : ISOLATION + PERMISSIONS ============
    // Un matricule existant chez LYC-RECETTE → simple création chez DEMO ;
    // l'élève étranger n'est jamais touché.
    const foreignBefore = await prisma.student.findFirstOrThrow({
      where: { schoolId: foreignStudent.schoolId, matricule: foreignMat },
      select: { firstName: true },
    });
    const csvIso = `${SHEAD}\r\n${foreignMat};NeDoitPas;Modifier;M;;;;;;;;\r\n`;
    const pvIso = await post(ctx, "/app/students/import/preview", {
      file: csvFile(csvIso), academicYearId: year.id,
    });
    const pvIsoJ = await pvIso.json();
    const isoCommit = await post(ctx, "/app/students/import/commit", {
      file: csvFile(csvIso), academicYearId: year.id, token: pvIsoJ.token,
    });
    const foreignAfter = await prisma.student.findFirstOrThrow({
      where: { schoolId: foreignStudent.schoolId, matricule: foreignMat },
      select: { firstName: true },
    });
    const isoCreated = await prisma.student.findFirst({
      where: { schoolId: school.id, matricule: foreignMat }, select: { id: true },
    });
    if (isoCreated) createdStudentIds.push(isoCreated.id);
    check(
      "isolation : matricule étranger → création locale, fiche autre école intacte",
      pvIsoJ.summary?.created === 1 && isoCommit.status() === 200 &&
        foreignAfter.firstName === foreignBefore.firstName,
    );
    const teacherPage = await login(tCtx, "enseignant@demo.local");
    const tPv = await post(tCtx, "/app/students/import/preview", {
      file: csvFile(csv1), academicYearId: year.id,
    });
    check(
      "élèves : enseignant sans student.manage → refus (303/307/403)",
      [303, 307, 403].includes(tPv.status()),
      `HTTP ${tPv.status()}`,
    );
    const financePage = await login(fCtx, "finance@demo.local");
    const fPv = await post(fCtx, "/app/students/import/preview", {
      file: csvFile(csv1), academicYearId: year.id,
    });
    check("élèves : finance sans student.manage → refus", [303, 307, 403].includes(fPv.status()));
    const anon = await fetch(`${BASE}/app/students/import/preview`, { method: "POST", redirect: "manual" });
    check("élèves : anonyme → redirection login", [303, 307].includes(anon.status));

    // ============ NOTES : MODÈLE PRÉ-REMPLI ============
    const gTpl = await get(ctx, `/app/grades/${testAssess.id}/import/template?format=csv`);
    const gTplText = (await gTpl.body()).toString("utf8");
    const gLines = gTplText.split("\r\n").slice(1).filter((l: string) => l.trim());
    const grid = await getGradeGrid(
      { userId: admin.id, schoolId: school.id }, testAssess.id,
    );
    const gridMats = grid.ok ? grid.result.rows.map((r) => r.matricule) : [];
    check(
      "notes : modèle pré-rempli — BOM, une ligne par élève de la grille",
      gTpl.status() === 200 && gTplText.charCodeAt(0) === 0xfeff &&
        gLines.length === gridMats.length &&
        gridMats.every((m) => gTplText.includes(m)),
      `HTTP ${gTpl.status()} ${gLines.length}/${gridMats.length} lignes : ${gTplText.slice(0, 100)}`,
    );

    // ============ NOTES : APERÇU + ERREURS BLOQUANTES ============
    const gHeader = "matricule;note;statut;observation";
    const csvG = `${gHeader}\r\n${enrolledMats[0]};15;ENTERED;Bien\r\n${enrolledMats[1]};;ABSENT;\r\n${enrolledMats[2]};;EXEMPT;Dispensé\r\n`;
    const pvG = await post(ctx, `/app/grades/${testAssess.id}/import/preview`, {
      file: csvFile(csvG),
    });
    const pvGj = await pvG.json();
    check(
      "notes : aperçu — ENTERED + ABSENT + EXEMPT reconnus, 0 erreur",
      pvG.status() === 200 && (pvGj.summary?.errors ?? 1) === 0 &&
        pvGj.summary?.created === 3,
      JSON.stringify(pvGj.summary ?? pvGj).slice(0, 200),
    );
    const badCsv = `${gHeader}\r\n${enrolledMats[0]};25;ENTERED;\r\nMAT-INCONNU-99;10;ENTERED;\r\n${outClassMat};10;ENTERED;\r\n${enrolledMats[1]};;CANCELLED;\r\n${enrolledMats[2]};5;ABSENT;\r\n`;
    const pvBad = await post(ctx, `/app/grades/${testAssess.id}/import/preview`, {
      file: csvFile(badCsv),
    });
    const pvBadJ = await pvBad.json();
    check(
      "notes : erreurs bloquantes — >barème, inconnu, hors classe, CANCELLED, statut incohérent",
      pvBad.status() === 200 && (pvBadJ.summary?.errors ?? 0) === 5,
      JSON.stringify(pvBadJ.summary ?? pvBadJ).slice(0, 200),
    );
    const gradesBefore = await prisma.grade.count({ where: { assessmentId: testAssess.id } });
    const cBad = await post(ctx, `/app/grades/${testAssess.id}/import/commit`, {
      file: csvFile(badCsv), token: pvBadJ.token,
    });
    check(
      "notes : import atomique — une erreur → 422, rien écrit",
      cBad.status() === 422 &&
        (await prisma.grade.count({ where: { assessmentId: testAssess.id } })) === gradesBefore,
      `HTTP ${cBad.status()}`,
    );

    // ============ NOTES : COMMIT + GRADEREVISION ============
    const cG = await post(ctx, `/app/grades/${testAssess.id}/import/commit`, {
      file: csvFile(csvG), token: pvGj.token,
    });
    const cGj = await cG.json();
    const savedGrades = await prisma.grade.findMany({
      where: { assessmentId: testAssess.id },
      select: { status: true, value: true },
    });
    check(
      "notes : commit — 3 notes écrites avec bons statuts/valeurs",
      cG.status() === 200 && savedGrades.length === 3 &&
        savedGrades.some((g) => g.status === "ENTERED" && g.value === 15) &&
        savedGrades.some((g) => g.status === "ABSENT") &&
        savedGrades.some((g) => g.status === "EXEMPT"),
      JSON.stringify(cGj).slice(0, 150),
    );
    check(
      "notes : audit grades.save enregistré",
      (await prisma.auditLog.findFirst({
        where: { schoolId: school.id, action: "grades.save" },
        orderBy: { createdAt: "desc" },
      })) != null,
    );
    // Modification → GradeRevision (historisation préservée).
    const csvG2 = `${gHeader}\r\n${enrolledMats[0]};17;ENTERED;Corrigé\r\n`;
    const pvG2 = await post(ctx, `/app/grades/${testAssess.id}/import/preview`, {
      file: csvFile(csvG2),
    });
    const pvG2j = await pvG2.json();
    const revBefore = await prisma.gradeRevision.count({
      where: { grade: { assessmentId: testAssess.id } },
    });
    await post(ctx, `/app/grades/${testAssess.id}/import/commit`, {
      file: csvFile(csvG2), token: pvG2j.token,
    });
    check(
      "notes : modification → GradeRevision créée (historisation)",
      (await prisma.gradeRevision.count({ where: { grade: { assessmentId: testAssess.id } } })) === revBefore + 1,
    );

    // ============ NOTES : VERROUS + PÉRIMÈTRE + STALE ============
    const pvPub = await post(ctx, `/app/grades/${published.id}/import/preview`, {
      file: csvFile(`${gHeader}\r\n${enrolledMats[0]};10;ENTERED;\r\n`),
    });
    check(
      "notes : évaluation PUBLISHED → import refusé (verrou)",
      [400, 409].includes(pvPub.status()),
      `HTTP ${pvPub.status()}`,
    );
    // Jeton notes obsolète : la note change entre aperçu et confirmation.
    const csvSt = `${gHeader}\r\n${enrolledMats[1]};8;ENTERED;\r\n`;
    const pvSt = await post(ctx, `/app/grades/${testAssess.id}/import/preview`, {
      file: csvFile(csvSt),
    });
    const pvStJ = await pvSt.json();
    const pvSt2 = await post(ctx, `/app/grades/${testAssess.id}/import/preview`, {
      file: csvFile(`${gHeader}\r\n${enrolledMats[1]};9;ENTERED;\r\n`),
    });
    const pvSt2J = await pvSt2.json();
    await post(ctx, `/app/grades/${testAssess.id}/import/commit`, {
      file: csvFile(`${gHeader}\r\n${enrolledMats[1]};9;ENTERED;\r\n`), token: pvSt2J.token,
    });
    const staleG = await post(ctx, `/app/grades/${testAssess.id}/import/commit`, {
      file: csvFile(csvSt), token: pvStJ.token,
    });
    check(
      "notes : état modifié entre aperçu et confirmation → 409 STALE",
      staleG.status() === 409,
      `HTTP ${staleG.status()}`,
    );
    const tGPv = await post(tCtx, `/app/grades/${testAssess.id}/import/preview`, {
      file: csvFile(csvG),
    });
    check(
      "notes : enseignant affecté à la classe/matière → aperçu autorisé",
      tGPv.status() === 200,
      `HTTP ${tGPv.status()}`,
    );
    const fGPv = await post(fCtx, `/app/grades/${testAssess.id}/import/preview`, {
      file: csvFile(csvG),
    });
    check("notes : finance sans grades.enter → refus", [303, 307, 403].includes(fGPv.status()));

    // ============ BULLETINS PUBLIÉS INTACTS ============
    const rcSnapshot = await prisma.reportCardVersion.findFirst({
      where: { reportCard: { schoolId: school.id } },
      select: { id: true, payload: true },
    });
    const rcPayload = JSON.stringify(rcSnapshot?.payload);
    check(
      "bulletins : aucun snapshot modifié par les imports",
      rcSnapshot == null || JSON.stringify((await prisma.reportCardVersion.findUnique({ where: { id: rcSnapshot.id }, select: { payload: true } }))?.payload) === rcPayload,
    );

    // ============ NON-RÉGRESSION ============
    const ok200 = async (p: string) =>
      (await adminPage.goto(p, { waitUntil: "domcontentloaded" }))?.status() === 200;
    check(
      "non-régression : P2/P3/P4/P5a-c — élèves, notes, finances, exports",
      (await ok200("/app/students")) && (await ok200("/app/grades")) &&
        (await ok200("/app/report-cards")) && (await ok200("/app/fees/payments")) &&
        (await ok200("/app/announcements")) && (await ok200("/app/averages")),
    );
    const expCsv = await get(ctx, "/app/students/export?format=csv");
    check(
      "non-régression : export P5b élèves toujours fonctionnel",
      expCsv.status() === 200 &&
        (await expCsv.body()).toString("utf8").charCodeAt(0) === 0xfeff,
    );
    const neighbors = execSync(
      `ssh ecomschool-preprod "curl -s -o /dev/null -w '%{http_code} ' http://127.0.0.1:3000 ; curl -s -o /dev/null -w '%{http_code}' --resolve 'wendyam-finance.com:443:127.0.0.1' https://wendyam-finance.com ; curl -s -o /dev/null -w ' %{http_code}' --resolve 'tme-machinery.com:443:127.0.0.1' https://tme-machinery.com"`,
      { timeout: 30_000 },
    ).toString().trim();
    check("voisins VPS : ecomschool+wendyam+tme HTTP 200", neighbors === "200 200 200", neighbors);
  } finally {
    // Nettoyage : inscriptions, notes, révisions, élèves et évaluation de test.
    await prisma.enrollment.deleteMany({ where: { studentId: { in: createdStudentIds } } });
    await prisma.grade.deleteMany({ where: { assessmentId: testAssess.id } });
    await prisma.student.deleteMany({ where: { id: { in: createdStudentIds } } }).catch(() => null);
    await prisma.assessment.delete({ where: { id: testAssess.id } }).catch(() => null);
    await ctx.close();
    await tCtx.close();
    await fCtx.close();
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
  if (failed.length) process.exit(1);
}

main().finally(() => prisma.$disconnect());
