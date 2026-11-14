/**
 * Moteur de captures annotées pour la documentation ECOM-SCHOOL.
 * Pour chaque écran : connexion → actions éventuelles → injection de
 * repères (pastilles ①②③ + encadrés + étiquettes) → capture PNG.
 *
 * Usage :
 *   DEMO_UI_PASSWORD=... PLATFORM_PASSWORD=... npx tsx scripts/docs/capture-annotated.ts
 *   … ou un seul écran : CAPTURE=eleves npx tsx scripts/docs/capture-annotated.ts
 *
 * Sortie : docs/manuels/captures/<nom>.png (fichiers générés, commitables).
 */
import "dotenv/config";
import { mkdir } from "node:fs/promises";
import { chromium, type BrowserContext, type Page } from "playwright";
import { prisma } from "@/lib/db/prisma";

const BASE = process.env.UI_BASE_URL ?? "https://preprod.ecomschool.fr";
const PW = process.env.DEMO_UI_PASSWORD ?? "";
const PLATFORM_PW = process.env.PLATFORM_PASSWORD ?? "";
const PLATFORM_EMAIL = process.env.PLATFORM_EMAIL ?? "";
const OUT = "docs/manuels/captures";
const ONLY = process.env.CAPTURE; // filtre optionnel

// ---------- Types ----------

type Action =
  | { click: string }
  | { fill: string; value: string }
  | { select: string; value: string }
  | { check: string; on?: boolean }
  | { wait: number }
  | { goto: string }
  | { hover: string };

/** Repère numéroté collé sur l'image finale. */
type Note = {
  /** Sélecteur CSS / text= / :has-text() ciblant l'élément à entourer. */
  sel: string;
  n: number;
  /** Étiquette affichée près de la pastille (optionnelle). */
  label?: string;
  /** Position préférée de la pastille : tl tr bl br (défaut tr). */
  pos?: "tl" | "tr" | "bl" | "br";
};

type Spec = {
  file: string;
  profile: "public" | "admin" | "compta" | "rh" | "paie" | "enseignant"
    | "parent" | "eleve" | "secretaire" | "caissier" | "platform";
  url: string;
  actions?: Action[];
  notes?: Note[];
  /** Ne capturer qu'un élément (formulaire, carte, tableau) au lieu de la page. */
  clip?: string;
  /** Capturer toute la page défilante (défaut : viewport). */
  fullPage?: boolean;
  /** Attente supplémentaire après chargement (ms). */
  settle?: number;
};

const EMAIL: Record<Spec["profile"], string> = {
  public: "",
  admin: "demo-admin@demo.ecomschool.test",
  compta: "demo-compta@demo.ecomschool.test",
  rh: "demo-rh@demo.ecomschool.test",
  paie: "demo-paie@demo.ecomschool.test",
  enseignant: "demo-enseignant@demo.ecomschool.test",
  parent: "demo-parent@demo.ecomschool.test",
  eleve: "demo-eleve@demo.ecomschool.test",
  secretaire: "demo-secretaire@demo.ecomschool.test",
  caissier: "demo-caissier@demo.ecomschool.test",
  platform: "__platform__",
};

// ---------- Moteur ----------

let ctx: BrowserContext;
let page: Page;
let currentProfile: Spec["profile"] | null = null;

async function login(profile: Spec["profile"]) {
  if (currentProfile === profile) return;
  if (profile === "public") { currentProfile = "public"; return; }
  await ctx.clearCookies();
  const email = profile === "platform" ? PLATFORM_EMAIL : EMAIL[profile];
  const pw = profile === "platform" ? PLATFORM_PW : PW;
  if (!email || !pw) throw new Error(`Credentials absents pour ${profile}`);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", pw);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  currentProfile = profile;
}

async function runActions(actions: Action[]) {
  for (const a of actions) {
    if ("click" in a) await page.locator(a.click).first().click();
    else if ("fill" in a) await page.locator(a.fill).first().fill(a.value);
    else if ("select" in a) await page.locator(a.select).first().selectOption(a.value);
    else if ("check" in a) {
      const el = page.locator(a.check).first();
      (a.on ?? true) ? await el.check() : await el.uncheck();
    }
    else if ("wait" in a) await page.waitForTimeout(a.wait);
    else if ("goto" in a) await page.goto(`${BASE}${a.goto}`, { waitUntil: "networkidle" });
    else if ("hover" in a) await page.locator(a.hover).first().hover();
  }
}

