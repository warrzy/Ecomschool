/**
 * Recette F2-E — Filtres élèves (année/classe/statut/q) + export de la sélection.
 *
 * Partie 1 — services sur fixtures dédiées « École F2E-Filtres » :
 * transferts, multi-années, non-inscrit, archivé, doublons, pagination, export.
 * Partie 2 — UI authentifiée sur l'école démo (26 élèves en « 6e A (démo) »).
 *
 * Usage : npx tsx scripts/f2e/students-filters-recette.ts
 * Env : F2_BASE_URL (défaut http://localhost:3000), SEED_DEMO_PASSWORD (admin démo).
 */
import "dotenv/config";
import { chromium, type Browser, type Page } from "@playwright/test";
import { prisma } from "../../src/lib/db/prisma";
import { listStudents } from "../../src/lib/services/students";
import { buildStudentsExport } from "../../src/lib/export/students";

const BASE = process.env.F2_BASE_URL ?? "http://localhost:3000";
const ADMIN_PW = process.env.SEED_DEMO_PASSWORD ?? process.env.F2_TEST_PASSWORD;

let pass = 0, fail = 0, skip = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};
const note = (n: string) => { skip++; console.log(`  SKIP ${n}`); };

// ---------- Fixtures ----------
const FX = "F2E-FILTRES";
async function fixtures() {
  // Nettoyage idempotent : les relations Restrict imposent l'ordre.
  const old = await prisma.school.findFirst({ where: { name: FX }, select: { id: true } });
  if (old) {
    await prisma.enrollment.deleteMany({ where: { schoolId: old.id } });
    await prisma.student.deleteMany({ where: { schoolId: old.id } });
    await prisma.classroom.deleteMany({ where: { schoolId: old.id } });
    await prisma.level.deleteMany({ where: { schoolId: old.id } });
    await prisma.academicYear.deleteMany({ where: { schoolId: old.id } });
    await prisma.school.delete({ where: { id: old.id } });
  }
  const school = await prisma.school.create({
    data: { name: FX, code: FX, slug: "f2e-filtres" },
  });
  const y1 = await prisma.academicYear.create({
    data: { schoolId: school.id, name: "F2E-2024-2025", startDate: new Date("2024-09-01"), endDate: new Date("2025-06-30") },
  });
  const y2 = await prisma.academicYear.create({
    data: { schoolId: school.id, name: "F2E-2025-2026", startDate: new Date("2025-09-01"), endDate: new Date("2026-06-30"), isCurrent: true },
  });
  const level = await prisma.level.create({
    data: { schoolId: school.id, name: "F2E-6e", order: 1 },
  });
  const mk = (name: string, academicYearId: string) =>
    prisma.classroom.create({
      data: { schoolId: school.id, name, academicYearId, levelId: level.id },
    });
  const cY1A = await mk("F2E 6e A", y1.id);
  const cA = await mk("F2E 6e A", y2.id);
  const cB = await mk("F2E 6e B", y2.id);
  const cEmpty = await mk("F2E 5e A", y2.id);

  const mkSt = (matricule: string, status: "ACTIVE" | "ARCHIVED" = "ACTIVE") =>
    prisma.student.create({
      data: { schoolId: school.id, matricule, firstName: "Etu", lastName: matricule, status },
    });
  const mkEnr = (studentId: string, classroomId: string, academicYearId: string, status: "ENROLLED" | "TRANSFERRED" = "ENROLLED") =>
    prisma.enrollment.create({
      data: { schoolId: school.id, studentId, classroomId, academicYearId, status },
    });

  // 01-05 : inscrits Y2 en 6e A — 06 : Y2 6e B — 09 : archivé Y2 6e A
  for (const i of ["01", "02", "03", "04", "05"]) {
    const s = await mkSt(`F2E-${i}`);
    await mkEnr(s.id, cA.id, y2.id);
  }
  const s06 = await mkSt("F2E-06"); await mkEnr(s06.id, cB.id, y2.id);
  const s09 = await mkSt("F2E-09", "ARCHIVED"); await mkEnr(s09.id, cA.id, y2.id);
  // 07 : transféré — Y1 6e A (TRANSFERRED) puis Y2 6e B (ENROLLED)
  const s07 = await mkSt("F2E-07");
  await mkEnr(s07.id, cY1A.id, y1.id, "TRANSFERRED");
  await mkEnr(s07.id, cB.id, y2.id);
  // 08 : jamais inscrit — 10 : uniquement en Y1
  const s08 = await mkSt("F2E-08");
  const s10 = await mkSt("F2E-10"); await mkEnr(s10.id, cY1A.id, y1.id);
  // 11 : transfert interne Y2 — 6e A (TRANSFERRED) puis 6e B (ENROLLED)
  const s11 = await mkSt("F2E-11");
  await mkEnr(s11.id, cA.id, y2.id, "TRANSFERRED");
  await mkEnr(s11.id, cB.id, y2.id);

  return { school, y1, y2, cY1A, cA, cB, cEmpty, s08 };
}

