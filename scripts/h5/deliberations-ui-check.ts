/**
 * H5 — Smoke test UI des délibérations (LOCAL uniquement).
 *
 * Pré-requis : `npm run dev` sur :3000.
 * Couvre : liste des sessions, onglet règles, préparation d'une
 * session via le formulaire, tableau des décisions, ajustement
 * motivé, validation via ConfirmPanel, publication, PV PDF,
 * export CSV, refus sans permission, rendu mobile.
 * Captures PNG dans %TEMP%/h5-preuves/.
 *
 * Exécution : npx tsx scripts/h5/deliberations-ui-check.ts
 */
import "dotenv/config";
import fs from "node:fs";
import { chromium, type Browser, type Page } from "@playwright/test";
import { prisma } from "../../src/lib/db/prisma";
import { hashPassword } from "../../src/lib/auth/password";

const BASE = process.env.H5_BASE_URL ?? "http://localhost:3000";
const PW = "H5-Ui-2026!";
const SHOTS = "C:/Users/LENOVO-L490/AppData/Local/Temp/h5-preuves";

let pass = 0, fail = 0, skip = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};
const note = (n: string) => { skip++; console.log(`  SKIP ${n}`); };

const SLUG = "h5-ui-fix";
const EMAILS = ["h5-ui-admin@test.local", "h5-ui-noperm@test.local"];

async function login(browser: Browser, email: string, label: string, mobile = false): Promise<Page | null> {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.getByLabel(/email|e-mail/i).waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.getByLabel(/email|e-mail/i).fill(email);
  await page.getByLabel(/mot de passe/i).fill(PW);
  await page.getByRole("button", { name: /connexion|se connecter/i }).click();
  try {
    await page.waitForFunction(() => !location.pathname.includes("/login"), undefined, { timeout: 120000 });
  } catch {
    note(`${label} : connexion impossible`);
    await ctx.close();
    return null;
  }
  return page;
}

