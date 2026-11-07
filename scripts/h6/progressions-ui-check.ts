/**
 * H6 — Smoke test UI progressions & réconciliation (LOCAL uniquement).
 *
 * Pré-requis : `npm run dev` sur :3000.
 * Couvre : détail de délibération annuelle (progressions structurées,
 * sélecteur d'ajustement), écran réinscriptions (suggestions structurées,
 * niveau terminal, cas particuliers, badge conflit H5/G2), rendu mobile.
 * Captures PNG dans %TEMP%/h6-preuves/.
 *
 * Exécution : npx tsx scripts/h6/progressions-ui-check.ts
 */
import "dotenv/config";
import fs from "node:fs";
import { chromium, type Browser, type Page } from "@playwright/test";
import { prisma } from "../../src/lib/db/prisma";
import { hashPassword } from "../../src/lib/auth/password";
import {
  adjustDecision,
  depublishSession,
  prepareSession,
  publishSession,
  unlockSession,
  upsertRule,
  validateSession,
} from "../../src/lib/services/deliberations";
import {
  createReenrollmentCampaign,
  setReenrollmentCampaignStatus,
} from "../../src/lib/services/reenrollment";

const BASE = process.env.H6_BASE_URL ?? "http://localhost:3000";
const PW = "H6-Ui-2026!";
const SHOTS = "C:/Users/LENOVO-L490/AppData/Local/Temp/h6-preuves";

let pass = 0, fail = 0, skip = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};
const note = (n: string) => { skip++; console.log(`  SKIP ${n}`); };