// ---------- Partie 1 : services ----------
async function serviceChecks() {
  console.log("== SERVICES (fixtures École F2E-Filtres) ==");
  const f = await fixtures();
  const ctx = { userId: "recette-f2e", schoolId: f.school.id };
  const ids = (items: { matricule: string }[]) => items.map((s) => s.matricule).sort();

  let r = await listStudents(ctx, {});
  check("sans filtre : 11 élèves", r.total === 11);

  r = await listStudents(ctx, { academicYearId: f.y2.id });
  check("année Y2 : 9 élèves (exclut non-inscrit et Y1-only)", r.total === 9);
  check("année Y2 : F2E-08 absent, F2E-10 absent",
    !ids(r.items).includes("F2E-08") && !ids(r.items).includes("F2E-10"));

  r = await listStudents(ctx, { academicYearId: f.y2.id, classroomId: f.cA.id });
  check("année Y2 + classe 6e A : 7 (inclut archivé + transférée F2E-11)", r.total === 7);

  r = await listStudents(ctx, { academicYearId: f.y2.id, classroomId: f.cA.id, status: "ACTIVE" });
  check("année + classe + actifs : 6", r.total === 6);
  check("archivé F2E-09 exclu du filtre actif", !ids(r.items).includes("F2E-09"));

  r = await listStudents(ctx, { academicYearId: f.y2.id, classroomId: f.cA.id, status: "ACTIVE", q: "F2E-01" });
  check("q + année + classe : F2E-01 uniquement", r.total === 1 && r.items[0].matricule === "F2E-01");

  r = await listStudents(ctx, { academicYearId: f.y2.id, classroomId: f.cEmpty.id });
  check("classe vide : 0 élève", r.total === 0);

  r = await listStudents(ctx, { academicYearId: f.y2.id, classroomId: f.cB.id });
  const bIds = ids(r.items);
  check("6e B Y2 : 3 élèves (06, 07 transférée, 11)", r.total === 3 && bIds.includes("F2E-07") && bIds.includes("F2E-11"));

  r = await listStudents(ctx, { academicYearId: f.y2.id, classroomId: f.cA.id });
  check("transférée F2E-11 conserve son historique 6e A",
    ids(r.items).includes("F2E-11"));

  r = await listStudents(ctx, { academicYearId: f.y1.id, classroomId: f.cY1A.id });
  check("Y1 6e A : F2E-07 + F2E-10 (inscription TRANSFERRED visible)",
    r.total === 2 && ids(r.items).includes("F2E-07") && ids(r.items).includes("F2E-10"));

  r = await listStudents(ctx, { academicYearId: f.y2.id, pageSize: 3, page: 2 });
  check("pagination filtrée : total 9, page 2 = 3 élèves", r.total === 9 && r.items.length === 3);
  const p1 = await listStudents(ctx, { academicYearId: f.y2.id, pageSize: 3, page: 1 });
  check("pagination sans doublon entre pages",
    new Set([...ids(p1.items), ...ids(r.items)]).size === 6);

  // F2E-11 a 2 inscriptions en Y2 → une seule ligne dans les résultats
  r = await listStudents(ctx, { academicYearId: f.y2.id });
  const occ = r.items.filter((s) => s.matricule === "F2E-11").length;
  check("élève à 2 inscriptions (transfert interne) : 1 seule ligne",
    r.items.length === 9 && occ === 1);

  // Export — mêmes règles, toute la sélection
  let e = await buildStudentsExport(ctx, { academicYearId: f.y2.id, classroomId: f.cA.id });
  check("export Y2+6e A : 7 lignes (inclut archivé + transférée)", e.rows.length === 7 && !e.truncated);
  e = await buildStudentsExport(ctx, { academicYearId: f.y2.id, classroomId: f.cA.id, status: "ACTIVE" });
  check("export Y2+6e A actifs : 6 lignes", e.rows.length === 6);
  e = await buildStudentsExport(ctx, { academicYearId: f.y2.id, q: "F2E-0" });
  check("export année + q : cohérent avec la liste",
    e.rows.length === (await listStudents(ctx, { academicYearId: f.y2.id, q: "F2E-0" })).total);
  e = await buildStudentsExport(ctx, {});
  check("export sans filtre : 11 lignes, pas tronqué", e.rows.length === 11 && !e.truncated);

  // Isolation : mêmes filtres sur l'école démo → aucun élève F2E
  const demo = await prisma.school.findFirst({ where: { name: { contains: "Démo" } }, select: { id: true } });
  if (demo) {
    const leak = await listStudents({ userId: "x", schoolId: demo.id }, { q: "F2E-" });
    check("isolation : aucun élève F2E visible depuis l'école démo", leak.total === 0);
  } else note("isolation : école démo introuvable");

  // Enregistre les ids pour la partie UI si besoin
  return f;
}

