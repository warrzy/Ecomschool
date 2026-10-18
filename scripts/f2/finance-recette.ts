/**
 * Lot F2-C — Recette authentifiée des espaces financiers (LOCAL uniquement).
 *
 * Pré-requis : `npm run dev` sur :3000 + `npx tsx scripts/f2/test-fixtures.ts`.
 * Couvre : caissier Essentiel (overrides démo), deux caissiers, responsable
 * financier, admin, second établissement, accès directs URL, reçus PDF,
 * recherche élève, filtres et totaux.
 * Aucune écriture métier (aucun encaissement/annulation/clôture/envoi).
 *
 * Exécution : npx tsx scripts/f2/finance-recette.ts
 */
import "dotenv/config";
import { chromium, type Browser, type Page } from "@playwright/test";
import { prisma } from "../../src/lib/db/prisma";

const BASE = process.env.F2_BASE_URL ?? "http://localhost:3000";
const PW = process.env.F2_TEST_PASSWORD ?? "F2-Test-2026!";
// phase=essentiel (overrides démo actifs) | premium (overrides réinitialisés)
const PHASE = (() => {
  const i = process.argv.indexOf("--phase");
  return i >= 0 ? process.argv[i + 1] : "essentiel";
})();

let pass = 0;
let fail = 0;
let skip = 0;
const check = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); }
};
const note = (name: string) => { skip++; console.log(`  SKIP ${name}`); };

async function login(browser: Browser, email: string, label: string, pw = PW): Promise<Page | null> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  // Dev server : attendre l'hydratation React avant de remplir les contrôles.
  await page.getByLabel(/email|e-mail/i).waitFor({ state: "visible" });
  await page.waitForTimeout(2000);
  await page.getByLabel(/email|e-mail/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(pw);
  await page.getByRole("button", { name: /connexion|se connecter/i }).click();
  try {
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 });
  } catch {
    note(`${label} : connexion impossible`);
    await ctx.close();
    return null;
  }
  return page;
}

async function expectAccess(page: Page, path: string, allowed: boolean, label: string) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  const maxWait = allowed ? 8000 : 12000;
  const t0 = Date.now();
  let forbidden = page.url().includes("/forbidden");
  while (!forbidden && Date.now() - t0 < maxWait) {
    await page.waitForTimeout(600);
    forbidden = page.url().includes("/forbidden");
  }
  check(`${label} ${path} → ${allowed ? "autorisé" : "refusé"}`, forbidden === !allowed);
}

async function pageText(page: Page, path: string): Promise<string> {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  return page.locator("body").innerText();
}