/** Injecte les repères numérotés dans le DOM avant capture. */
async function annotate(notes: Note[]) {
  for (const note of notes) {
    const loc = page.locator(note.sel).first();
    const box = await loc.boundingBox({ timeout: 8000 }).catch(() => null);
    if (!box) { console.log(`      ⚠ repère ${note.n} introuvable : ${note.sel}`); continue; }
    await page.evaluate(([b, n, label, pos]) => {
      const x = b.x + window.scrollX, y = b.y + window.scrollY;
      // Encadré rouge autour de l'élément
      const frame = document.createElement("div");
      frame.style.cssText = `position:absolute;left:${x - 4}px;top:${y - 4}px;width:${b.width + 8}px;height:${b.height + 8}px;border:3px solid #e11d48;border-radius:8px;box-shadow:0 0 0 3px rgba(225,29,72,.18);z-index:999999;pointer-events:none;`;
      document.body.appendChild(frame);
      // Pastille numérotée
      const badge = document.createElement("div");
      const bx = pos === "tl" || pos === "bl" ? x - 16 : x + b.width - 6;
      const by = pos === "bl" || pos === "br" ? y + b.height - 6 : y - 16;
      badge.style.cssText = `position:absolute;left:${bx}px;top:${by}px;width:30px;height:30px;border-radius:50%;background:#e11d48;color:#fff;font:bold 16px/30px system-ui;text-align:center;z-index:1000000;box-shadow:0 1px 4px rgba(0,0,0,.4);pointer-events:none;`;
      badge.textContent = String(n).padStart(2, "0");
      document.body.appendChild(badge);
      // Étiquette optionnelle
      if (label) {
        const tag = document.createElement("div");
        tag.style.cssText = `position:absolute;left:${bx + 34}px;top:${by}px;background:#0f172a;color:#fff;font:600 12px/1.4 system-ui;padding:5px 9px;border-radius:6px;z-index:1000000;white-space:nowrap;pointer-events:none;`;
        tag.textContent = label;
        document.body.appendChild(tag);
      }
    }, [box, note.n, note.label ?? null, note.pos ?? "tr"] as const);
  }
}

async function clearAnnotations() {
  await page.evaluate(() => {
    document.querySelectorAll('[style*="z-index:999999"],[style*="z-index:1000000"]')
      .forEach((e) => e.remove());
  }).catch(() => {});
}

async function capture(s: Spec) {
  await login(s.profile);
  await page.goto(`${BASE}${s.url}`, { waitUntil: "networkidle", timeout: 45000 });
  if (s.actions) await runActions(s.actions);
  await page.waitForTimeout(s.settle ?? 800);
  if (s.notes?.length) await annotate(s.notes);
  const path = `${OUT}/${s.file}.png`;
  if (s.clip) {
    const el = page.locator(s.clip).first();
    await el.screenshot({ path });
  } else {
    await page.screenshot({ path, fullPage: s.fullPage ?? false });
  }
  if (s.notes?.length) await clearAnnotations();
  console.log(`  📸 ${s.file}`);
}

// ---------- Catalogue des captures ----------

const S = (s: Spec) => s;
const a = "aside nav a";
const btn = (t: string) => `button:has-text("${t}")`;