// ---------- Partie 2 : UI authentifiée (école démo) ----------
async function login(browser: Browser): Promise<Page | null> {
  if (!ADMIN_PW) { note("UI : SEED_DEMO_PASSWORD/F2_TEST_PASSWORD absent"); return null; }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel(/email|e-mail/i).waitFor({ state: "visible" });
    await page.waitForTimeout(3000);
    await page.getByLabel(/email|e-mail/i).fill("admin@demo.local");
    await page.getByLabel(/mot de passe/i).fill(ADMIN_PW);
    await page.getByRole("button", { name: /connexion|se connecter/i }).click();
    await page.waitForFunction(
      () => !location.pathname.includes("/login"),
      undefined,
      { timeout: 120000 },
    );
    return page;
  } catch (e) {
    note(`UI : connexion admin impossible — ${(e as Error).message.slice(0, 160)}`);
    await ctx.close();
    return null;
  }
}

async function uiChecks(browser: Browser) {
  console.log("\n== UI AUTHENTIFIÉE (école démo) ==");
  const page = await login(browser);
  if (!page) return;
  try {
    const demo = await prisma.school.findFirst({ where: { name: { contains: "Démo" } }, select: { id: true } });
    const year = await prisma.academicYear.findFirst({ where: { schoolId: demo!.id }, select: { id: true } });
    const cls = await prisma.classroom.findFirst({ where: { schoolId: demo!.id, name: { contains: "6e A" } }, select: { id: true } });
    if (!year || !cls) { note("UI : fixtures démo absentes"); return; }

    await page.goto(`${BASE}/app/students`, { waitUntil: "domcontentloaded" });
    check("UI : selects année et classe présents",
      (await page.locator('select[name="year"]').count()) >= 2 &&
      (await page.locator('select[name="classroom"]').count()) >= 2);
    check("UI : option « Tous » sur le statut",
      await page.locator('select[name="status"] option[value="ALL"]').count() >= 1);
    check("UI : bouton Réinitialiser", (await page.getByRole("link", { name: /réinitialiser/i }).count()) >= 1);
    check("UI : action « Exporter la liste »", (await page.getByRole("button", { name: /exporter la liste/i }).count()) >= 1);

    // Filtre année + classe + actifs
    await page.locator('form:has(input[name="q"]) select[name="year"]').selectOption(year.id);
    await page.locator('form:has(input[name="q"]) select[name="classroom"]').selectOption(cls.id);
    await page.locator('form:has(input[name="q"]) select[name="status"]').selectOption("ACTIVE");
    await page.getByRole("button", { name: /^filtrer$/i }).first().click();
    await page.waitForFunction(
      () => location.search.includes("classroom="),
      undefined,
      { timeout: 60000 },
    );
    await page.waitForLoadState("networkidle");
    check("UI : URL porte les filtres (survit à l'actualisation)",
      page.url().includes(`year=${year.id}`) && page.url().includes(`classroom=${cls.id}`));
    const body = await page.locator("body").innerText();
    check("UI : compteur « 26 élèves » en 6e A", body.includes("26 élève"));

    // Réinitialiser
    await page.getByRole("link", { name: /réinitialiser/i }).click();
    await page.waitForFunction(
      () => !location.search.includes("classroom="),
      undefined,
      { timeout: 60000 },
    );
    check("UI : réinitialiser purge les paramètres",
      !page.url().includes("year=") && !page.url().includes("classroom="));

    // Export CSV de la sélection — via contexte authentifié
    const res = await page.context().request.get(
      `${BASE}/app/students/export?format=csv&year=${year.id}&classroom=${cls.id}&status=ACTIVE`);
    check("export CSV sélection : HTTP 200", res.ok());
    const csv = await res.text();
    check("export CSV sélection : 26 lignes + en-tête",
      csv.trim().split("\n").length === 27 && csv.includes("matricule"));
    const resX = await page.context().request.get(
      `${BASE}/app/students/export?format=xlsx&year=${year.id}&classroom=${cls.id}&status=ACTIVE`);
    check("export XLSX sélection : HTTP 200 + zip", resX.ok() && (await resX.body()).subarray(0, 2).toString() === "PK");
  } catch (e) {
    fail++; console.log(`  FAIL UI exception : ${(e as Error).message}`);
  } finally {
    await page.context().close();
  }
}

// ---------- Main ----------
(async () => {
  await serviceChecks();
  const browser = await chromium.launch();
  try { await uiChecks(browser); } finally { await browser.close(); }
  console.log(`\n=== BILAN : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
})();
