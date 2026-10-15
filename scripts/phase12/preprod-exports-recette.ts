import "dotenv/config";
import { execSync } from "node:child_process";
import { chromium, type BrowserContext, type APIResponse } from "@playwright/test";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db/prisma";

/**
 * Recette préprod P5a — exports CSV/XLSX (notes détaillées + moyennes).
 * Données de test ISOLÉES : une évaluation « P5R * <ts> » en brouillon avec
 * des notes de statuts variés, supprimée en fin de recette (légalement
 * supprimable : jamais publiée, aucun résultat n'en dépend).
 * Aucune donnée métier modifiée ; les exports doivent être lecture seule
 * (compteurs BDD vérifiés avant/après).
 *
 * Usage (tunnel SSH 127.0.0.1:15432 → preprod 5432 ouvert + env) :
 *   set -a; . $TEMP/p5env.txt; set +a
 *   npx tsx scripts/phase12/preprod-exports-recette.ts
 */

const BASE = "https://preprod.ecomschool.fr";
const PW = process.env.SEED_DEMO_PASSWORD;
const CRON_SECRET = process.env.CRON_SECRET;
if (!PW || !CRON_SECRET) {
  console.error("SEED_DEMO_PASSWORD / CRON_SECRET manquants — arrêt.");
  process.exit(1);
}
const TS = Date.now().toString(36);
const T = (s: string) => `P5R ${s} ${TS}`;

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

const statusOf = async (r: APIResponse) => r.status();
const csvText = async (r: APIResponse) => (await r.body()).toString("utf8");
const xlsx = async (r: APIResponse) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await r.body()) as unknown as ExcelJS.Buffer);
  return wb;
};
const rows = (csv: string) => csv.trim().split("\n").slice(1);