async function main() {
  // Résolution des identifiants de test en base.
  const demo = await prisma.school.findFirstOrThrow({
    where: { name: { contains: "Démo" } },
    select: { id: true },
  });
  const year = await prisma.academicYear.findFirstOrThrow({
    where: { schoolId: demo.id, isCurrent: true },
    select: { id: true },
  });
  const cashierA = await prisma.user.findUniqueOrThrow({
    where: { email: "f2-caissier-a@test.local" },
    select: { id: true },
  });
  const receiptA = await prisma.payment.findFirstOrThrow({
    where: { schoolId: demo.id, receivedById: cashierA.id },
    select: { id: true, receiptNumber: true },
  });
  const cashierB = await prisma.user.findUniqueOrThrow({
    where: { email: "f2-caissier-b@test.local" },
    select: { id: true },
  });
  const receiptB = await prisma.payment.findFirstOrThrow({
    where: { schoolId: demo.id, receivedById: cashierB.id },
    select: { id: true, receiptNumber: true },
  });
  console.log(`Recette : reçu A=${receiptA.receiptNumber} reçu B=${receiptB.receiptNumber}`);

  const browser = await chromium.launch();

  // ---------- Caissier A (école démo sous overrides Essentiel) ----------
  if (PHASE === "essentiel") {
  console.log("\n== CASHIER A — Essentiel (overrides démo) ==");
  const pa = await login(browser, "f2-caissier-a@test.local", "caissier A");
  if (pa) {
    await expectAccess(pa, "/app/fees/my-payments", true, "A");
    const mine = await pageText(pa, "/app/fees/my-payments");
    check("A voit son reçu", mine.includes(receiptA.receiptNumber!));
    check("A ne voit pas le reçu de B", !mine.includes(receiptB.receiptNumber!));
    check("A : total affiché", /total/i.test(mine));
    // Recherche dans son journal.
    const searchMine = await pageText(
      pa,
      `/app/fees/my-payments?q=${encodeURIComponent(receiptA.receiptNumber!)}`,
    );
    check("A : recherche par n° reçu", searchMine.includes(receiptA.receiptNumber!));
    // Journal global refusé + autres écrans.
    await expectAccess(pa, "/app/fees/payments", false, "A");
    await expectAccess(pa, "/app/fees/unpaid", false, "A");
    await expectAccess(pa, "/app/fees/settings", false, "A");
    await expectAccess(pa, `/app/fees/accounts/export?format=csv&year=${year.id}`, false, "A");
    // Recherche financière élève.
    const accounts = await pageText(pa, "/app/fees/accounts?q=DEMO");
    check("A : recherche élève par matricule", /DEMO-\d+/.test(accounts));
    const noHit = await pageText(pa, "/app/fees/accounts?q=zzz-introuvable");
    check("A : état vide recherche", noHit.toLowerCase().includes("aucun"));
    // Reçu PDF autorisé pour SON reçu.
    const pdf = await pa.request.get(
      `${BASE}/app/fees/receipts/pdf?payment=${receiptA.id}`,
    );
    check("A : PDF de son reçu", pdf.status() === 200);
    // Mais le PDF d'un reçu d'un AUTRE caissier de la même école passe aussi
    // (permission receipts.print couvre l'école entière — comportement existant).
    const pdfB = await pa.request.get(
      `${BASE}/app/fees/receipts/pdf?payment=${receiptB.id}`,
    );
    check("A : PDF reçu de B (comportement existant)", pdfB.status() === 200);
    await pa.context().close();
  }

  // ---------- Caissier B — séparation ----------
  console.log("\n== CASHIER B — séparation ==");
  const pb = await login(browser, "f2-caissier-b@test.local", "caissier B");
  if (pb) {
    const mineB = await pageText(pb, "/app/fees/my-payments");
    check("B voit son reçu", mineB.includes(receiptB.receiptNumber!));
    check("B ne voit pas le reçu de A", !mineB.includes(receiptA.receiptNumber!));
    await pb.context().close();
  }

  // ---------- FINANCE_MANAGER — sous Essentiel (frontière CORE/MGMT) ----------
  console.log("\n== FINANCE_MANAGER — Essentiel ==");
  const pfmE = await login(browser, "f2-finance@test.local", "FM (Essentiel)");
  if (pfmE) {
    await expectAccess(pfmE, "/app/fees/payments", true, "FM-Essentiel");
    await expectAccess(pfmE, "/app/fees/unpaid", true, "FM-Essentiel");
    await expectAccess(pfmE, "/app/fees/settings", false, "FM-Essentiel");
    await expectAccess(pfmE, "/app/fees/my-payments", true, "FM-Essentiel");
    await pfmE.context().close();
  }
  } // fin phase essentiel

  if (PHASE === "premium") {
    // ---------- FINANCE_MANAGER — Premium (toutes fonctions) ----------
    console.log("\n== FINANCE_MANAGER — Premium ==");
    const pfm = await login(browser, "f2-finance@test.local", "FM (Premium)");
    if (pfm) {
      await expectAccess(pfm, "/app/fees/payments", true, "FM-Premium");
      await expectAccess(pfm, "/app/fees/settings", true, "FM-Premium");
      await expectAccess(pfm, "/app/fees/unpaid", true, "FM-Premium");
      const journal = await pageText(pfm, `/app/fees/payments?year=${year.id}`);
      check(
        "FM : voit les reçus des deux caissiers",
        journal.includes(receiptA.receiptNumber!) && journal.includes(receiptB.receiptNumber!),
      );
      check("FM : colonne « Encaissé par »", journal.includes("CaissierA") || journal.includes("CaissierB"));
      const filteredA = await pageText(
        pfm,
        `/app/fees/payments?year=${year.id}&cashier=${cashierA.id}`,
      );
      check(
        "FM : filtre caissier A",
        filteredA.includes(receiptA.receiptNumber!) && !filteredA.includes(receiptB.receiptNumber!),
      );
      const searchRef = await pageText(
        pfm,
        `/app/fees/payments?year=${year.id}&q=${encodeURIComponent(receiptA.receiptNumber!)}`,
      );
      check(
        "FM : recherche par n° reçu",
        searchRef.includes(receiptA.receiptNumber!) && !searchRef.includes(receiptB.receiptNumber!),
      );
      const pdf = await pfm.request.get(`${BASE}/app/fees/receipts/pdf?payment=${receiptA.id}`);
      check("FM : PDF reçu", pdf.status() === 200);
      await pfm.context().close();
    }

    // ---------- ADMIN_SCHOOL ----------
    console.log("\n== ADMIN_SCHOOL — Premium ==");
    const adminPw = process.env.SEED_DEMO_PASSWORD;
    if (!adminPw) {
      note("admin : SEED_DEMO_PASSWORD absent");
    } else {
      const padm = await login(browser, "admin@demo.local", "admin", adminPw);
      if (padm) {
        await expectAccess(padm, "/app/fees/payments", true, "admin");
        await expectAccess(padm, "/app/fees/settings", true, "admin");
        await expectAccess(padm, "/app/fees/my-payments", true, "admin");
        await padm.context().close();
      }
    }
  }

  // ---------- Caissier C — second établissement ----------
  console.log("\n== CASHIER C — autre établissement ==");
  const pc = await login(browser, "f2-caissier-c@test.local", "caissier C");
  if (pc) {
    await expectAccess(pc, "/app/fees/my-payments", true, "C");
    const mineC = await pageText(pc, "/app/fees/my-payments");
    check(
      "C : reçus de l'école démo invisibles",
      !mineC.includes(receiptA.receiptNumber!) && !mineC.includes(receiptB.receiptNumber!),
    );
    const pdfA = await pc.request.get(
      `${BASE}/app/fees/receipts/pdf?payment=${receiptA.id}`,
    );
    check("C : PDF d'un reçu d'une autre école refusé", pdfA.status() !== 200);
    const searchC = await pageText(pc, "/app/fees/accounts?q=DEMO");
    check("C : matricules de la démo introuvables", !/DEMO-\d+/.test(searchC));
    await pc.context().close();
  }

  await browser.close();
  console.log(`\n${pass} PASS · ${fail} FAIL · ${skip} SKIP`);
  process.exit(fail ? 1 : 0);
}

main().finally(() => prisma.$disconnect());
