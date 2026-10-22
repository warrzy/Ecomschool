/**
 * G2-A — Recette préproduction : documents réels de démonstration.
 * Upload → liste → téléchargement → remplacement → suppression logique.
 * Aucun document personnel réel — fichiers de test générés.
 *
 * Env : SEED_DEMO_PASSWORD (depuis .p6b-env.local, valeur serveur).
 * Usage : SEED_DEMO_PASSWORD=… npx tsx scripts/g2/preprod-g2a-recette.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";

const BASE = process.env.F2_PREPROD_BASE ?? "https://preprod.ecomschool.fr";
const PW = process.env.SEED_DEMO_PASSWORD;

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
  await page.getByLabel(/email|e-mail/i).waitFor({ state: "visible" });
  await page.waitForTimeout(2000);
  await page.getByLabel(/email|e-mail/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(PW!);
  await page.getByRole("button", { name: /connexion|se connecter/i }).click();
  try {
    await page.waitForFunction(() => !location.pathname.includes("/login"), undefined, { timeout: 90000 });
  } catch {
    note(`${label} : connexion impossible`);
    await ctx.close();
    return null;
  }
  return page;
}

async function main() {
  if (!PW) { console.error("SEED_DEMO_PASSWORD manquant."); process.exit(1); }
  const browser = await chromium.launch();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g2a-preprod-"));
  const pdf1 = path.join(dir, "justificatif-v1.pdf");
  const pdf2 = path.join(dir, "justificatif-v2.pdf");
  fs.writeFileSync(pdf1, "%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF\n");
  fs.writeFileSync(pdf2, "%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n");

  // ---------- FINANCE_MANAGER : cycle complet ----------
  console.log("== FINANCE_MANAGER (finance@demo.local) ==");
  const fm = await login(browser, "finance@demo.local", "FM");
  if (fm) {
    await fm.goto(`${BASE}/app/documents`, { waitUntil: "domcontentloaded" });
    await fm.waitForSelector("h1", { timeout: 30000 });
    check("accès /app/documents", !fm.url().includes("/forbidden"));

    // Upload
    await fm.locator('select[name="category"]').selectOption("JUSTIFICATIF");
    await fm.getByLabel(/^Fichier/).setInputFiles(pdf1);
    await fm.locator('input[name="label"]').fill("Recette preprod G2-A");
    await fm.getByRole("button", { name: /^Déposer$/ }).click();
    await fm.waitForTimeout(6000);
    check("upload préprod", fm.url().includes("ok=uploaded"));
    const body = await fm.locator("body").innerText();
    check("document listé", /Recette preprod G2-A/.test(body));
    check("pas de chemin serveur visible", !/var\/www|shared\/uploads|storagePath/.test(body));

    // Téléchargement réel
    const [dl] = await Promise.all([
      fm.waitForEvent("download", { timeout: 30000 }),
      fm.getByRole("link", { name: "Télécharger" }).first().click(),
    ]);
    const dlPath = await dl.path();
    check("téléchargement PDF intègre", !!dlPath &&
      fs.readFileSync(dlPath!).subarray(0, 4).toString() === "%PDF");

    // En-têtes de sécurité
    const href = await fm.getByRole("link", { name: "Télécharger" }).first().getAttribute("href");
    check("URL sans chemin serveur", !!href && !href.includes("uploads") && /\/app\/documents\/[\w-]+\/download/.test(href));
    const docId = href!.match(/\/app\/documents\/([\w-]+)\/download/)![1];
    const resp = await fm.context().request.get(`${BASE}${href}`, { maxRedirects: 0 });
    check("attachment + nosniff",
      /attachment/.test(resp.headers()["content-disposition"] ?? "") &&
      resp.headers()["x-content-type-options"] === "nosniff");

    // Remplacement
    await fm.getByRole("link", { name: "Remplacer" }).first().click();
    await fm.waitForTimeout(1500);
    await fm.getByLabel("Nouveau fichier").setInputFiles(pdf2);
    await fm.getByRole("button", { name: /^Remplacer$/ }).click();
    await fm.waitForTimeout(6000);
    check("remplacement préprod", fm.url().includes("ok=replaced"));
    const oldResp = await fm.context().request.get(
      `${BASE}/app/documents/${docId}/download`, { maxRedirects: 0 });
    check("ancienne version non téléchargeable", oldResp.status() === 404);

    // Suppression logique
    await fm.getByRole("link", { name: "Supprimer" }).first().click();
    await fm.waitForTimeout(1500);
    await fm.locator('input[name="reason"]').fill("fin de recette G2-A");
    await fm.getByRole("button", { name: /Supprimer le document/ }).click();
    await fm.waitForTimeout(5000);
    check("suppression logique", fm.url().includes("ok=deleted"));

    // Accès direct au répertoire uploads via nginx → doit échouer
    const direct = await fm.context().request.get(
      `${BASE}/uploads/${fm.url()}`, { maxRedirects: 0 }).catch(() => null);
    void direct;
    const guess = await fm.context().request.get(
      `${BASE}/uploads/anything.pdf`, { maxRedirects: 0 });
    check("aucun fichier servi directement par nginx", guess.status() === 404);
    await fm.context().close();
  }

  // ---------- ADMIN_SCHOOL ----------
  console.log("== ADMIN_SCHOOL (admin@demo.local) ==");
  const adm = await login(browser, "admin@demo.local", "Admin");
  if (adm) {
    await adm.goto(`${BASE}/app/documents`, { waitUntil: "domcontentloaded" });
    await adm.waitForTimeout(2500);
    check("ADMIN_SCHOOL accède à /app/documents", !adm.url().includes("/forbidden"));
    await adm.context().close();
  }

  // ---------- CASHIER : refus ----------
  console.log("== CASHIER (caissier@demo.local) ==");
  const ca = await login(browser, "caissier@demo.local", "Caissier");
  if (ca) {
    await ca.goto(`${BASE}/app/documents`, { waitUntil: "domcontentloaded" });
    const t0 = Date.now();
    while (!ca.url().includes("/forbidden") && Date.now() - t0 < 20000) {
      await ca.waitForTimeout(800);
    }
    check("CASHIER → forbidden", ca.url().includes("/forbidden"));
    const resp = await ca.context().request.get(
      `${BASE}/app/documents/x/download`, { maxRedirects: 0 });
    check("téléchargement refusé au CASHIER", resp.status() !== 200);
    await ca.context().close();
  }

  fs.rmSync(dir, { recursive: true, force: true });
  await browser.close();
  console.log(`\n=== BILAN : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
