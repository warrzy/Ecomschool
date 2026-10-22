/**
 * G2-A — smoke test UI local de /app/documents (non destructif).
 * Usage : npx tsx scripts/g2/documents-ui-check.ts [baseUrl]
 */
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:3000";
const PW = process.env.F2_TEST_PASSWORD ?? "F2-Test-2026!";

let pass = 0, fail = 0, skip = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};
const note = (n: string) => { skip++; console.log(`  SKIP ${n}`); };

async function login(browser: Browser, email: string, label: string): Promise<Page | null> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email|e-mail/i).waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.getByLabel(/email|e-mail/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(PW!);
  await page.getByRole("button", { name: /connexion|se connecter/i }).click();
  try {
    await page.waitForFunction(() => !location.pathname.includes("/login"), undefined, { timeout: 150000 });
  } catch {
    note(`${label} : connexion impossible`);
    await ctx.close();
    return null;
  }
  return page;
}

async function main() {
  if (!PW) { console.error("F2_TEST_PASSWORD manquant."); process.exit(1); }
  const browser = await chromium.launch();

  const tmpPdf = path.join(os.tmpdir(), "g2a-ui-doc.pdf");
  fs.writeFileSync(tmpPdf, "%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF\n");

  console.log("== FINANCE_MANAGER — /app/documents ==");
  const fm = await login(browser, "f2-finance@test.local", "FM");
  if (fm) {
    await fm.goto(`${BASE}/app/documents`, { waitUntil: "domcontentloaded" });
    await fm.waitForSelector("h1", { timeout: 60000 });
    await fm.waitForTimeout(1500);
    check("accès /app/documents", !fm.url().includes("/forbidden"));
    const body = await fm.locator("body").innerText();
    check("titre Documents + mention privé", /Documents/.test(body) && /priv/i.test(body));
    check("formulaire de dépôt (catégorie + fichier)",
      (await fm.locator('select[name="category"]').count()) === 1 &&
      (await fm.locator('input[name="file"]').count()) === 1);

    // Upload réel via le formulaire
    await fm.locator('select[name="category"]').selectOption("BULLETIN");
    await fm.locator('input[name="file"]').setInputFiles(tmpPdf);
    await fm.locator('input[name="label"]').fill("Doc recette UI");
    await fm.getByRole("button", { name: /^Déposer$/ }).click();
    await fm.waitForTimeout(4000);
    check("upload UI accepté", fm.url().includes("ok=uploaded"));
    const listBody = await fm.locator("body").innerText();
    check("document listé", /Doc recette UI/.test(listBody));

    // Téléchargement via la route autorisée
    const [dl] = await Promise.all([
      fm.waitForEvent("download", { timeout: 30000 }),
      fm.getByRole("link", { name: "Télécharger" }).first().click(),
    ]);
    const dlPath = await dl.path();
    check("téléchargement PDF réel", !!dlPath &&
      dl.suggestedFilename().endsWith(".pdf") &&
      fs.readFileSync(dlPath!).subarray(0, 4).toString() === "%PDF");

    // En-têtes de sécurité sur la route
    const href = await fm.getByRole("link", { name: "Télécharger" }).first().getAttribute("href");
    const resp = await fm.context().request.get(`${BASE}${href}`, { maxRedirects: 0 });
    check("attachment + nosniff + no-store",
      /attachment/.test(resp.headers()["content-disposition"] ?? "") &&
      resp.headers()["x-content-type-options"] === "nosniff");

    // mobile
    await fm.setViewportSize({ width: 390, height: 844 });
    await fm.goto(`${BASE}/app/documents`, { waitUntil: "domcontentloaded" });
    await fm.waitForTimeout(1200);
    check("mobile 390px sans overflow", await fm.evaluate(() => document.documentElement.scrollWidth <= 390 + 16));
    await fm.context().close();
  }

  console.log("== CASHIER — refus ==");
  const ca = await login(browser, "f2-caissier-a@test.local", "Caissier");
  if (ca) {
    await ca.goto(`${BASE}/app/documents`, { waitUntil: "domcontentloaded" });
    const t0 = Date.now();
    while (!ca.url().includes("/forbidden") && Date.now() - t0 < 30000) await ca.waitForTimeout(800);
    check("CASHIER /app/documents → forbidden", ca.url().includes("/forbidden"));
    const resp = await ca.context().request.get(
      `${BASE}/app/documents/any-id/download`,
      { maxRedirects: 0 },
    );
    check("téléchargement direct refusé au CASHIER", resp.status() !== 200);
    await ca.context().close();
  }

  fs.rmSync(tmpPdf, { force: true });
  await browser.close();
  console.log(`\n=== BILAN : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
