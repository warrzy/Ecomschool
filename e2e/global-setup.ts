import "dotenv/config";
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { ACCOUNTS } from "./helpers";

/**
 * Connexion unique par profil → storageState réutilisé par les tests.
 * Évite de saturer le throttle anti-brute-force (5 tentatives / 30 s / email)
 * et accélère fortement la suite.
 */
export default async function globalSetup() {
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  if (!existsSync("e2e/.auth")) mkdirSync("e2e/.auth", { recursive: true });

  const browser = await chromium.launch();
  for (const [name, acc] of Object.entries(ACCOUNTS)) {
    if (!acc.password) throw new Error(`Mot de passe manquant pour ${name}`);
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(acc.email);
    await page.getByLabel(/mot de passe/i).fill(acc.password);
    await page.getByRole("button", { name: /se connecter/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), {
      timeout: 90_000,
    });
    await context.storageState({ path: `e2e/.auth/${name}.json` });
    await context.close();
    console.log(`[e2e] session enregistrée : ${name}`);
  }
  await browser.close();
}
