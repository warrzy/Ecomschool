/**
 * P6c — recette préproduction (responsive + accessibilité + non-régression).
 * Lecture seule côté données ; aucune fixture métier (le test créances est
 * couvert par preprod-p6c-charges.ts sur le serveur).
 * Sessions réutilisées via storageState (une connexion par profil).
 *
 * Usage local :
 *   set -a; . ./.p6b-env.local; set +a
 *   npx tsx scripts/phase15/preprod-p6c-recette.ts
 */
import { chromium, type Page, type Browser } from "playwright";

const BASE = "https://preprod.ecomschool.fr";
const PW = process.env.SEED_DEMO_PASSWORD;
const PLAT_EMAIL = process.env.PREPROD_PLATFORM_ADMIN_EMAIL;
const PLAT_PW = process.env.PREPROD_PLATFORM_ADMIN_PASSWORD;
if (!PW || !PLAT_EMAIL || !PLAT_PW) {
  console.error("SEED_DEMO_PASSWORD / PREPROD_PLATFORM_ADMIN_* manquants.");
  process.exit(1);
}

const OUT = "docs/recette/p6c-preprod";
const WIDTHS = [320, 390, 768, 1440];

let pass = 0, fail = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; fails.push(name); console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

const states = new Map<string, unknown>();
async function session(browser: Browser, email: string, password = PW!) {
  if (!states.has(email)) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "load" });
    await page.getByLabel(/e-?mail/i).first().fill(email);
    await page.getByLabel(/mot de passe/i).fill(password);
    await page.getByRole("button", { name: /connecter|connexion/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
    await page.waitForLoadState("load");
    states.set(email, await ctx.storageState());
    await ctx.close();
  }
  return states.get(email);
}

async function docOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** Attend le h1 streamé (PPR) puis évalue l'accessibilité. */
async function a11y(page: Page) {
  await page.locator("h1:visible").first().waitFor({ timeout: 15000 }).catch(() => {});
  return page.evaluate(() => {
    const bad: string[] = [];
    const h1s = [...document.querySelectorAll("h1")].filter(
      (h) => h.offsetParent !== null,
    );
    if (h1s.length !== 1) bad.push(`${h1s.length} h1 visibles`);
    if (!document.querySelector('a[href="#contenu"]')) bad.push("skip link absent");
    const ids = new Map<string, number>();
    document.querySelectorAll("[id]").forEach((e) =>
      ids.set(e.id, (ids.get(e.id) ?? 0) + 1),
    );
    const dups = [...ids.entries()].filter(([, n]) => n > 1);
    if (dups.length) bad.push(`ids dupliqués: ${dups.map(([k]) => k).join(",")}`);
    document.querySelectorAll("input, select, textarea").forEach((el) => {
      const t = el as HTMLElement;
      if (
        t.getAttribute("type") === "hidden" ||
        t.offsetParent === null ||
        t.closest('[aria-hidden="true"]')
      )
        return;
      const id = t.getAttribute("id");
      const named =
        t.getAttribute("aria-label") ||
        t.getAttribute("aria-labelledby") ||
        t.getAttribute("title") ||
        (id && document.querySelector(`label[for="${id}"]`)) ||
        t.closest("label");
      if (!named) bad.push(`${t.tagName} name=${t.getAttribute("name") ?? "?"} sans nom`);
    });
    document.querySelectorAll("table").forEach((t, i) => {
      if (t.offsetParent === null) return;
      if (
        !t.getAttribute("aria-label") &&
        !t.getAttribute("aria-labelledby") &&
        !t.querySelector("caption")
      )
        bad.push(`table[${i}] sans nom`);
      t.querySelectorAll("th").forEach((th) => {
        if (!th.getAttribute("scope")) bad.push("th sans scope");
      });
    });
    return bad;
  });
}

const APP_PAGES = [
  "/app",
  "/app/users",
  "/app/grades",
  "/app/enrollments",
  "/app/fees",
  "/app/fees/payments",
  "/app/fees/settings",
  "/app/messages",
  "/app/subscription",
];
const PLATFORM_PAGES = ["/platform", "/platform/schools", "/platform/automations"];

async function newPage(browser: Browser, email: string, password?: string, viewport?: { width: number; height: number }) {
  const ctx = await browser.newContext({
    viewport,
    storageState: (await session(browser, email, password)) as never,
  });
  return { ctx, page: await ctx.newPage() };
}