const SPECS: Spec[] = [
  // ===== Public / prise en main =====
  S({ file: "login", profile: "public", url: "/login",
    notes: [
      { sel: "#email", n: 1, label: "Votre adresse email" },
      { sel: "#password", n: 2, label: "Votre mot de passe" },
      { sel: 'button[type="submit"]', n: 3, label: "Se connecter" },
    ] }),
  S({ file: "reset-password", profile: "public", url: "/reset-password",
    notes: [
      { sel: 'input[type="email"], input[name="email"]', n: 1, label: "Email du compte" },
      { sel: 'button[type="submit"]', n: 2, label: "Recevoir le lien" },
    ] }),
  S({ file: "site-public", profile: "public", url: "/", fullPage: false }),

  // ===== Admin : pilotage =====
  S({ file: "admin-dashboard", profile: "admin", url: "/app", fullPage: true }),
  S({ file: "admin-notifications", profile: "admin", url: "/app/notifications",
    notes: [{ sel: `${a}:has-text("Notifications")`, n: 1, label: "Menu Pilotage" }] }),
  S({ file: "admin-annonces", profile: "admin", url: "/app/announcements" }),

  // ===== Admin : établissement =====
  S({ file: "admin-annees", profile: "admin", url: "/app/academic-years",
    notes: [{ sel: `${a}:has-text("Années scolaires")`, n: 1, pos: "tr" }] }),
  S({ file: "admin-niveaux", profile: "admin", url: "/app/levels" }),
  S({ file: "admin-classes", profile: "admin", url: "/app/classrooms" }),
  S({ file: "admin-matieres", profile: "admin", url: "/app/subjects" }),
  S({ file: "admin-salles", profile: "admin", url: "/app/rooms" }),
  S({ file: "admin-edt", profile: "admin", url: "/app/schedules", fullPage: true }),
  S({ file: "admin-enseignants", profile: "admin", url: "/app/teachers" }),

  // ===== Admin : pédagogie =====
  S({ file: "admin-eleves", profile: "admin", url: "/app/students",
    notes: [
      { sel: `${a}:has-text("Élèves")`, n: 1 },
      { sel: "text=Ouédraogo", n: 2, label: "Fiche élève" },
    ] }),
  S({ file: "admin-eleves-import", profile: "admin", url: "/app/students/import" }),
  S({ file: "admin-parents", profile: "admin", url: "/app/guardians" }),
  S({ file: "admin-inscriptions", profile: "admin", url: "/app/enrollments",
    notes: [{ sel: `${a}:has-text("Inscriptions scolaires")`, n: 1 }] }),
  S({ file: "admin-admissions", profile: "admin", url: "/app/admissions" }),
  S({ file: "admin-reinscriptions", profile: "admin", url: "/app/reinscriptions" }),
  S({ file: "admin-notes", profile: "admin", url: "/app/grades" }),
  S({ file: "admin-moyennes", profile: "admin", url: "/app/averages" }),
  S({ file: "admin-bulletins", profile: "admin", url: "/app/report-cards" }),
  S({ file: "admin-deliberations", profile: "admin", url: "/app/deliberations" }),
  S({ file: "admin-regles-notation", profile: "admin", url: "/app/grading-policy" }),
  S({ file: "admin-absences", profile: "admin", url: "/app/attendance" }),

  // ===== Admin : finances =====
  S({ file: "admin-finances", profile: "admin", url: "/app/fees" }),
  S({ file: "admin-fees-settings", profile: "admin", url: "/app/fees/settings" }),
  S({ file: "admin-paiements", profile: "admin", url: "/app/fees/payments",
    notes: [{ sel: "text=REC-", n: 1, label: "Reçu numéroté" }] }),
  S({ file: "admin-impayes", profile: "admin", url: "/app/fees/unpaid" }),
  S({ file: "admin-depenses", profile: "admin", url: "/app/expenses" }),
  S({ file: "admin-comptabilite", profile: "admin", url: "/app/comptabilite", fullPage: true }),
  S({ file: "admin-tiers", profile: "admin", url: "/app/comptabilite/tiers" }),
  S({ file: "admin-etats", profile: "admin", url: "/app/comptabilite/etats", fullPage: true }),
  S({ file: "admin-immos", profile: "admin", url: "/app/comptabilite/immobilisations" }),
  S({ file: "admin-rapprochement", profile: "admin", url: "/app/comptabilite/rapprochement" }),
  S({ file: "admin-tresorerie", profile: "admin", url: "/app/treasury" }),
  S({ file: "admin-rapports", profile: "admin", url: "/app/fees/reports" }),
  S({ file: "admin-momo", profile: "admin", url: "/app/paiements-mobile" }),

  // ===== Admin : administration =====
  S({ file: "admin-documents", profile: "admin", url: "/app/documents" }),
  S({ file: "admin-docs-admin", profile: "admin", url: "/app/documents-administratifs" }),
  S({ file: "admin-demandes", profile: "admin", url: "/app/demandes" }),
  S({ file: "admin-users", profile: "admin", url: "/app/users", fullPage: true }),
  S({ file: "admin-user-new", profile: "admin", url: "/app/users/new", fullPage: true }),
  S({ file: "admin-settings", profile: "admin", url: "/app/settings", fullPage: true }),
  S({ file: "admin-subscription", profile: "admin", url: "/app/subscription" }),
  S({ file: "admin-messages", profile: "admin", url: "/app/messages" }),
  S({ file: "admin-preferences", profile: "admin", url: "/app/preferences" }),

  // ===== Plateforme ECOM-TOUCH =====
  S({ file: "platform-schools", profile: "platform", url: "/platform/schools", fullPage: true }),
  S({ file: "platform-plans", profile: "platform", url: "/platform/plans" }),
  S({ file: "platform-subscriptions", profile: "platform", url: "/platform/subscriptions" }),
  S({ file: "platform-modules", profile: "platform", url: "/platform/modules" }),
  S({ file: "platform-monitoring", profile: "platform", url: "/platform/monitoring" }),
  S({ file: "platform-onboarding", profile: "platform", url: "/platform/onboarding", fullPage: true }),

  // ===== Comptable =====
  S({ file: "compta-dashboard", profile: "compta", url: "/app/comptabilite" }),
  S({ file: "compta-etats", profile: "compta", url: "/app/comptabilite/etats", fullPage: true }),
  S({ file: "compta-tiers", profile: "compta", url: "/app/comptabilite/tiers" }),
  S({ file: "compta-tresorerie", profile: "compta", url: "/app/treasury" }),
  S({ file: "compta-depenses", profile: "compta", url: "/app/expenses" }),

  // ===== Caissier =====
  S({ file: "caissier-guichet", profile: "caissier", url: "/app/fees/registration", fullPage: true }),
  S({ file: "caissier-encaissements", profile: "caissier", url: "/app/fees/my-payments" }),
  S({ file: "caissier-finances", profile: "caissier", url: "/app/fees" }),

  // ===== Secrétariat =====
  S({ file: "secretaire-eleves", profile: "secretaire", url: "/app/students" }),
  S({ file: "secretaire-inscriptions", profile: "secretaire", url: "/app/enrollments" }),
  S({ file: "secretaire-parents", profile: "secretaire", url: "/app/guardians" }),
  S({ file: "secretaire-admissions", profile: "secretaire", url: "/app/admissions" }),
  S({ file: "secretaire-absences", profile: "secretaire", url: "/app/attendance" }),
  S({ file: "secretaire-demandes", profile: "secretaire", url: "/app/demandes" }),

  // ===== RH =====
  S({ file: "rh-employes", profile: "rh", url: "/app/rh", fullPage: true,
    notes: [{ sel: "text=Kientega", n: 1, label: "Fiche employé" }] }),

  // ===== Paie =====
  S({ file: "paie-campagnes", profile: "paie", url: "/app/rh/paie", fullPage: true }),

  // ===== Enseignant =====
  S({ file: "enseignant-dashboard", profile: "enseignant", url: "/teacher", fullPage: true }),
  S({ file: "enseignant-edt", profile: "enseignant", url: "/app/schedules?view=teacher", fullPage: true }),

  // ===== Parent =====
  S({ file: "parent-apercu", profile: "parent", url: "/parent", fullPage: true }),
  S({ file: "parent-notes", profile: "parent", url: "/parent?tab=notes" }),
  S({ file: "parent-finances", profile: "parent", url: "/parent?tab=finances" }),
  S({ file: "parent-absences", profile: "parent", url: "/parent?tab=absences" }),
  S({ file: "parent-annonces", profile: "parent", url: "/parent?tab=annonces" }),
  S({ file: "parent-demandes", profile: "parent", url: "/parent?tab=demandes" }),
  S({ file: "parent-reinscription", profile: "parent", url: "/parent?tab=reinscription" }),
  S({ file: "parent-profil", profile: "parent", url: "/parent?tab=profil" }),

  // ===== Élève =====
  S({ file: "eleve-dashboard", profile: "eleve", url: "/student", fullPage: true }),
];