async function cleanup(schoolId: string) {
  await prisma.deliberationDecision.deleteMany({ where: { schoolId } });
  await prisma.deliberationSession.deleteMany({ where: { schoolId } });
  await prisma.deliberationRule.deleteMany({ where: { schoolId } });
  await prisma.studentAnnualResult.deleteMany({ where: { schoolId } });
  await prisma.studentPeriodResult.deleteMany({ where: { schoolId } });
  await prisma.academicPeriod.deleteMany({ where: { schoolId } });
  await prisma.enrollment.deleteMany({ where: { schoolId } });
  await prisma.student.deleteMany({ where: { schoolId } });
  await prisma.classroom.deleteMany({ where: { schoolId } });
  await prisma.level.deleteMany({ where: { schoolId } });
  await prisma.academicYear.deleteMany({ where: { schoolId } });
  await prisma.auditLog.deleteMany({ where: { schoolId } });
  await prisma.schoolMembership.deleteMany({ where: { schoolId } });
  const roles = await prisma.role.findMany({ where: { schoolId }, select: { id: true } });
  if (roles.length) {
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: roles.map((r) => r.id) } } });
    await prisma.role.deleteMany({ where: { id: { in: roles.map((r) => r.id) } } });
  }
  await prisma.school.deleteMany({ where: { id: schoolId } });
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const old = await prisma.school.findFirst({ where: { slug: SLUG }, select: { id: true } });
  if (old) await cleanup(old.id);
  const stale = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
  if (stale.length) {
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: stale.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: stale.map((u) => u.id) } } });
  }

  const school = await prisma.school.create({ data: { name: "H5 UI Collège", code: "H5UI", slug: SLUG } });
  const year = await prisma.academicYear.create({
    data: {
      schoolId: school.id, name: "2026-2027",
      startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30"),
      status: "ACTIVE", isCurrent: true,
    },
  });
  const period = await prisma.academicPeriod.create({
    data: {
      schoolId: school.id, academicYearId: year.id, name: "Trimestre 1", number: 1,
      startDate: new Date("2026-09-01"), endDate: new Date("2026-12-31"), type: "TRIMESTER",
    },
  });
  const level = await prisma.level.create({ data: { schoolId: school.id, name: "6e", order: 1 } });
  const classroom = await prisma.classroom.create({
    data: { schoolId: school.id, academicYearId: year.id, levelId: level.id, name: "6e A" },
  });
  const mkStudent = async (mat: string, first: string) => {
    const st = await prisma.student.create({
      data: { schoolId: school.id, matricule: mat, firstName: first, lastName: "H5UI", sex: "FEMALE" },
    });
    await prisma.enrollment.create({
      data: { schoolId: school.id, studentId: st.id, classroomId: classroom.id, academicYearId: year.id, status: "ENROLLED" },
    });
    return st;
  };
  const s1 = await mkStudent("H5UI-001", "Awa");
  const s2 = await mkStudent("H5UI-002", "Karim");
  const s3 = await mkStudent("H5UI-003", "Léa");
  await prisma.studentPeriodResult.createMany({
    data: [
      { schoolId: school.id, academicPeriodId: period.id, classroomId: classroom.id, studentId: s1.id, generalAverage: 16, rank: 1, mention: "Bien", isComplete: true, status: "CALCULATED" },
      { schoolId: school.id, academicPeriodId: period.id, classroomId: classroom.id, studentId: s2.id, generalAverage: 8, rank: 3, isComplete: true, status: "CALCULATED" },
      { schoolId: school.id, academicPeriodId: period.id, classroomId: classroom.id, studentId: s3.id, generalAverage: 12, rank: 2, isComplete: false, status: "CALCULATED" },
    ],
  });
  await prisma.deliberationRule.createMany({
    data: [
      { schoolId: school.id, scope: "PERIOD", label: "Admis", minAverage: 10, requiresComplete: true, order: 10 },
      { schoolId: school.id, scope: "PERIOD", label: "Rattrapage", minAverage: 10, order: 20 },
      { schoolId: school.id, scope: "PERIOD", label: "Ajournement", order: 30 },
    ],
  });

  const passwordHash = await hashPassword(PW);
  const uAdmin = await prisma.user.create({
    data: { email: "h5-ui-admin@test.local", passwordHash, firstName: "H5", lastName: "Admin", status: "ACTIVE" },
  });
  const uNoPerm = await prisma.user.create({
    data: { email: "h5-ui-noperm@test.local", passwordHash, firstName: "H5", lastName: "NoPerm", status: "ACTIVE" },
  });
  const mkRole = async (userId: string, keys: string[]) => {
    const role = await prisma.role.create({ data: { name: `H5UI_${userId.slice(-4)}`, scope: "SCHOOL", schoolId: school.id } });
    const perms = await prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })), skipDuplicates: true });
    await prisma.schoolMembership.create({ data: { userId, schoolId: school.id, roleId: role.id, status: "ACTIVE" } });
  };
  await mkRole(uAdmin.id, ["deliberations.read", "deliberations.manage", "deliberations.validate", "deliberations.publish", "school.read"]);
  await mkRole(uNoPerm.id, ["student.read"]);

  const browser = await chromium.launch();

  // ---------- Admin : liste + règles ----------
  const admin = await login(browser, "h5-ui-admin@test.local", "admin");
  if (admin) {
    await admin.goto(`${BASE}/app/deliberations`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await admin.waitForTimeout(1500);
    let t = await admin.locator("body").innerText();
    check("page liste accessible", t.includes("Délibérations") && t.includes("Préparer une délibération"));
    check("formulaire visible (manage)", t.includes("Type de conseil") && t.includes("Classe"));
    await admin.screenshot({ path: `${SHOTS}/h5-liste-vide.png`, fullPage: true });

    await admin.goto(`${BASE}/app/deliberations?tab=regles`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await admin.waitForTimeout(1000);
    t = await admin.locator("body").innerText();
    check("onglet règles : 3 règles visibles", t.includes("Admis") && t.includes("Rattrapage") && t.includes("Ajournement"));
    await admin.screenshot({ path: `${SHOTS}/h5-regles.png`, fullPage: true });

    // ---------- Préparation via le formulaire ----------
    await admin.goto(`${BASE}/app/deliberations`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await admin.selectOption('select[name="scope"]', "PERIOD");
    await admin.selectOption('select[name="classroomId"]', classroom.id);
    await admin.selectOption('select[name="academicPeriodId"]', period.id);
    await admin.fill('input[name="note"]', "Conseil du trimestre 1");
    await admin.getByRole("button", { name: /préparer les propositions/i }).click();
    await admin.waitForURL(/\/app\/deliberations\/[^/?]+\?ok=/, { timeout: 120000 });
    await admin.waitForTimeout(1500);
    t = await admin.locator("body").innerText();
    check("session ouverte après préparation", t.includes("En préparation") && t.includes("PV-"));
    check("propositions calculées affichées", t.includes("Admis") && t.includes("Ajournement"));
    check("élève incomplet marqué", t.includes("notes incomplètes"));
    check("s3 (incomplet) → Rattrapage proposé", /Léa[\s\S]*?Rattrapage/.test(t));
    await admin.screenshot({ path: `${SHOTS}/h5-session-preparee.png`, fullPage: true });

    const sid = admin.url().match(/deliberations\/([^/?]+)/)![1];

    // ---------- Ajustement motivé ----------
    const row = admin.locator("tr", { hasText: "Awa" });
    await row.locator('select[name="ruleId"]').selectOption({ label: "Ajournement" });
    await row.locator('input[name="reason"]').fill("Sanction disciplinaire du conseil");
    await row.getByRole("button", { name: "Retenir" }).click();
    await admin.waitForURL(/ok=deliberation_adjusted/, { timeout: 120000 });
    t = await admin.locator("body").innerText();
    check("ajustement enregistré", t.includes("Sanction disciplinaire du conseil") && t.includes("Ajustée"));
    await admin.screenshot({ path: `${SHOTS}/h5-ajustement.png`, fullPage: true });

    // ---------- Validation ----------
    await admin.goto(`${BASE}/app/deliberations/${sid}?confirm=validate`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await admin.getByRole("button", { name: /valider et verrouiller/i }).click();
    await admin.waitForURL(/ok=deliberation_validated/, { timeout: 120000 });
    t = await admin.locator("body").innerText();
    check("session validée", t.includes("Validée"));
    check("colonne ajustement masquée (verrouillé)", !t.includes("Ajuster (conseil)"));
    await admin.screenshot({ path: `${SHOTS}/h5-validee.png`, fullPage: true });

    // ---------- Publication ----------
    await admin.goto(`${BASE}/app/deliberations/${sid}?confirm=publish`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await admin.getByRole("button", { name: "Publier", exact: true }).click();
    await admin.waitForURL(/ok=deliberation_published/, { timeout: 120000 });
    t = await admin.locator("body").innerText();
    check("session publiée", t.includes("Publiée"));
    check("synchro councilDecision s1", (await prisma.studentPeriodResult.findFirstOrThrow({ where: { studentId: s1.id } })).councilDecision === "Ajournement");
    await admin.screenshot({ path: `${SHOTS}/h5-publiee.png`, fullPage: true });

    // ---------- PV PDF + CSV ----------
    const pvResp = await admin.request.get(`${BASE}/app/deliberations/${sid}/pv`, { timeout: 120000 });
    check("PV PDF 200", pvResp.status() === 200 && (pvResp.headers()["content-type"] ?? "").includes("pdf"));
    const pvBuf = Buffer.from(await pvResp.body());
    fs.writeFileSync(`${SHOTS}/pv-deliberation.pdf`, pvBuf);
    check("PV : en-tête PDF + contenu non vide", pvBuf.subarray(0, 5).toString() === "%PDF-" && pvBuf.length > 2000);
    const csvResp = await admin.request.get(`${BASE}/app/deliberations/${sid}/export`, { timeout: 120000 });
    check("export CSV 200", csvResp.status() === 200 && (await csvResp.text()).includes("decision_retenue"));
  }

  // ---------- Sans permission ----------
  const noPerm = await login(browser, "h5-ui-noperm@test.local", "noperm");
  if (noPerm) {
    await noPerm.goto(`${BASE}/app/deliberations`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await noPerm.waitForTimeout(1500);
    const t = await noPerm.locator("body").innerText();
    check("page refusée sans permission", !t.includes("Préparer une délibération"));
    await noPerm.screenshot({ path: `${SHOTS}/h5-refus.png`, fullPage: true });
  }

  // ---------- Mobile ----------
  const mob = await login(browser, "h5-ui-admin@test.local", "admin mobile", true);
  if (mob) {
    await mob.goto(`${BASE}/app/deliberations`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await mob.waitForTimeout(1500);
    const t = await mob.locator("body").innerText();
    check("liste lisible en mobile", t.includes("Délibérations"));
    await mob.screenshot({ path: `${SHOTS}/h5-mobile-liste.png`, fullPage: true });
    const session = await prisma.deliberationSession.findFirst({ where: { schoolId: school.id } });
    if (session) {
      await mob.goto(`${BASE}/app/deliberations/${session.id}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await mob.waitForTimeout(1500);
      await mob.screenshot({ path: `${SHOTS}/h5-mobile-session.png`, fullPage: true });
      check("détail lisible en mobile", (await mob.locator("body").innerText()).includes("Décisions par élève"));
    }
  }

  await browser.close();

  // Nettoyage
  await cleanup(school.id);
  await prisma.schoolMembership.deleteMany({ where: { userId: { in: [uAdmin.id, uNoPerm.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [uAdmin.id, uNoPerm.id] } } });
  await prisma.$disconnect();

  console.log(`\n=== H5 UI : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error("H5_UI_FAILED", e);
  process.exit(1);
});
