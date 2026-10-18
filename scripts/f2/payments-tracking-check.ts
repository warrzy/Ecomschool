/**
 * Lot F2-B — Tests du suivi des encaissements (lecture seule).
 *
 * Vérifie sur données réelles : filtre receivedById (journal personnel),
 * recherche q (élève/matricule/référence/reçu), filtre caissier et statut
 * du journal enrichi, exclusion des annulés dans les totaux, résolution
 * des noms de caissiers, isolation multi-établissements.
 * Aucune écriture en base.
 *
 * Exécution : npx tsx scripts/f2/payments-tracking-check.ts
 */
import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";
import { listPayments } from "../../src/lib/services/finance/payments";

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
  // Cible : un paiement avec receivedById (trace caissier).
  const sample = await prisma.payment.findFirst({
    where: { receivedById: { not: null } },
    select: {
      id: true,
      schoolId: true,
      academicYearId: true,
      studentId: true,
      receivedById: true,
      receiptNumber: true,
      reference: true,
      status: true,
      student: { select: { firstName: true, lastName: true, matricule: true } },
    },
  });
  if (!sample?.receivedById) {
    console.log("Aucun paiement avec receivedById en base — tests impossibles.");
    process.exit(1);
  }
  const ctx = { userId: sample.receivedById, schoolId: sample.schoolId };
  console.log(
    `École ${sample.schoolId} · agent ${sample.receivedById} · ` +
      `reçu témoin ${sample.receiptNumber ?? "(sans numéro)"}`,
  );

  // 1. Journal personnel : receivedById forcé → seuls ses paiements.
  const mine = await listPayments(
    ctx,
    { receivedById: ctx.userId, includeCancelled: true },
    { take: 2000 },
  );
  check(
    "receivedById : tous les paiements retournés appartiennent à l'agent",
    mine.length > 0 && mine.every((p) => p.receivedById === ctx.userId),
  );

  // 2. Un autre agent ne voit pas ces paiements (si 2 agents existent).
  const agents = await prisma.payment.findMany({
    where: { schoolId: ctx.schoolId, receivedById: { not: null } },
    distinct: ["receivedById"],
    select: { receivedById: true },
  });
  const otherAgent = agents.find((a) => a.receivedById !== ctx.userId)?.receivedById;
  if (otherAgent) {
    const his = await listPayments(
      ctx,
      { receivedById: otherAgent, includeCancelled: true },
      { take: 2000 },
    );
    check(
      "agent B : ses paiements ne contiennent aucun paiement de A",
      his.every((p) => p.receivedById === otherAgent),
    );
    check(
      "agent B : le reçu témoin de A est absent de son journal",
      !his.some((p) => p.id === sample.id),
    );
  } else {
    sk("séparation multi-caissiers", "un seul agent a encaissé");
  }

  // 3. Recherche par nom d'élève.
  const byName = await listPayments(
    ctx,
    { query: sample.student.lastName, includeCancelled: true },
    { take: 2000 },
  );
  check(
    "recherche q : nom d'élève",
    byName.some((p) => p.id === sample.id) &&
      byName.every((p) => p.schoolId === ctx.schoolId),
  );

  // 4. Recherche par matricule.
  const byMat = await listPayments(
    ctx,
    { query: sample.student.matricule, includeCancelled: true },
    { take: 2000 },
  );
  check("recherche q : matricule", byMat.some((p) => p.id === sample.id));

  // 5. Recherche par n° de reçu.
  if (sample.receiptNumber) {
    const byReceipt = await listPayments(
      ctx,
      { query: sample.receiptNumber, includeCancelled: true },
      { take: 2000 },
    );
    check(
      "recherche q : numéro de reçu",
      byReceipt.some((p) => p.id === sample.id),
    );
  } else {
    sk("recherche n° reçu", "le paiement témoin n'a pas de reçu");
  }

  // 6. Recherche par référence (si présente).
  if (sample.reference) {
    const byRef = await listPayments(
      ctx,
      { query: sample.reference, includeCancelled: true },
      { take: 2000 },
    );
    check("recherche q : référence", byRef.some((p) => p.id === sample.id));
  } else {
    sk("recherche référence", "le paiement témoin n'a pas de référence");
  }

  // 7. Filtre statut CANCELLED (si des annulés existent dans l'école).
  const anyCancelled = await prisma.payment.count({
    where: { schoolId: ctx.schoolId, status: "CANCELLED" },
  });
  const cancelled = await listPayments(ctx, { status: "CANCELLED" });
  if (anyCancelled > 0) {
    check(
      "filtre statut=CANCELLED : uniquement des annulés",
      cancelled.length > 0 && cancelled.every((p) => p.status === "CANCELLED"),
    );
  } else {
    check("filtre statut=CANCELLED : liste vide cohérente", cancelled.length === 0);
  }

  // 8. Totaux : les annulés ne comptent pas dans la recette.
  const all = await listPayments(ctx, { includeCancelled: true }, { take: 2000 });
  const validated = all.filter((p) => p.status === "VALIDATED");
  const sumValidated = validated.reduce((s, p) => s + p.amount, 0);
  const dbSum = await prisma.payment.aggregate({
    where: { schoolId: ctx.schoolId, status: "VALIDATED" },
    _sum: { amount: true },
  });
  check(
    "totaux : somme VALIDATED cohérente avec l'agrégat DB",
    all.length < 2000 ? sumValidated === (dbSum._sum.amount ?? 0) : true,
    `mémoire=${sumValidated} db=${dbSum._sum.amount}`,
  );

  // 9. Filtre receivedById + période combinés.
  const day = new Date(sample.id ? (await prisma.payment.findUniqueOrThrow({
    where: { id: sample.id }, select: { paidAt: true },
  })).paidAt : new Date());
  const dayStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const combo = await listPayments(ctx, {
    receivedById: ctx.userId,
    from: dayStart,
    to: dayEnd,
    includeCancelled: true,
  });
  check(
    "filtres combinés agent + période : le témoin est retrouvé",
    combo.some((p) => p.id === sample.id),
  );

  // 10. Noms des caissiers résolvables (utilisateurs membres de l'école).
  const cashierIds = agents.map((a) => a.receivedById!);
  const users = await prisma.user.findMany({
    where: {
      id: { in: cashierIds },
      memberships: { some: { schoolId: ctx.schoolId } },
    },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  check(
    "journal : chaque caissier est un utilisateur membre de l'école",
    users.length === cashierIds.length,
    `${users.length}/${cashierIds.length} résolus`,
  );

  // 11. Isolation : paiement de l'école A invisible depuis l'école B.
  const other = await prisma.school.findFirst({
    where: { id: { not: ctx.schoolId } },
    select: { id: true, name: true },
  });
  if (other) {
    const leak = await listPayments(
      { userId: ctx.userId, schoolId: other.id },
      { query: sample.receiptNumber ?? sample.id, includeCancelled: true },
    );
    check(
      `isolation : reçu ${sample.receiptNumber ?? sample.id} invisible depuis ${other.name}`,
      !leak.some((p) => p.id === sample.id),
    );
  } else {
    sk("isolation", "une seule école en base");
  }

  console.log(`\n${pass} PASS · ${fail} FAIL · ${skip} SKIP`);
  process.exit(fail ? 1 : 0);
}

main().finally(() => prisma.$disconnect());
