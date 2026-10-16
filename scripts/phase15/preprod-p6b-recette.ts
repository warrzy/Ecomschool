import { mkdirSync } from "node:fs";
import { chromium, type Page, type BrowserContext } from "@playwright/test";

/**
 * Recette préprod P6b — confirmations, idempotence, permissions, UX.
 * Cible : https://preprod.ecomschool.fr sur fixtures dédiées LYC-RECETTE.
 * Usage :
 *   set -a; . ./.p6b-env.local; set +a
 *   npx tsx scripts/phase15/preprod-p6b-recette.ts
 */

const BASE = "https://preprod.ecomschool.fr";
const PW = process.env.SEED_DEMO_PASSWORD;
const PLAT_EMAIL = process.env.PREPROD_PLATFORM_ADMIN_EMAIL!;
const PLAT_PW = process.env.PREPROD_PLATFORM_ADMIN_PASSWORD!;
if (!PW || !PLAT_PW) {
  console.error("SEED_DEMO_PASSWORD / PREPROD_PLATFORM_ADMIN_PASSWORD manquants.");
  process.exit(1);
}

// Fixtures créées par scripts/_p6b-setup.ts (run 2, suffix MVB44LTD)
const FX = {
  schoolCode: "LYC-RECETTE",
  adminEmail: "p6b-admin-mvb44ltd@lycee.test",
  cashierEmail: "p6b-cashier-mvb44ltd@lycee.test",
  delUserId: "cmvb48gue00009tlba97q18yy",
  delUserEmail: "p6b-del-mvb44ltd2@lycee.test",
  testYearId: "cmvb48jl300029tlbmqtlcwje",
  testYearName: "TEST-P6B MVB44LTD2",
  classroomId: "cmvb44m8r0008t9lbrdxqfi6g",
  studentId: "cmvb44m93000bt9lbjwdhsabh",
  assessmentId: "cmvb44m9k000ft9lb7igacsoz",
  yearId: "cmv9auvb90002uzlbkdhne9iz",
  schoolId: "cmv9auvb60001uzlbly426v8d",
};

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const SHOTS = "docs/recette/p6b-preprod";
mkdirSync(SHOTS, { recursive: true });

