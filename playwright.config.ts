import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  // Le serveur dev compile chaque route à la demande : généreux en local.
  timeout: 120_000,
  retries: 0,
  // Série obligatoire : la base est partagée (verrous de connexion, compteurs).
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    // Build de production : pas de compilation à la volée, parcours plus
    // représentatifs. `npm run build` doit avoir été exécuté avant.
    command: "npm run start -- --port 3000",
    url: `${baseURL}/api/auth/csrf`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
