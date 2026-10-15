import "dotenv/config";
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Captures d'écran des interfaces réelles pour le site public.
 * Utilise les sessions E2E enregistrées (e2e/.auth/*.json) et les données
 * FICTIVES de l'école DEMO-ECOLE — aucune donnée réelle ni sensible.
 * Usage : serveur local démarré → npx tsx scripts/phase11/capture-screenshots.ts
 */

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const OUT = "public/screenshots";

const SHOTS: { name: string; auth: string; path: string; wait?: string }[] = [
  { name: "dashboard", auth: "demoAdmin", path: "/app" },
  { name: "students", auth: "demoAdmin", path: "/app/enrollments" },
  { name: "reports", auth: "demoAdmin", path: "/app/report-cards" },
  { name: "finance", auth: "demoAdmin", path: "/app/fees" },
  { name: "communication", auth: "demoAdmin", path: "/app/announcements" },
  { name: "grades", auth: "demoTeacher", path: "/teacher" },
  { name: "parent", auth: "demoParent", path: "/parent?tab=notes" },
  { name: "student", auth: "demoStudent", path: "/student" },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  for (const s of SHOTS) {
    const ctx = await browser.newContext({
      baseURL: BASE,
      storageState: `e2e/.auth/${s.auth}.json`,
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    await page.goto(s.path, { waitUntil: "networkidle", timeout: 90_000 });
    await page.waitForTimeout(800); // stabilisation fonts/charts
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    console.log(`${s.name}.png ← ${s.path} (${s.auth})`);
    await ctx.close();
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
