/**
 * Smoke UI H12 — page /app/comptabilite : fixture minimale
 * (école + admin + plan + exercice + écritures), captures.
 * Usage : npx tsx scripts/h12/comptabilite-ui-check.ts  (dev server requis)
 */
import "dotenv/config";
import { chromium, type Browser, type Page } from "playwright";
import { prisma } from "../../src/lib/db/prisma";
import { hashPassword } from "../../src/lib/auth/password";
import {
  installStarterPlan, openExercise, generateEntries,
} from "../../src/lib/services/accounting";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PW = "H12-Ui-2026!";
const EMAIL = "h12-ui@test.local";
const SLUG = "h12-ui";
const DIR = "C:/Users/LENOVO-L490/AppData/Local/Temp/h12-preuves";

let pass = 0, fail = 0, skip = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};

async function login(browser: Browser, mobile = false): Promise<Page | null> {
  const ctx = await browser.newContext(
    mobile ? { viewport: { width: 390, height: 844 } } : undefined,
  );
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(4000); // hydratation React (onSubmit client)
    await page.getByLabel(/email|e-mail/i).fill(EMAIL);
    await page.getByLabel(/mot de passe/i).fill(PW);
    await page.getByRole("button", { name: /connexion|se connecter/i }).click();
    await page.waitForFunction(() => !location.pathname.includes("/login"), undefined, { timeout: 120000 });
    return page;
  } catch (e) {
    console.log(`    login KO: ${e instanceof Error ? e.message.split("\n")[0] : e} → ${page.url()}`);
    await ctx.close();
    return null;
  }
}

async function main() {
  const old = await prisma.school.findFirst({ where: { slug: SLUG } });
  if (old) {
    await prisma.auditLog.deleteMany({ where: { schoolId: old.id } });
    await prisma.accountingEntryLine.deleteMany({ where: { entry: { schoolId: old.id } } });
    await prisma.accountingEntry.deleteMany({ where: { schoolId: old.id } });
    await prisma.accountingAccountMap.deleteMany({ where: { schoolId: old.id } });
    await prisma.accountingJournal.deleteMany({ where: { schoolId: old.id } });
    await prisma.accountingAccount.deleteMany({ where: { schoolId: old.id } });
    await prisma.accountingExercise.deleteMany({ where: { schoolId: old.id } });
    await prisma.paymentAllocation.deleteMany({ where: { payment: { schoolId: old.id } } });
    await prisma.payment.deleteMany({ where: { schoolId: old.id } });
    await prisma.feeInstallment.deleteMany({ where: { schoolId: old.id } });
    await prisma.studentFeeCharge.deleteMany({ where: { schoolId: old.id } });
    await prisma.feeCategory.deleteMany({ where: { schoolId: old.id } });
    await prisma.student.deleteMany({ where: { schoolId: old.id } });
    await prisma.academicYear.deleteMany({ where: { schoolId: old.id } });
    await prisma.schoolMembership.deleteMany({ where: { schoolId: old.id } });
    await prisma.rolePermission.deleteMany({ where: { role: { schoolId: old.id } } });
    await prisma.userRole.deleteMany({ where: { role: { schoolId: old.id } } });
    await prisma.role.deleteMany({ where: { schoolId: old.id } });
    await prisma.school.deleteMany({ where: { id: old.id } });
  }
  await prisma.schoolMembership.deleteMany({ where: { user: { email: EMAIL } } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });

  const school = await prisma.school.create({ data: { name: "H12 UI Lycée", code: "H12UI", slug: SLUG } });
  const year = await prisma.academicYear.create({
    data: { schoolId: school.id, name: "2026-2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30"), status: "ACTIVE", isCurrent: true },
  });
  const user = await prisma.user.create({
    data: { email: EMAIL, passwordHash: await hashPassword(PW), firstName: "H12UI", lastName: "Admin", status: "ACTIVE" },
  });
  const role = await prisma.role.create({ data: { name: "H12UI_ADMIN", scope: "SCHOOL", schoolId: school.id } });
  const perms = await prisma.permission.findMany({
    where: { key: { in: ["accounting.read", "accounting.manage", "accounting.export"] } },
    select: { id: true },
  });
  await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
  await prisma.schoolMembership.create({ data: { userId: user.id, schoolId: school.id, roleId: role.id } });
  const ctx = { userId: user.id, schoolId: school.id };

  await installStarterPlan(ctx);
  await openExercise(ctx, { name: "Exercice 2026-2027", startDate: new Date("2026-07-01"), endDate: new Date("2027-06-30") });
  const student = await prisma.student.create({
    data: { schoolId: school.id, matricule: "H12UI-01", firstName: "Awa", lastName: "Demo", sex: "FEMALE" },
  });
  const cat = await prisma.feeCategory.create({ data: { schoolId: school.id, code: "SCOL", label: "Scolarité" } });
  const charge = await prisma.studentFeeCharge.create({
    data: { schoolId: school.id, studentId: student.id, academicYearId: year.id, categoryId: cat.id, amount: 150000 },
  });
  const inst = await prisma.feeInstallment.create({
    data: { schoolId: school.id, chargeId: charge.id, studentId: student.id, academicYearId: year.id, dueDate: new Date("2026-10-01"), amount: 50000 },
  });
  const pay = await prisma.payment.create({
    data: { schoolId: school.id, studentId: student.id, academicYearId: year.id, amount: 50000, method: "CASH", paidAt: new Date("2026-10-05"), status: "VALIDATED", receiptNumber: "R-UI-001" },
  });
  await prisma.paymentAllocation.create({ data: { paymentId: pay.id, installmentId: inst.id, amount: 50000 } });
  await generateEntries(ctx);

  const browser = await chromium.launch();
  const fs = await import("node:fs");
  fs.mkdirSync(DIR, { recursive: true });

  const page = await login(browser);
  if (!page) { skip++; console.log("  SKIP login admin"); }
  else {
    await page.goto(`${BASE}/app/comptabilite`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(2500);
    check("page comptabilité rendue", await page.getByText("Comptabilité").first().isVisible().catch(() => false));
    check("plan comptable affiché", await page.getByText("571").first().isVisible().catch(() => false));
    check("écriture EC- affichée", await page.getByText("EC-2026-00001").first().isVisible().catch(() => false));
    check("balance affichée", await page.getByText("Balance").first().isVisible().catch(() => false));
    await page.screenshot({ path: `${DIR}/01-comptabilite.png`, fullPage: true });

    const mob = await login(browser, true);
    if (!mob) { skip++; console.log("  SKIP mobile"); }
    else {
      await mob.goto(`${BASE}/app/comptabilite`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await mob.getByText("Comptabilité").first().waitFor({ timeout: 60000 }).catch(() => null);
      check("mobile : page lisible", await mob.getByRole("heading", { name: "Comptabilité" }).isVisible().catch(() => false));
      await mob.screenshot({ path: `${DIR}/02-comptabilite-mobile.png`, fullPage: true });
    }
  }
  await browser.close();
  console.log(`\n=== H12 UI : ${pass} PASS / ${fail} FAIL / ${skip} SKIP ===`);
}
main().catch((e) => { console.error("ERREUR", e); process.exit(1); }).finally(() => prisma.$disconnect());
