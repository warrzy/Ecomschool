/**
 * Lot F2-C — Fixtures de recette locale (idempotent).
 *
 * Crée des comptes de test UNIQUEMENT sur la base locale :
 *   f2-caissier-a@test.local   (CASHIER, école démo)
 *   f2-caissier-b@test.local   (CASHIER, école démo)
 *   f2-finance@test.local      (FINANCE_MANAGER, école démo)
 *   f2-caissier-c@test.local   (CASHIER, second établissement)
 * et attribue quelques petits encaissements de test (1 FCFA) aux caissiers
 * via recordPayment() pour éprouver la séparation des journaux.
 *
 * Jamais exécuter en préproduction.
 * Exécution : npx tsx scripts/f2/test-fixtures.ts
 */
import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";
import { hashPassword } from "../../src/lib/auth/password";
import { listAccounts } from "../../src/lib/services/finance/accounts";
import { recordPayment } from "../../src/lib/services/finance/payments";

const PW = process.env.F2_TEST_PASSWORD ?? "F2-Test-2026!";

async function upsertUser(
  email: string,
  firstName: string,
  lastName: string,
  schoolId: string,
  roleName: string,
) {
  const role = await prisma.role.findFirstOrThrow({
    where: { name: roleName, scope: "SCHOOL", schoolId: null },
    select: { id: true },
  });
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.schoolMembership.upsert({
      where: { schoolId_userId: { schoolId, userId: existing.id } },
      update: { roleId: role.id, status: "ACTIVE" },
      create: { schoolId, userId: existing.id, roleId: role.id, status: "ACTIVE" },
    });
    console.log(`= ${email} (${roleName}) — membership confirmé`);
    return existing;
  }
  const user = await prisma.user.create({
    data: {
      email,
      firstName,
      lastName,
      passwordHash: await hashPassword(PW),
      status: "ACTIVE",
    },
  });
  await prisma.schoolMembership.create({
    data: { schoolId, userId: user.id, roleId: role.id, status: "ACTIVE" },
  });
  console.log(`+ ${email} (${roleName}) créé`);
  return user;
}

async function main() {
  const demo = await prisma.school.findFirstOrThrow({
    where: { name: { contains: "Démo" } },
    select: { id: true, name: true },
  });
  const other = await prisma.school.findFirst({
    where: { id: { not: demo.id } },
    select: { id: true, name: true },
  });
  console.log(`Démo : ${demo.name} · Secondaire : ${other?.name ?? "absent"}`);

  const year = await prisma.academicYear.findFirstOrThrow({
    where: { schoolId: demo.id, isCurrent: true },
    select: { id: true },
  });

  const cashierA = await upsertUser("f2-caissier-a@test.local", "F2", "CaissierA", demo.id, "CASHIER");
  const cashierB = await upsertUser("f2-caissier-b@test.local", "F2", "CaissierB", demo.id, "CASHIER");
  await upsertUser("f2-finance@test.local", "F2", "Finance", demo.id, "FINANCE_MANAGER");
  if (other) {
    await upsertUser("f2-caissier-c@test.local", "F2", "CaissierC", other.id, "CASHIER");
  }

  // Deux petits encaissements attribués aux deux caissiers de la démo.
  const accounts = await listAccounts(
    { userId: cashierA.id, schoolId: demo.id },
    { academicYearId: year.id },
  );
  const target = accounts.find((a) => a.balance >= 500);
  if (target) {
    for (const [u, tag] of [
      [cashierA, "A"],
      [cashierB, "B"],
    ] as const) {
      const key = `f2-fixture-${tag}-${target.student.id}`;
      const res = await recordPayment(
        { userId: u.id, schoolId: demo.id },
        {
          studentId: target.student.id,
          academicYearId: year.id,
          amount: 1,
          method: "CASH",
          reference: `F2-FIXTURE-${tag}`,
          idempotencyKey: key,
        },
      );
      console.log(
        res.ok
          ? `= encaissement ${tag} → ${res.result.receiptNumber}`
          : `! encaissement ${tag} refusé (${res.error})`,
      );
    }
  } else {
    console.log("! Aucun élève avec solde ≥ 500 — fixtures de paiement ignorées.");
  }

  console.log("Fixtures prêtes.");
}

main().finally(() => prisma.$disconnect());