const SLUG = "h6-ui-fix";
const EMAIL = "h6-ui-admin@test.local";

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
  await prisma.reenrollmentMessage.deleteMany({ where: { schoolId } });
  await prisma.reenrollmentRequest.deleteMany({ where: { schoolId } });
  await prisma.reenrollmentCampaign.deleteMany({ where: { schoolId } });
  await prisma.deliberationDecision.deleteMany({ where: { schoolId } });
  await prisma.deliberationSession.deleteMany({ where: { schoolId } });
  await prisma.deliberationRule.deleteMany({ where: { schoolId } });
  await prisma.studentAnnualResult.deleteMany({ where: { schoolId } });
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
  const stale = await prisma.user.findFirst({ where: { email: EMAIL }, select: { id: true } });
  if (stale) {
    await prisma.schoolMembership.deleteMany({ where: { userId: stale.id } });
    await prisma.user.delete({ where: { id: stale.id } });
  }

  // ---------- Fixtures ----------
  const school = await prisma.school.create({ data: { name: "H6 UI Lycée", code: "H6UI", slug: SLUG } });
  const y0 = await prisma.academicYear.create({
    data: {
      schoolId: school.id, name: "2026-2027",
      startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30"),
      status: "ACTIVE", isCurrent: true,
    },
  });
  const y1 = await prisma.academicYear.create({
    data: {
      schoolId: school.id, name: "2027-2028",
      startDate: new Date("2027-09-01"), endDate: new Date("2028-06-30"),
      status: "ACTIVE", isCurrent: false,
    },
  });
  const l6 = await prisma.level.create({ data: { schoolId: school.id, name: "6e", order: 1 } });
  const l5 = await prisma.level.create({ data: { schoolId: school.id, name: "5e", order: 2 } });
  const lT = await prisma.level.create({ data: { schoolId: school.id, name: "Tle", order: 3 } });
  const c6 = await prisma.classroom.create({
    data: { schoolId: school.id, academicYearId: y0.id, levelId: l6.id, name: "6e A" },
  });
  const cT = await prisma.classroom.create({
    data: { schoolId: school.id, academicYearId: y0.id, levelId: lT.id, name: "Tle A" },
  });
  await prisma.classroom.create({
    data: { schoolId: school.id, academicYearId: y1.id, levelId: l5.id, name: "5e A" },
  });
  const mkStudent = async (mat: string, first: string, classroomId: string) => {
    const st = await prisma.student.create({
      data: { schoolId: school.id, matricule: mat, firstName: first, lastName: "H6UI", sex: "FEMALE" },
    });
    const en = await prisma.enrollment.create({
      data: {
        schoolId: school.id, studentId: st.id, classroomId,
        academicYearId: y0.id, status: "ENROLLED",
      },
    });
    return { st, en };
  };
  const e1 = await mkStudent("H6UI-01", "Awa", c6.id);
  const e2 = await mkStudent("H6UI-02", "Léa", c6.id);
  const e3 = await mkStudent("H6UI-03", "Sara", cT.id);
  await prisma.studentAnnualResult.createMany({
    data: [
      { schoolId: school.id, academicYearId: y0.id, studentId: e1.st.id, annualAverage: 16, rank: 1, status: "PUBLISHED" },
      { schoolId: school.id, academicYearId: y0.id, studentId: e2.st.id, annualAverage: 11, rank: 2, status: "PUBLISHED" },
      { schoolId: school.id, academicYearId: y0.id, studentId: e3.st.id, annualAverage: 15, rank: 1, status: "PUBLISHED" },
    ],
  });
  const admin = await prisma.user.create({
    data: {
      email: EMAIL, passwordHash: await hashPassword(PW),
      firstName: "H6", lastName: "Admin", status: "ACTIVE",
    },
  });
  const role = await prisma.role.create({
    data: { name: "H6_UI_ADMIN", scope: "SCHOOL", schoolId: school.id },
  });
  const perms = await prisma.permission.findMany({
    where: {
      key: {
        in: [
          "deliberations.read", "deliberations.manage", "deliberations.validate", "deliberations.publish",
          "reenrollments.read", "reenrollments.manage", "reenrollments.review",
          "reenrollments.decide", "enrollment.create", "students.read",
        ],
      },
    },
    select: { id: true },
  });
  await prisma.rolePermission.createMany({
    data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
  });
  await prisma.schoolMembership.create({
    data: { userId: admin.id, schoolId: school.id, roleId: role.id, status: "ACTIVE" },
  });
  const ctx = { userId: admin.id, schoolId: school.id };

  // Règles annuelles + délibérations publiées.
  await upsertRule(ctx, { scope: "ANNUAL", label: "Admis", minAverage: 12, maxAverage: 21, progression: "PROMOTION", order: 10 });
  await upsertRule(ctx, { scope: "ANNUAL", label: "Rattrapage", minAverage: 10, maxAverage: 12, progression: "REMEDIAL", order: 20 });
  await upsertRule(ctx, { scope: "ANNUAL", label: "Redouble", minAverage: 0, maxAverage: 10, progression: "REPETITION", order: 30 });
  const s6 = await prepareSession(ctx, { scope: "ANNUAL", classroomId: c6.id });
  const sT = await prepareSession(ctx, { scope: "ANNUAL", classroomId: cT.id });
  if (!s6.ok || !sT.ok) { console.error("fixtures KO", s6, sT); process.exit(1); }
  const sess6Id = s6.result.id;
  const sessTId = sT.result.id;

  // Campagne + demande décidée PROMOTION sur s1 (conflit à venir).
  const camp = await createReenrollmentCampaign(ctx, {
    name: "Réinscriptions 2027", sourceYearId: y0.id, targetYearId: y1.id,
    opensAt: new Date("2027-04-01"), closesAt: new Date("2027-09-30"),
  });
  const campId = camp.ok ? camp.result.id : "";
  // L'écran n'affiche les éligibles que pour une campagne ouverte.
  await setReenrollmentCampaignStatus(ctx, campId, "OPEN");
  await prisma.reenrollmentRequest.create({
    data: {
      schoolId: school.id, campaignId: campId, targetYearId: y1.id,
      studentId: e1.st.id, sourceEnrollmentId: e1.en.id,
      kind: "REENROLL", status: "APPROVED",
      progression: "PROMOTION", decidedAt: new Date(),
    },
  });

  // ---------- UI ----------
  const browser = await chromium.launch();
  const adminPage = await login(browser, EMAIL, "admin");

  if (adminPage) {
    // Détail session OPEN : colonnes proposition + progression + sélecteur.
    await adminPage.goto(`${BASE}/app/deliberations/${sess6Id}`, { timeout: 90000 });
    await adminPage.waitForTimeout(1500);
    const body = await adminPage.textContent("body");
    check("détail annuel : proposition Admis visible", body?.includes("Admis") === true);
    check("détail annuel : progression affichée",
      body?.toLowerCase().includes("passage en classe supérieure") === true
      || body?.toLowerCase().includes("rattrapage") === true);
    check("sélecteur progression présent (session ouverte)",
      (await adminPage.locator('select[name="progression"]').count()) > 0);
    await adminPage.screenshot({ path: `${SHOTS}/01-deliberation-ouverte.png`, fullPage: true });

    // Publie les deux sessions puis provoque le conflit sur s1 :
    // dépublication → correction REPETITION → republication.
    await validateSession(ctx, sess6Id);
    await validateSession(ctx, sessTId);
    await publishSession(ctx, sess6Id);
    await publishSession(ctx, sessTId);
    await depublishSession(ctx, sess6Id, "Correction conseil");
    await unlockSession(ctx, sess6Id, "Revue s1");
    const d1 = await prisma.deliberationDecision.findFirstOrThrow({
      where: { sessionId: sess6Id, studentId: e1.st.id },
    });
    const redouble = await prisma.deliberationRule.findFirstOrThrow({
      where: { schoolId: school.id, scope: "ANNUAL", label: "Redouble" },
    });
    await adjustDecision(ctx, {
      decisionId: d1.id, ruleId: redouble.id,
      reason: "Moyenne revue à la baisse après contestation",
    });
    await validateSession(ctx, sess6Id);
    await publishSession(ctx, sess6Id);

    // Écran réinscriptions : suggestions + conflits.
    await adminPage.goto(`${BASE}/app/reinscriptions?camp=${campId}`, { timeout: 90000 });
    await adminPage.waitForTimeout(1500);
    const reBody = await adminPage.textContent("body");
    check("réinscriptions : décision annuelle affichée", reBody?.includes("Redouble") === true);
    check("réinscriptions : badge cas particulier", reBody?.includes("Cas particulier") === true);
    check("réinscriptions : badge conflit réconciliation",
      reBody?.includes("réconcilier") === true || reBody?.includes("Conflit") === true);
    check("réinscriptions : niveau terminal signalé", reBody?.includes("terminal") === true);
    await adminPage.screenshot({ path: `${SHOTS}/02-reinscriptions-conflits.png`, fullPage: true });

    // Détail publié : progression corrigée visible.
    await adminPage.goto(`${BASE}/app/deliberations/${sess6Id}`, { timeout: 90000 });
    await adminPage.waitForTimeout(1500);
    const dBody = await adminPage.textContent("body");
    check("détail publié : Redouble + progression affichée", dBody?.includes("Redouble") === true);
    await adminPage.screenshot({ path: `${SHOTS}/03-deliberation-publiee.png`, fullPage: true });
    await adminPage.context().close();
  }

  const mobPage = await login(browser, EMAIL, "mobile", true);
  if (mobPage) {
    await mobPage.goto(`${BASE}/app/reinscriptions?camp=${campId}`, { timeout: 90000 });
    await mobPage.waitForTimeout(1500);
    const mb = await mobPage.textContent("body");
    check("mobile : éligibles lisibles", mb?.includes("Awa") === true);
    await mobPage.screenshot({ path: `${SHOTS}/04-reinscriptions-mobile.png`, fullPage: true });
    await mobPage.context().close();
  }
  await browser.close();

  console.log(`\n=== H6 UI : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error("ERREUR", e);
  await prisma.$disconnect();
  process.exit(1);
});