async function main() {
  const school = await prisma.school.findUniqueOrThrow({
    where: { code: "DEMO-ECOLE" }, select: { id: true },
  });
  const year = await prisma.academicYear.findFirstOrThrow({
    where: { schoolId: school.id }, orderBy: { startDate: "desc" },
    select: { id: true },
  });
  const periods = await prisma.academicPeriod.findMany({
    where: { schoolId: school.id }, select: { id: true, name: true },
  });
  const period = periods[0];
  const a0 = await prisma.assessment.findFirstOrThrow({
    where: { schoolId: school.id, status: "PUBLISHED" },
    select: {
      id: true, classroomId: true, subjectId: true, academicPeriodId: true,
      teacherId: true, typeId: true, maxScore: true, coefficient: true,
    },
  });
  const [classroom, subject, periodOfA0] = await Promise.all([
    prisma.classroom.findUniqueOrThrow({ where: { id: a0.classroomId } }),
    prisma.subject.findUniqueOrThrow({ where: { id: a0.subjectId } }),
    prisma.academicPeriod.findUniqueOrThrow({ where: { id: a0.academicPeriodId! } }),
  ]);
  // Période possédant des résultats stockés (moyennes) + classe associée.
  const storedPeriod = await prisma.studentPeriodResult.findFirstOrThrow({
    where: { schoolId: school.id },
    select: { academicPeriodId: true, classroomId: true },
  });
  const enrollments = await prisma.enrollment.findMany({
    where: {
      schoolId: school.id, classroomId: a0.classroomId, status: "ENROLLED",
    },
    select: { studentId: true }, take: 3,
  });
  const otherSchool = await prisma.school.findUniqueOrThrow({
    where: { code: "LYC-RECETTE" }, select: { id: true },
  });
  const otherSubject = await prisma.subject.findFirst({
    where: { schoolId: otherSchool.id }, select: { id: true },
  });
  const demoMatricules = new Set(
    (await prisma.student.findMany({
      where: { schoolId: school.id }, select: { matricule: true },
    })).map((s) => s.matricule),
  );
  // Périmètre enseignant réel (dernière fiche = sémantique teacherIdForUser).
  const teacherUser = await prisma.user.findUniqueOrThrow({
    where: { email: "enseignant@demo.local" },
  });
  const teacher = await prisma.teacher.findFirstOrThrow({
    where: { userId: teacherUser.id }, orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const myAssignments = await prisma.teachingAssignment.findMany({
    where: { teacherId: teacher.id },
    select: { classroomId: true, subjectId: true },
  });
  const mySubjectIds = new Set(
    myAssignments.map((a) => a.subjectId).filter((s): s is string => !!s),
  );
  const foreignSubject = await prisma.subject.findFirstOrThrow({
    where: {
      schoolId: school.id,
      id: { notIn: [...mySubjectIds] },
      assessments: { some: { schoolId: school.id } },
    },
    select: { id: true },
  });
  const otherTeacher = await prisma.teacher.findFirstOrThrow({
    where: { schoolId: school.id, id: { not: teacher.id } },
    select: { id: true },
  });

  // Compteurs avant exports (vérification « lecture seule »).
  const countBefore = {
    grade: await prisma.grade.count({ where: { schoolId: school.id } }),
    spr: await prisma.subjectPeriodResult.count({ where: { schoolId: school.id } }),
    per: await prisma.studentPeriodResult.count({ where: { schoolId: school.id } }),
    ann: await prisma.studentAnnualResult.count({ where: { schoolId: school.id } }),
  };

  // Données de test isolées : évaluation brouillon + statuts variés.
  const testAssess = await prisma.assessment.create({
    data: {
      schoolId: school.id,
      academicYearId: year.id,
      academicPeriodId: periodOfA0.id,
      classroomId: a0.classroomId,
      subjectId: a0.subjectId,
      teacherId: teacher.id,
      typeId: a0.typeId,
      title: T("Évaluation"),
      date: new Date("2026-01-20"),
      maxScore: 20,
      coefficient: 2,
      status: "DRAFT",
    },
  });
  const testGradeIds: string[] = [];
  for (const [i, enr] of enrollments.entries()) {
    const g = await prisma.grade.create({
      data: {
        schoolId: school.id,
        assessmentId: testAssess.id,
        studentId: enr.studentId,
        status: i === 0 ? "ABSENT" : i === 1 ? "EXEMPT" : "ENTERED",
        value: i === 2 ? 14.5 : null,
        observation: i === 0 ? "  =1+1" : i === 1 ? "Dispensée — raison médicale" : "Très bien",
      },
      select: { id: true },
    });
    testGradeIds.push(g.id);
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE });
  try {
    // ---------- ADMIN : export notes ----------
    const adminPage = await login(ctx, "admin@demo.local");
    await adminPage.goto("/app/grades", { waitUntil: "domcontentloaded" });
    check(
      "UI : formulaire d'export sur /app/grades (format + filtres)",
      (await adminPage.locator('form[action*="grades/export"]').count()) > 0 &&
        (await adminPage.locator('form[action*="grades/export"] select[name="format"]').count()) > 0,
    );
    await adminPage.goto(
      `/app/averages?period=${storedPeriod.academicPeriodId}&classroom=${storedPeriod.classroomId}&year=${year.id}`,
      { waitUntil: "domcontentloaded" },
    );
    check(
      "UI : liens export moyennes période + annuels sur /app/averages",
      (await adminPage.locator('a[href*="results/export"]').count()) >= 4,
      String(await adminPage.locator('a[href*="results/export"]').count()),
    );

    const csvAll = await csvText(await get(ctx, "/app/grades/export?format=csv"));
    check(
      "notes CSV : 200, BOM, en-têtes explicites",
      csvAll.startsWith("﻿matricule;nom;prenom;classe;matiere;periode"),
    );

    const csvAssess = await csvText(
      await get(ctx, `/app/grades/export?format=csv&assessment=${testAssess.id}`),
    );
    const assessRows = rows(csvAssess);
    check(
      "notes CSV : filtre évaluation → uniquement l'évaluation de test",
      assessRows.length === enrollments.length &&
        assessRows.every((r) => r.includes(T("Évaluation"))),
      `${assessRows.length} lignes`,
    );
    check(
      "notes CSV : statuts distincts (Absent/Dispensé/Saisie) + note vide, jamais 0",
      csvAssess.includes(";Absent;;") &&
        csvAssess.includes(";Dispensé;;") &&
        /;Saisie;14[,.]5;/.test(csvAssess) &&
        !/;Absent;0;/.test(csvAssess),
    );
    check(
      "notes CSV : barème (20) + coef évaluation (2) + coef matière renseignés",
      assessRows.every((r) => {
        const cells = r.split(";");
        return cells[11] === "20" && cells[12] === "2" && cells[13] !== "";
      }),
    );
    check(
      "notes CSV : injection neutralisée (espaces préfixes inclus)",
      csvAssess.includes("'  =1+1") && !csvAssess.includes(";  =1+1"),
    );
    check(
      "notes CSV : accents préservés (UTF-8+BOM)",
      csvAssess.includes("Mathématiques") || csvAssess.includes("é"),
    );

    const xAssess = await xlsx(
      await get(ctx, `/app/grades/export?format=xlsx&assessment=${testAssess.id}`),
    );
    const ws = xAssess.worksheets[0];
    check(
      "notes XLSX : feuille nommée + en-têtes + autofiltre",
      !!ws && ws.name === "Notes" &&
        ws.getRow(1).getCell(1).value === "matricule" &&
        !!ws.autoFilter,
      ws?.name,
    );
    const xObs: string[] = [];
    ws?.eachRow((row) => { xObs.push(String(row.getCell(15).value ?? "")); });
    check(
      "notes XLSX : valeur texte jamais interprétée en formule",
      xObs.some((o) => o.startsWith("'  =")),
      JSON.stringify(xObs.slice(1, 3)),
    );

    const csvClass = await csvText(
      await get(ctx, `/app/grades/export?format=csv&classroom=${a0.classroomId}&period=${a0.academicPeriodId}`),
    );
    check(
      "notes CSV : filtre classe+période combinés → toutes les lignes conformes",
      rows(csvClass).length > 0 &&
        rows(csvClass).every((r) =>
          r.includes(classroom.name) && r.includes(periodOfA0.name),
        ),
      `${rows(csvClass).length} lignes`,
    );
    const csvSubject = await csvText(
      await get(ctx, `/app/grades/export?format=csv&subject=${a0.subjectId}`),
    );
    check(
      "notes CSV : filtre matière → une seule matière",
      rows(csvSubject).length > 0 &&
        rows(csvSubject).every((r) => r.includes(subject.name)),
    );

    // ---------- ADMIN : export moyennes ----------
    const csvRes = await csvText(
      await get(
        ctx,
        `/app/results/export?format=csv&period=${storedPeriod.academicPeriodId}&classroom=${storedPeriod.classroomId}`,
      ),
    );
    const resRows = rows(csvRes);
    check(
      "moyennes CSV : en-têtes + moyennes stockées présentes",
      resRows.length > 0 &&
        csvRes.includes("moyenne") &&
        /;\d+[,.]\d+;/.test(csvRes),
      `${resRows.length} lignes`,
    );
    const xRes = await xlsx(
      await get(
        ctx,
        `/app/results/export?format=xlsx&period=${storedPeriod.academicPeriodId}&classroom=${storedPeriod.classroomId}`,
      ),
    );
    check(
      "moyennes XLSX : 2 feuilles (Synthèse + Par matière)",
      xRes.worksheets.length === 2 &&
        xRes.worksheets[0].name === "Synthèse" &&
        xRes.worksheets[1].name === "Par matière",
      xRes.worksheets.map((w) => w.name).join(","),
    );
    const csvAnnual = await csvText(
      await get(ctx, `/app/results/export?format=csv&year=${year.id}`),
    );
    check(
      "annuel CSV : 0 résultat stocké → « Non calculé » explicite",
      csvAnnual.includes("Non calculé"),
    );

    // ---------- SÉCURITÉ ----------
    // Isolation : aucun matricule étranger + filtre vers autre école = vide.
    const outMat = rows(csvAll).map((r) => r.split(";")[0]);
    check(
      "isolation : 100 % des matricules exportés ∈ établissement courant",
      outMat.length > 0 && outMat.every((m) => demoMatricules.has(m)),
      `${outMat.length} lignes`,
    );
    if (otherSubject) {
      const csvForeign = await csvText(
        await get(ctx, `/app/grades/export?format=csv&subject=${otherSubject.id}`),
      );
      check(
        "isolation : filtre subject=<autre école> → export vide (en-têtes seuls)",
        rows(csvForeign).length === 0,
      );
    }

    // ---------- ENSEIGNANT ----------
    const teacherPage = await login(ctx, "enseignant@demo.local");
    const tCtx = teacherPage.context();
    const tAll = await get(tCtx, "/app/grades/export?format=csv");
    const tRows = rows(await csvText(tAll));
    const allowedNames = new Set(
      (await prisma.subject.findMany({
        where: { id: { in: [...mySubjectIds] } }, select: { name: true },
      })).map((s) => s.name),
    );
    check(
      "enseignant : export limité à ses matières affectées",
      tRows.length > 0 &&
        tRows.every((r) => [...allowedNames].some((n) => r.includes(n))),
      `${tRows.length} lignes`,
    );
    check(
      "enseignant : teacher=<autre> falsifié → 403",
      (await statusOf(await get(tCtx, `/app/grades/export?format=csv&teacher=${otherTeacher.id}`))) === 403,
    );
    check(
      "enseignant : subject=hors affectation → 403",
      (await statusOf(await get(tCtx, `/app/grades/export?format=csv&subject=${foreignSubject.id}`))) === 403,
    );
    check(
      "enseignant : moyennes classe hors périmètre → 403",
      (await statusOf(await get(tCtx, `/app/results/export?format=csv&period=${storedPeriod.academicPeriodId}&classroom=${crypto.randomUUID()}`))) === 403,
    );

    // ---------- PERMISSIONS ----------
    const financePage = await login(ctx, "finance@demo.local");
    check(
      "finance : export notes refusé (307→/app ou 403)",
      [307, 403].includes(await statusOf(await get(financePage.context(), "/app/grades/export?format=csv"))),
    );
    check(
      "finance : export moyennes refusé",
      [307, 403].includes(await statusOf(await get(financePage.context(), `/app/results/export?format=csv&year=${year.id}`))),
    );
    const anon = await fetch(`${BASE}/app/grades/export?format=csv`, {
      redirect: "manual",
    });
    check(
      "anonyme : export sans session → redirection login",
      anon.status === 307,
      `HTTP ${anon.status} → ${anon.headers.get("location") ?? ""}`,
    );

    // ---------- LECTURE SEULE ----------
    const countAfter = {
      grade: await prisma.grade.count({ where: { schoolId: school.id } }),
      spr: await prisma.subjectPeriodResult.count({ where: { schoolId: school.id } }),
      per: await prisma.studentPeriodResult.count({ where: { schoolId: school.id } }),
      ann: await prisma.studentAnnualResult.count({ where: { schoolId: school.id } }),
    };
    check(
      "lecture seule : aucun compteur BDD modifié par les exports",
      countAfter.grade === countBefore.grade + testGradeIds.length &&
        countAfter.spr === countBefore.spr &&
        countAfter.per === countBefore.per &&
        countAfter.ann === countBefore.ann,
    );

    // ---------- NON-RÉGRESSION ----------
    const ok200 = async (p: string) =>
      (await adminPage.goto(p, { waitUntil: "domcontentloaded" }))?.status() === 200;
    check(
      "non-régression : P3 notation + bulletins + P4 annonces",
      (await ok200("/app/grading-policy")) &&
        (await ok200("/app/report-cards")) &&
        (await ok200("/app/announcements")) &&
        (await ok200("/app/grades")) &&
        (await ok200("/app/averages")),
    );
    check(
      "non-régression : portails enseignant/parent/élève",
      (await teacherPage.goto("/teacher", { waitUntil: "domcontentloaded" }))?.status() === 200 &&
        (await (await login(ctx, "parent@demo.local")).goto("/parent", { waitUntil: "domcontentloaded" }))?.status() === 200 &&
        (await (await login(ctx, "eleve@demo.local")).goto("/student", { waitUntil: "domcontentloaded" }))?.status() === 200,
    );
    const unauth = await fetch(`${BASE}/api/cron`, { method: "POST" });
    check("cron : endpoint protégé sans secret", unauth.status === 401 || unauth.status === 403, `HTTP ${unauth.status}`);
    const neighbors = execSync(
      `ssh ecomschool-preprod "curl -s -o /dev/null -w '%{http_code} ' http://127.0.0.1:3000 ; curl -s -o /dev/null -w '%{http_code}' --resolve 'wendyam-finance.com:443:127.0.0.1' https://wendyam-finance.com ; curl -s -o /dev/null -w ' %{http_code}' --resolve 'tme-machinery.com:443:127.0.0.1' https://tme-machinery.com"`,
      { timeout: 30_000 },
    ).toString().trim();
    check("voisins VPS : ecomschool+wendyam+tme HTTP 200", neighbors === "200 200 200", neighbors);
  } finally {
    // Nettoyage : notes + évaluation de test (brouillon — légalement supprimable).
    await prisma.grade.deleteMany({ where: { id: { in: testGradeIds } } });
    await prisma.assessment.delete({ where: { id: testAssess.id } }).catch(() => null);
    await ctx.close();
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
  if (failed.length) process.exit(1);
}

main().finally(() => prisma.$disconnect());
