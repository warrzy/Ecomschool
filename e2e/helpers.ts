import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, type Page } from "@playwright/test";

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

export const ACCOUNTS = {
  platform: { email: "admin@ecom-school.local", password: process.env.SEED_TEST_PASSWORD ?? "" },
  schoolAdmin: { email: "school-admin@ecom-school.local", password: process.env.SEED_TEST_PASSWORD ?? "" },
  demoAdmin: { email: "admin@demo.local", password: process.env.SEED_DEMO_PASSWORD ?? "Demo2026!" },
  demoParent: { email: "parent@demo.local", password: process.env.SEED_DEMO_PASSWORD ?? "Demo2026!" },
  demoStudent: { email: "eleve@demo.local", password: process.env.SEED_DEMO_PASSWORD ?? "Demo2026!" },
  demoTeacher: { email: "enseignant@demo.local", password: process.env.SEED_DEMO_PASSWORD ?? "Demo2026!" },
} as const;

/** Connexion via le formulaire réel (couvre CSRF + flux complet). */
export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(password);
  await page.getByRole("button", { name: /se connecter/i }).click();
}

export async function expectLoggedOutRedirect(page: Page, path: string) {
  await page.goto(path);
  await page.waitForURL(/\/login/, { timeout: 60_000 });
  expect(page.url()).toContain("/login");
}
