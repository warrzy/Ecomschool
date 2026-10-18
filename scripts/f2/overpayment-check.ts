/**
 * Lot F2-C — Contrôle des surpaiements (données de test, base locale).
 *
 * Exécute recordPayment() sur l'école de démonstration locale pour vérifier :
 * paiement partiel, égal au solde, supérieur au solde, solde nul, double
 * soumission (idempotence), concurrence. Aucune donnée de préproduction.
 *
 * ATTENTION : ce script crée de petits paiements de test sur la base LOCALE
 * (montants 1–100 FCFA sur un élève démo). Ne jamais l'exécuter en préprod.
 *
 * Exécution : npx tsx scripts/f2/overpayment-check.ts
 */
import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";
import { listAccounts } from "../../src/lib/services/finance/accounts";
import { recordPayment } from "../../src/lib/services/finance/payments";

let pass = 0;
let fail = 0;
let skip = 0;
const ok = (label: string) => { pass++; console.log(`PASS  ${label}`); };
const ko = (label: string, extra?: string) => {
  fail++;
  console.log(`FAIL  ${label}${extra ? ` — ${extra}` : ""}`);
};
const sk = (label: string, why: string) => {
  skip++;
  console.log(`SKIP  ${label} — ${why}`);
};
const check = (label: string, cond: boolean, extra?: string) =>
  cond ? ok(label) : ko(label, extra);

async function main() {
  const school = await prisma.school.findFirst({
    where: { name: { contains: "Démo" } },
    select: { id: true, name: true },
  });
  if (!school) {
    console.log("École démo introuvable — abandon.");
    process.exit(1);
  }
  // Agent réel de l'école (membre) — requis par la FK AuditLog.actorId.
  const member = await prisma.schoolMembership.findFirst({
    where: { schoolId: school.id, status: "ACTIVE" },
    select: { userId: true },
  });
  if (!member) {
    console.log("Aucun membre sur l'école démo — abandon.");
    process.exit(1);
  }
  const ctx = { userId: member.userId, schoolId: school.id };
  console.log(`École : ${school.name} (${school.id})`);

  // Jour non clôturé requis.
  const today = new Date();
  const dayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const closed = await prisma.cashClosure.findFirst({
    where: { schoolId: school.id, date: { gte: dayStart, lt: new Date(dayStart.getTime() + 86400000) } },
  });
  if (closed) {
    console.log("Journée clôturée — abandon (les tests nécessitent un jour ouvert).");
    process.exit(1);
  }

  const year = await prisma.academicYear.findFirst({
    where: { schoolId: school.id, isCurrent: true },
    select: { id: true, name: true },
  });
  if (!year) {
    console.log("Pas d'année courante — abandon.");
    process.exit(1);
  }

  const accounts = await listAccounts(ctx, { academicYearId: year.id });
  // Élève avec solde suffisant pour plusieurs paiements de test.
  const target = accounts.find((a) => a.balance >= 5000);
  if (!target) {
    console.log("Aucun élève avec solde ≥ 5 000 FCFA — abandon.");
    process.exit(1);
  }
  const studentId = target.student.id;
  const solde0 = target.balance;
  console.log(`Élève témoin : ${target.student.firstName} ${target.student.lastName} — solde ${solde0} FCFA`);

  // 1. Montant invalide.
  const invalid = await recordPayment(ctx, {
    studentId, academicYearId: year.id, amount: 0, method: "CASH",
    idempotencyKey: `f2c-invalid-${Date.now()}`,
  });
  check("montant 0 → INVALID_INPUT", !invalid.ok && invalid.error === "INVALID_INPUT");

  // 2. Surpaiement → OVERPAYMENT.
  const over = await recordPayment(ctx, {
    studentId, academicYearId: year.id, amount: solde0 + 1000, method: "CASH",
    idempotencyKey: `f2c-over-${Date.now()}`,
  });
  check("montant > solde → OVERPAYMENT", !over.ok && over.error === "OVERPAYMENT");

  // 3. Paiement partiel (1 FCFA) → succès + reçu.
  const part = await recordPayment(ctx, {
    studentId, academicYearId: year.id, amount: 1, method: "CASH",
    reference: "TEST-F2C", idempotencyKey: `f2c-part-${Date.now()}`,
  });
  check("paiement partiel (1 FCFA) → succès + reçu", part.ok && !!part.result?.receiptNumber,
    part.ok ? part.result.receiptNumber : part.error);

  // 4. Double soumission : même clé → même paiement, pas de doublon.
  if (part.ok) {
    const key = `f2c-dup-${Date.now()}`;
    const a = await recordPayment(ctx, {
      studentId, academicYearId: year.id, amount: 1, method: "CASH",
      reference: "TEST-F2C-DUP", idempotencyKey: key,
    });
    const b = await recordPayment(ctx, {
      studentId, academicYearId: year.id, amount: 1, method: "CASH",
      reference: "TEST-F2C-DUP", idempotencyKey: key,
    });
    check(
      "double soumission (même idempotencyKey) → un seul paiement",
      a.ok && b.ok && a.result.id === b.result.id,
    );
  } else {
    sk("double soumission", "le paiement partiel a échoué");
  }

  // 5. Concurrence : deux encaissements simultanés dont la somme dépasse le
  //    solde restant → exactement un réussit.
  const soldeNow = solde0 - 2; // 2 FCFA encaissés (part + dup)
  const k1 = `f2c-race1-${Date.now()}`;
  const k2 = `f2c-race2-${Date.now()}`;
  const [r1, r2] = await Promise.all([
    recordPayment(ctx, {
      studentId, academicYearId: year.id, amount: soldeNow, method: "CASH",
      reference: "TEST-F2C-RACE", idempotencyKey: k1,
    }),
    recordPayment(ctx, {
      studentId, academicYearId: year.id, amount: soldeNow, method: "CASH",
      reference: "TEST-F2C-RACE", idempotencyKey: k2,
    }),
  ]);
  const okCount = [r1, r2].filter((r) => r.ok).length;
  const overCount = [r1, r2].filter((r) => !r.ok && r.error === "OVERPAYMENT").length;
  check(
    "concurrence : exactement un gagnant, l'autre OVERPAYMENT",
    okCount === 1 && overCount === 1,
    `ok=${okCount} over=${overCount} r1=${r1.ok ? "ok" : r1.error} r2=${r2.ok ? "ok" : r2.error}`,
  );

  // 6. Solde désormais nul → tout nouvel encaissement refusé.
  const afterZero = await recordPayment(ctx, {
    studentId, academicYearId: year.id, amount: 1, method: "CASH",
    idempotencyKey: `f2c-zero-${Date.now()}`,
  });
  check("solde nul → OVERPAYMENT", !afterZero.ok && afterZero.error === "OVERPAYMENT",
    afterZero.ok ? `créé ${afterZero.result.receiptNumber}` : afterZero.error);

  // 7. Vérification du solde final en base.
  const after = await listAccounts(ctx, {
    academicYearId: year.id,
    query: target.student.matricule,
  });
  const finalAcc = after.find((a) => a.student.id === studentId);
  check(
    "solde final = 0 (facturé − remises − payé)",
    finalAcc?.balance === 0,
    `balance=${finalAcc?.balance}`,
  );

  console.log(`\n${pass} PASS · ${fail} FAIL · ${skip} SKIP`);
  process.exit(fail ? 1 : 0);
}

main().finally(() => prisma.$disconnect());
