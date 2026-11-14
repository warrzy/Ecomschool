/**
 * Captures d'écran réelles de la préproduction pour la documentation
 * commerciale — un PNG par page clé et par profil.
 *
 * Usage :
 *   DATABASE_URL=<tunnel preprod> DEMO_UI_PASSWORD=... \
 *     npx tsx scripts/preprod/demo-screenshots.ts
 *
 * Sortie : docs/demo/screenshots/*.png (commitables — aucune donnée
 * réelle, uniquement le jeu fictif de l'école démo).
 */
import "dotenv/config";
import { mkdir } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import { prisma } from "@/lib/db/prisma";

const BASE = process.env.UI_BASE_URL ?? "https://preprod.ecomschool.fr";
const PW = process.env.DEMO_UI_PASSWORD ?? "";
if (!PW) { console.error("DEMO_UI_PASSWORD requis"); process.exit(1); }
const OUT = "docs/demo/screenshots";

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", PW);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
}

async function shot(page: Page, name: string, url: string) {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(`  📸 ${name}.png`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  // Retrouve un bulletin posté pour la capture paie.
  const school = await prisma.school.findUniqueOrThrow({ where: { slug: "demo-validation" } });
  const run = await prisma.payrollRun.findFirst({
    where: { schoolId: school.id, status: "POSTED", payslips: { some: {} } },
    orderBy: { periodStart: "desc" },
    select: { id: true, payslips: { take: 1, select: { id: true } } },
  });
  const paieUrl = run ? `/app/rh/paie?run=${run.id}` : "/app/rh/paie";
  const slipUrl = run ? `/app/rh/paie?run=${run.id}&slip=${run.payslips[0].id}` : paieUrl;
  // Awa Ouédraogo (6e A) : l'enfant qui porte notes, paiement et retard.
  const awa = await prisma.student.findFirst({ where: { schoolId: school.id, matricule: "D-E001" } });
  const awaQ = awa ? `&child=${awa.id}` : "";

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  console.log("== Captures : public ==");
  await shot(page, "01-login", "/login");

  console.log("== Captures : demo-admin ==");
  await login(page, "demo-admin@demo.ecomschool.test");
  await shot(page, "02-admin-tableau-de-bord", "/app");
  await shot(page, "03-admin-eleves", "/app/students");
  await shot(page, "04-admin-paiements", "/app/fees/payments");
  await shot(page, "05-admin-impayes", "/app/fees/unpaid");
  await shot(page, "06-admin-comptabilite", "/app/comptabilite");
  await shot(page, "07-admin-etats-financiers", "/app/comptabilite/etats");
  await shot(page, "08-admin-rh", "/app/rh");
  await shot(page, "09-admin-annonces", "/app/announcements");

  console.log("== Captures : demo-compta ==");
  await ctx.clearCookies();
  await login(page, "demo-compta@demo.ecomschool.test");
  await shot(page, "10-compta-plan", "/app/comptabilite");
  await shot(page, "11-compta-etats", "/app/comptabilite/etats");
  await shot(page, "12-compta-tresorerie", "/app/treasury");

  console.log("== Captures : demo-paie ==");
  await ctx.clearCookies();
  await login(page, "demo-paie@demo.ecomschool.test");
  await shot(page, "13-paie-campagne", paieUrl);
  await shot(page, "14-paie-bulletin", slipUrl);

  console.log("== Captures : demo-enseignant ==");
  await ctx.clearCookies();
  await login(page, "demo-enseignant@demo.ecomschool.test");
  await shot(page, "15-enseignant-tableau-de-bord", "/teacher");

  console.log("== Captures : demo-parent ==");
  await ctx.clearCookies();
  await login(page, "demo-parent@demo.ecomschool.test");
  await shot(page, "16-parent-apercu", `/parent?tab=apercu${awaQ}`);
  await shot(page, "17-parent-notes", `/parent?tab=notes${awaQ}`);
  await shot(page, "18-parent-finances", `/parent?tab=finances${awaQ}`);
  await shot(page, "19-parent-absences", `/parent?tab=absences${awaQ}`);

  await browser.close();
  await prisma.$disconnect();
  console.log(`\nCaptures terminées → ${OUT}/`);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