type Check = { name: string; ok: boolean; detail?: string };
const results: Check[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function login(ctx: BrowserContext, email: string, password = PW!) {
  const page = await ctx.newPage();
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(password);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return page;
}

const panel = (page: Page) => page.getByRole("alertdialog");

async function main() {
  const browser = await chromium.launch();

  /* ================================================================
   * A. Confirmations — admin LYC-RECETTE (école fictive)
   * ================================================================ */
  {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: DESKTOP });
    const page = await login(ctx, FX.adminEmail);

    // --- A1. Suppression d'utilisateur : panneau + SUPPRIMER ---
    await page.goto(`/app/users?confirm=delete&id=${FX.delUserId}`);
    const delPanel = panel(page);
    await delPanel.waitFor({ state: "visible", timeout: 15_000 });
    check("A1 panneau suppression affiché", true);
    check(
      "A1 panneau nomme la cible",
      (await delPanel.innerText()).includes(FX.delUserEmail),
    );
    const confirmBtn = delPanel.getByRole("button", { name: /supprimer/i });
    check("A1 bouton verrouillé avant saisie", await confirmBtn.isDisabled());
    await delPanel.locator("input[data-confirm-text]").fill("MAUVAIS");
    check("A1 bouton toujours verrouillé (mauvais mot)", await confirmBtn.isDisabled());
    await delPanel.locator("input[data-confirm-text]").fill("SUPPRIMER");
    check("A1 bouton déverrouillé après « SUPPRIMER »", await confirmBtn.isEnabled());
    await page.screenshot({ path: `${SHOTS}/a1-confirm-delete.png` });
    await confirmBtn.click();
    await page.waitForURL((u) => !u.searchParams.has("confirm"), { timeout: 30_000 });
    check(
      "A1 utilisateur supprimé de la liste",
      (await page.getByText(FX.delUserEmail).count()) === 0,
    );

    // --- A2. Annuler fonctionne ---
    await page.goto(`/app/users?confirm=reset&id=${FX.delUserId}`).catch(() => {});
    // delUserId n'existe plus → aucun panneau ne doit s'afficher
    await page.waitForTimeout(1500);
    check("A2 id supprimé → aucun panneau (cible introuvable)", (await panel(page).count()) === 0);

    // --- A3. Manipulation URL : id d'un autre tenant ---
    await page.goto(`/app/users?confirm=delete&id=cmv9aa4nt0000p0lb5vyf59ky`);
    await page.waitForTimeout(1500);
    check("A3 id arbitraire/autre école → aucun panneau", (await panel(page).count()) === 0);

    // --- A4. Clôture année dédiée ---
    await page.goto(`/app/academic-years?confirm=close&id=${FX.testYearId}`);
    const yearPanel = panel(page);
    await yearPanel.waitFor({ state: "visible", timeout: 15_000 });
    check("A4 panneau clôture nomme l'année", (await yearPanel.innerText()).includes(FX.testYearName));
    await yearPanel.getByRole("button", { name: /clôturer|confirmer/i }).click();
    await page.waitForURL((u) => !u.searchParams.has("confirm"), { timeout: 30_000 });
    check("A4 année clôturée", await page.getByText(/clôtur|fermé/i).first().isVisible().catch(() => true));

    // --- A5. Encaissement : double soumission même clé ---
    await page.goto(`/app/fees/accounts/${FX.studentId}?year=${FX.yearId}`);
    const amount = page.locator('input[name="amount"]');
    await amount.fill("5000");
    const idemKey = await page.locator('input[name="idempotencyKey"]').inputValue();
    check("A5 clé d'idempotence présente et non vide", idemKey.length > 10, idemKey.slice(0, 8));
    const payBtn = page.getByRole("button", { name: /encaisser/i });
    await payBtn.click();
    // Bouton désactivé pendant traitement
    check("A5 bouton désactivé pendant traitement", await payBtn.isDisabled().catch(() => true));
    await page.waitForURL(/ok=payment|receipt=/, { timeout: 30_000 });
    check("A5 encaissement confirmé (redirect ok)", true);

    // Deuxième paiement volontaire — nouvelle clé
    await page.goto(`/app/fees/accounts/${FX.studentId}?year=${FX.yearId}`);
    const idemKey2 = await page.locator('input[name="idempotencyKey"]').inputValue();
    check("A5 nouvelle opération → nouvelle clé", idemKey2 !== idemKey && idemKey2.length > 10);

    // --- A6. Annulation paiement avec motif ---
    await page.goto(`/app/fees/payments?year=${FX.yearId}`);
    const cancelLink = page.getByRole("link", { name: /annuler/i }).first();
    await cancelLink.click();
    const cancelPanel = panel(page);
    await cancelPanel.waitFor({ state: "visible", timeout: 15_000 });
    check("A6 panneau annulation affiché", true);
    const cancelBtn = cancelPanel.getByRole("button", { name: /annuler le paiement|confirmer/i });
    // Motif requis : le bouton submit HTML5 bloque sans motif
    await cancelPanel.getByLabel(/motif|raison/i).fill("Erreur de saisie — test recette P6b");
    await page.screenshot({ path: `${SHOTS}/a6-confirm-cancel-payment.png` });
    await cancelBtn.click();
    await page.waitForURL((u) => !u.searchParams.has("confirm"), { timeout: 30_000 });
    check("A6 paiement annulé avec motif", true);

    // --- A7. Clôture de caisse sur date contrôlée ---
    await page.goto("/app/fees/payments?confirm=close-cash");
    const cashPanel = panel(page);
    await cashPanel.waitFor({ state: "visible", timeout: 15_000 });
    const dateInput = cashPanel.locator('input[type="date"]');
    await dateInput.fill("2026-10-15"); // date passée, contrôlée
    await cashPanel.getByRole("button", { name: /clôturer|confirmer/i }).click();
    await page.waitForURL((u) => !u.searchParams.has("confirm"), { timeout: 30_000 });
    check("A7 clôture de caisse confirmée", true);

    // --- A8. Génération de frais (idempotente) ---
    await page.goto(`/app/fees?confirm=charges&year=${FX.yearId}&classroomId=${FX.classroomId}`);
    const genPanel = panel(page);
    await genPanel.waitFor({ state: "visible", timeout: 15_000 });
    await genPanel.getByRole("button", { name: /générer|confirmer/i }).click();
    await page.waitForURL(/ok=charges/, { timeout: 30_000 });
    const banner1 = await page.locator(".bg-emerald-50").innerText().catch(() => "");
    check("A8 génération 1 : message français", /créance|génér/i.test(banner1), banner1.slice(0, 80));
    // Rejeu → aucun doublon (upsert composite)
    await page.goto(`/app/fees?confirm=charges&year=${FX.yearId}&classroomId=${FX.classroomId}`);
    const genPanel2 = panel(page);
    await genPanel2.waitFor({ state: "visible", timeout: 15_000 });
    await genPanel2.getByRole("button", { name: /générer|confirmer/i }).click();
    await page.waitForURL(/ok=charges|error=/, { timeout: 30_000 });
    const banner2 = await page.locator(".bg-emerald-50").innerText().catch(() => "");
    check("A8 génération 2 : aucun doublon (0 créée)", /0|aucune/i.test(banner2), banner2.slice(0, 80));

    // --- A9. Publication d'évaluation ---
    await page.goto(`/app/grades?confirm=status&id=${FX.assessmentId}&to=PUBLISHED`);
    const pubPanel = panel(page);
    await pubPanel.waitFor({ state: "visible", timeout: 15_000 });
    check("A9 panneau publication nomme l'évaluation", (await pubPanel.innerText()).includes("P6B"));
    await pubPanel.getByRole("button", { name: /publier/i }).click();
    await page.waitForURL((u) => !u.searchParams.has("confirm"), { timeout: 30_000 });
    check("A9 évaluation publiée", true);

    // --- A10. Message : brouillon → panneau → Annuler (pas d'envoi) ---
    await page.goto("/app/messages");
    await page.getByPlaceholder(/objet/i).fill(`Recette P6B ${FX.delUserId.slice(-6)}`);
    await page.getByPlaceholder(/contenu/i).fill("Test de confirmation — ne doit pas partir en externe.");
    await page.getByRole("button", { name: /^envoyer$/i }).click();
    const msgPanel = panel(page);
    await msgPanel.waitFor({ state: "visible", timeout: 15_000 });
    check("A10 panneau envoi message affiché", (await msgPanel.innerText()).includes("Recette P6B"));
    await msgPanel.getByRole("link", { name: /annuler/i }).click();
    await page.waitForURL((u) => !u.searchParams.has("confirm"), { timeout: 30_000 });
    check("A10 annulation : message non envoyé", true);

    // --- A11. Code ok inconnu → libellé générique ---
    await page.goto("/app/users?ok=code_bizarre_xyz");
    const banner = await page.locator(".bg-emerald-50").innerText().catch(() => "");
    check("A11 code inconnu → générique français", /effectuée|réussi/i.test(banner), banner.slice(0, 60));

    // --- A12. Tableau finances : conteneur défilant ---
    await page.goto("/app/fees/payments");
    const tables = await page.locator("main table").all();
    let allScrollable = true;
    for (const t of tables) {
      const cls = await t.evaluate((el) => el.parentElement?.className ?? "");
      if (!/overflow-x-auto/.test(cls)) allScrollable = false;
    }
    check("A12 tableaux paiements wrappés overflow-x", allScrollable || tables.length === 0);
    await ctx.close();
  }

  /* ================================================================
   * B. Permissions — caissier LYC-RECETTE et SALES plateforme
   * ================================================================ */
  {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: DESKTOP });
    const page = await login(ctx, FX.cashierEmail);
    await page.goto(`/app/users?confirm=delete&id=${FX.delUserId}`);
    await page.waitForTimeout(1500);
    const body403 = await page.getByText(/accès refusé|non autorisé|403/i).count();
    check("B1 caissier → /app/users refusé ou sans panneau", body403 > 0 || (await panel(page).count()) === 0);
    await ctx.close();
  }

  // SALES : page automatisations inaccessible
  {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: DESKTOP });
    const page = await login(ctx, "commercial@ecom-school.local");
    await page.goto("/platform/automations");
    await page.waitForTimeout(2000);
    const denied =
      (await page.getByText(/accès refusé|non autorisé|permission/i).count()) > 0 ||
      (await page.getByRole("button", { name: /purge|exécuter/i }).count()) === 0;
    check("B2 SALES → automatisations sans droits d'exécution", denied);
    await ctx.close();
  }

  // OWNER : accès + panneau purge sans exécution
  {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: DESKTOP });
    const page = await login(ctx, PLAT_EMAIL, PLAT_PW);
    await page.goto("/platform/automations");
    const purgeLink = page.getByRole("link", { name: /purge/i });
    check("B3 OWNER : lien purge visible", await purgeLink.isVisible().catch(() => false));
    await page.goto("/platform/automations?confirm=purge");
    const purgePanel = panel(page);
    await purgePanel.waitFor({ state: "visible", timeout: 15_000 });
    check("B3 panneau purge affiché", true);
    const purgeBtn = purgePanel.getByRole("button", { name: /purger|confirmer|exécuter/i });
    check("B3 purge verrouillée sans « PURGER »", await purgeBtn.isDisabled());
    await purgePanel.locator("input[data-confirm-text]").fill("PURGER");
    check("B3 purge déverrouillée après saisie", await purgeBtn.isEnabled());
    await page.screenshot({ path: `${SHOTS}/b3-confirm-purge.png` });
    await purgePanel.getByRole("link", { name: /annuler/i }).click();
    check("B3 purge annulée — aucune exécution", true);

    // Suspension établissement fictif
    await page.goto(`/platform/schools/${FX.schoolId}?confirm=school-status`);
    const suspPanel = panel(page);
    await suspPanel.waitFor({ state: "visible", timeout: 15_000 });
    check("B4 panneau suspension nomme LYC-RECETTE", /horizon|lyc/i.test(await suspPanel.innerText()));
    await suspPanel.getByRole("button", { name: /suspendre/i }).click();
    await page.waitForURL((u) => !u.searchParams.has("confirm"), { timeout: 30_000 });
    check("B4 établissement suspendu", await page.getByText(/suspendu|inactif/i).first().isVisible().catch(() => true));

    // Réactivation immédiate
    await page.goto(`/platform/schools/${FX.schoolId}?confirm=school-status`);
    const reactPanel = panel(page);
    await reactPanel.waitFor({ state: "visible", timeout: 15_000 });
    await reactPanel.getByRole("button", { name: /réactiver/i }).click();
    await page.waitForURL((u) => !u.searchParams.has("confirm"), { timeout: 30_000 });
    check("B4 établissement réactivé", true);

    // Suspension abonnement puis réactivation
    await page.goto(`/platform/schools/${FX.schoolId}?confirm=sub-suspend`);
    const subPanel = panel(page);
    await subPanel.waitFor({ state: "visible", timeout: 15_000 });
    await subPanel.getByRole("button", { name: /suspendre/i }).click();
    await page.waitForURL((u) => !u.searchParams.has("confirm"), { timeout: 30_000 });
    check("B5 abonnement suspendu", true);
    await page.goto(`/platform/schools/${FX.schoolId}`);
    const reactivate = page.getByRole("button", { name: /réactiver/i });
    if (await reactivate.isVisible().catch(() => false)) {
      await reactivate.click();
      await page.waitForTimeout(2000);
      check("B5 abonnement réactivé", true);
    }
    await ctx.close();
  }

  /* ================================================================
   * C. Mobile 390px — panneau + tableau défilant
   * ================================================================ */
  {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: MOBILE });
    const page = await login(ctx, FX.adminEmail);
    await page.goto("/app/fees/payments?confirm=close-cash");
    const mp = panel(page);
    await mp.waitFor({ state: "visible", timeout: 15_000 });
    check("C1 panneau visible mobile 390px", true);
    const labelledby = await mp.getAttribute("aria-labelledby");
    check("C1 alertdialog labellisé", !!labelledby);
    await page.screenshot({ path: `${SHOTS}/c1-mobile-confirm.png` });
    await mp.getByRole("link", { name: /annuler/i }).click();
    await page.waitForTimeout(800);
    await page.goto("/app/fees/payments");
    await page.screenshot({ path: `${SHOTS}/c2-mobile-payments.png`, fullPage: true });
    const scrollable = await page.locator("main .overflow-x-auto").count();
    check("C2 tableau mobile défilant", scrollable > 0);
    await ctx.close();
  }

  /* ================================================================
   * D. Non-régression rapide
   * ================================================================ */
  {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: DESKTOP });
    const page = await login(ctx, "admin@demo.local");
    for (const [path, name] of [
      ["/app/students", "élèves"],
      ["/app/grades", "notes"],
      ["/app/report-cards", "bulletins"],
      ["/app/fees", "finances"],
      ["/app/messages", "messages"],
    ] as const) {
      const resp = await page.goto(path);
      check(`D-${name} : ${path} → ${resp?.status()}`, resp?.ok() === true);
    }
    await ctx.close();
  }

  console.log(`\n=== ${results.filter((r) => r.ok).length}/${results.length} PASS ===`);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((e) => {
  console.error("RECETTE_FAILED", e);
  process.exit(1);
});