async function main() {
  await mkdir(OUT, { recursive: true });
  // Captures dynamiques : fiche élève, bulletin de paie, run paie.
  const school = await prisma.school.findUnique({ where: { slug: "demo-validation" } });
  if (school) {
    const st = await prisma.student.findFirst({ where: { schoolId: school.id, matricule: "D-E001" } });
    if (st) SPECS.push(
      S({ file: "admin-eleve-fiche", profile: "admin", url: `/app/students/${st.id}`, fullPage: true }),
      S({ file: "parent-factures", profile: "parent", url: `/parent?tab=finances&child=${st.id}` }),
    );
    const run = await prisma.payrollRun.findFirst({
      where: { schoolId: school.id, status: "POSTED", payslips: { some: {} } },
      orderBy: { periodStart: "desc" }, select: { id: true, payslips: { take: 1, select: { id: true } } },
    });
    if (run) {
      SPECS.push(
        S({ file: "paie-run-posted", profile: "paie", url: `/app/rh/paie?run=${run.id}`, fullPage: true }),
        S({ file: "paie-bulletin", profile: "paie", url: `/app/rh/paie?run=${run.id}&slip=${run.payslips[0].id}`, fullPage: true }),
      );
    }
  }
  const wanted = ONLY?.split(",");
  const todo = wanted ? SPECS.filter((s) => wanted.some((w) => s.file.includes(w))) : SPECS;
  const browser = await chromium.launch();
  ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, ignoreHTTPSErrors: true });
  page = await ctx.newPage();
  for (const s of todo) {
    try { await capture(s); }
    catch (e) { console.log(`  ⚠ ${s.file} : ${String(e).slice(0, 120)}`); }
  }
  await browser.close();
  await prisma.$disconnect();
  console.log(`\n${todo.length} captures → ${OUT}/`);
}
main();