async function main() {
  const browser = await chromium.launch();
  const fs = await import("node:fs");
  fs.mkdirSync(OUT, { recursive: true });

  /* Pré-connexions (échec immédiat si identifiants invalides) */
  await session(browser, "admin@demo.local");
  await session(browser, PLAT_EMAIL as string, PLAT_PW);
  await session(browser, "enseignant@demo.local");
  await session(browser, "parent@demo.local");
  await session(browser, "eleve@demo.local");
  await session(browser, "caissier@demo.local");
  await session(browser, "finance@demo.local");
  await session(browser, "commercial@ecom-school.local");

  /* ---------------- R : matrice responsive ---------------- */
  for (const [profile, email, pages] of [
    ["admin", "admin@demo.local", APP_PAGES],
    ["platform", PLAT_EMAIL, PLATFORM_PAGES],
    ["teacher", "enseignant@demo.local", ["/teacher"]],
    ["parent", "parent@demo.local", ["/parent"]],
    ["student", "eleve@demo.local", ["/student"]],
  ] as const) {
    for (const w of WIDTHS) {
      const { ctx, page } = await newPage(browser, email as string,
        profile === "platform" ? PLAT_PW : undefined, { width: w, height: 844 });
      for (const p of pages) {
        const resp = await page.goto(`${BASE}${p}`, { waitUntil: "load" });
        if (resp && resp.status() === 404) { ok(`R ${profile} ${p} @${w}`, false, "404"); continue; }
        await page.locator("h1:visible, main").first().waitFor({ timeout: 15000 }).catch(() => {});
        const over = await docOverflow(page);
        const onLogin = page.url().includes("/login");
        ok(`R ${profile} ${p} @${w}px`, over === 0 && !onLogin,
          onLogin ? "sur /login" : over > 0 ? `+${over}px` : "");
      }
      await ctx.close();
    }
  }

  /* Captures clés */
  {
    const { ctx, page } = await newPage(browser, "admin@demo.local", undefined, { width: 390, height: 844 });
    for (const [p, name] of [["/app/users", "admin-users"], ["/app/grades", "admin-grades"], ["/app/fees/payments", "admin-payments"]] as const) {
      await page.goto(`${BASE}${p}`, { waitUntil: "load" });
      await page.locator("h1:visible").first().waitFor({ timeout: 15000 }).catch(() => {});
      await page.screenshot({ path: `${OUT}/${name}-390.png` });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/app/students`, { waitUntil: "load" });
    await page.locator("h1:visible").first().waitFor({ timeout: 15000 }).catch(() => {});
    await page.screenshot({ path: `${OUT}/admin-students-1440.png` });
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage(browser, PLAT_EMAIL as string, PLAT_PW, { width: 390, height: 844 });
    await page.goto(`${BASE}/platform/schools`, { waitUntil: "load" });
    await page.locator("h1:visible").first().waitFor({ timeout: 15000 }).catch(() => {});
    await page.screenshot({ path: `${OUT}/platform-schools-390.png` });
    await ctx.close();
  }

  /* ---------------- A : accessibilité ---------------- */
  {
    const { ctx, page } = await newPage(browser, "admin@demo.local");
    for (const p of APP_PAGES) {
      await page.goto(`${BASE}${p}`, { waitUntil: "load" });
      const bad = await a11y(page);
      ok(`A ${p} (h1, ids, labels, tables)`, bad.length === 0, bad.join(" ; "));
    }
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage(browser, PLAT_EMAIL as string, PLAT_PW);
    for (const p of PLATFORM_PAGES) {
      await page.goto(`${BASE}${p}`, { waitUntil: "load" });
      const bad = await a11y(page);
      ok(`A ${p} (h1, ids, labels, tables)`, bad.length === 0, bad.join(" ; "));
    }
    await ctx.close();
  }
  for (const [profile, email, paths] of [
    ["teacher", "enseignant@demo.local", ["/teacher"]],
    ["parent", "parent@demo.local", ["/parent"]],
    ["student", "eleve@demo.local", ["/student"]],
  ] as const) {
    const { ctx, page } = await newPage(browser, email as string);
    for (const p of paths) {
      await page.goto(`${BASE}${p}`, { waitUntil: "load" });
      const bad = await a11y(page);
      ok(`A ${profile} ${p}`, bad.length === 0, bad.join(" ; "));
    }
    await ctx.close();
  }

  /* ConfirmPanel clavier : Escape + retour focus (page utilisateurs) */
  {
    const { ctx, page } = await newPage(browser, "admin@demo.local");
    await page.goto(`${BASE}/app/users`, { waitUntil: "load" });
    await page.locator("h1:visible").first().waitFor({ timeout: 15000 }).catch(() => {});
    const delBtn = page.getByRole("link", { name: /supprimer/i }).first();
    if ((await delBtn.count()) > 0) {
      await delBtn.click();
      const panel = page.locator('[role="alertdialog"]');
      await panel.waitFor({ timeout: 15000 }).catch(() => {});
      ok("A ConfirmPanel s'ouvre (alertdialog)", (await panel.count()) > 0);
      if ((await panel.count()) > 0) {
        const focusedIn = await page.evaluate(() => {
          const el = document.querySelector('[role="alertdialog"]');
          return el ? el.contains(document.activeElement) : false;
        });
        ok("A focus initial dans le panneau", focusedIn);
        await page.keyboard.press("Escape");
        await page.waitForLoadState("load");
        await page.waitForTimeout(500);
        ok("A Escape ferme sans exécuter",
          (await page.locator('[role="alertdialog"]').count()) === 0);
      }
    } else ok("A ConfirmPanel présent sur /app/users", false, "bouton introuvable");
    await ctx.close();
  }

  /* Bannières role=status / role=alert + message créances */
  {
    const { ctx, page } = await newPage(browser, "admin@demo.local");
    await page.goto(`${BASE}/app/students?ok=updated`, { waitUntil: "load" });
    await page.locator('[role="status"]').first().waitFor({ timeout: 15000 }).catch(() => {});
    ok("A bannière succès role=status",
      (await page.locator('[role="status"]:visible').count()) > 0);
    await page.goto(`${BASE}/app/students?error=FORBIDDEN`, { waitUntil: "load" });
    await page.locator('[role="alert"]').first().waitFor({ timeout: 15000 }).catch(() => {});
    ok("A bannière erreur role=alert",
      (await page.locator('[role="alert"]:visible').count()) > 0);
    await page.goto(`${BASE}/app/fees?ok=charges&count=3&existing=7`, { waitUntil: "load" });
    const st = page.locator('[role="status"]:visible').first();
    await st.waitFor({ timeout: 15000 }).catch(() => {});
    const msg = (await st.textContent().catch(() => "")) ?? "";
    ok("A message créances distingue nouvelles/existantes",
      /nouvelle/.test(msg) && /existante/.test(msg) && /doublon/.test(msg),
      msg.slice(0, 120));
    await ctx.close();
  }

  /* ---------------- NR : non-régression ---------------- */
  {
    const { ctx, page } = await newPage(browser, "admin@demo.local");
    for (const [p, expect] of [
      ["/app", 200],
      ["/app/students", 200],
      ["/app/fees/accounts", 200],
      ["/app/fees/unpaid", 200],
      ["/app/attendance", 200],
      ["/app/report-cards", 200],
      ["/app/averages", 200],
      ["/app/announcements", 200],
      ["/app/notifications", 200],
      ["/app/preferences", 200],
      ["/app/academic-years", 200],
      ["/app/classrooms", 200],
      ["/app/schedules", 200],
      ["/app/students/import", 200],
      ["/app/students/export?format=csv", "csv"],
      ["/app/fees/payments/export?format=csv", "csv"],
      ["/app/enrollments/export?format=csv", "csv"],
    ] as const) {
      if (expect === "csv") {
        const resp = await ctx.request.get(`${BASE}${p}`);
        const ct = resp.headers()["content-type"] ?? "";
        ok(`NR export ${p}`, resp.status() === 200 && /csv/.test(ct), `${resp.status()} ${ct}`);
      } else {
        const resp = await page.goto(`${BASE}${p}`, { waitUntil: "load" });
        ok(`NR ${p}`, resp?.status() === 200, `${resp?.status()}`);
      }
    }
    await ctx.close();
  }

  /* Portails + rôles restreints */
  for (const [label, email, path, wantDenied] of [
    ["caissier /app/fees", "caissier@demo.local", "/app/fees", false],
    ["caissier /app/users refusé", "caissier@demo.local", "/app/users", true],
    ["finance /app/fees", "finance@demo.local", "/app/fees", false],
    ["parent /parent", "parent@demo.local", "/parent", false],
    ["élève /student", "eleve@demo.local", "/student", false],
    ["enseignant /teacher", "enseignant@demo.local", "/teacher", false],
  ] as const) {
    const { ctx, page } = await newPage(browser, email as string);
    const resp = await page.goto(`${BASE}${path}`, { waitUntil: "load" });
    // Sous PPR le refus arrive par redirection client : attendre l'URL finale.
    await page.waitForTimeout(3000);
    const url = page.url();
    const denied =
      /forbidden|403/.test(url) ||
      resp?.status() === 403 ||
      (await page.locator("h1:visible").first().textContent().catch(() => ""))?.match(/accès refusé/i) != null;
    ok(`NR ${label}`, wantDenied ? denied : resp?.status() === 200 && !denied,
      `${resp?.status()} ${url}`);
    await ctx.close();
  }

  /* Plateforme : OWNER vs SALES */
  {
    const { ctx, page } = await newPage(browser, PLAT_EMAIL as string, PLAT_PW);
    for (const p of ["/platform", "/platform/schools", "/platform/monitoring", "/platform/audit"]) {
      const resp = await page.goto(`${BASE}${p}`, { waitUntil: "load" });
      ok(`NR OWNER ${p}`, resp?.status() === 200, `${resp?.status()}`);
    }
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage(browser, "commercial@ecom-school.local");
    const rMon = await page.goto(`${BASE}/platform/monitoring`, { waitUntil: "load" });
    await page.waitForTimeout(3000);
    const deniedMon =
      rMon?.status() === 403 ||
      /forbidden/.test(page.url()) ||
      (await page.locator("h1:visible").first().textContent().catch(() => ""))?.match(/accès refusé/i) != null;
    ok("NR SALES /platform/monitoring bloqué", deniedMon,
      `${rMon?.status()} ${page.url()}`);
    const rSubs = await page.goto(`${BASE}/platform/subscriptions`, { waitUntil: "load" });
    ok("NR SALES /platform/subscriptions", rSubs?.status() === 200, `${rSubs?.status()}`);
    await ctx.close();
  }

  await browser.close();
  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  if (fails.length) console.log("Échecs :\n  " + fails.join("\n  "));
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error("FATAL", e); process.exitCode = 1; });
