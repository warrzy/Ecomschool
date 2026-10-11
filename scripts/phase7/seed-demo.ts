import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { ensureDefaultFeeCategories, createFeeTariff } from "@/lib/services/finance/fees";
import { generateCharges } from "@/lib/services/finance/accounts";
import { recordPayment } from "@/lib/services/finance/payments";

/**
 * Données financières de démonstration pour l'école fictive DEMO-ECOLE.
 * Idempotent : ré-exécutable (tarifs/encaissements dédupliqués par clé).
 */
async function main() {
  const school = await prisma.school.findUnique({ where: { code: "DEMO-ECOLE" } });
  if (!school) {
    console.log("Ecole de démo absente — lancez d'abord scripts/phase6/seed-demo.ts");
    return;
  }
  const admin = await prisma.user.findUnique({ where: { email: "admin@demo.local" } });
  if (!admin) throw new Error("admin@demo.local absent");
  const ctx = { userId: admin.id, schoolId: school.id };

  const year = await prisma.academicYear.findFirst({
    where: { schoolId: school.id, isCurrent: true },
  });
  if (!year) throw new Error("Aucune année courante pour l'école de démo");

  const categories = await ensureDefaultFeeCategories(ctx);
  const by = (code: string) => categories.find((c) => c.code === code)!;

  const mkTariff = (categoryId: string, amount: number, plan: "SINGLE" | "INSTALLMENTS", count = 1) =>
    createFeeTariff(ctx, {
      academicYearId: year.id,
      categoryId,
      amount,
      paymentPlan: plan,
      installmentCount: count,
      effectiveFrom: new Date(`${year.name.slice(0, 4)}-09-15T00:00:00Z`),
    });

  // Tarifs fictifs (XOF) — ignorés si déjà créés par le service (pas d'unicité stricte)
  const existing = await prisma.feeTariff.count({
    where: { schoolId: school.id, academicYearId: year.id },
  });
  if (existing === 0) {
    await mkTariff(by("INSCRIPTION").id, 15000, "SINGLE");
    await mkTariff(by("SCOLARITE").id, 90000, "INSTALLMENTS", 3);
    await mkTariff(by("CANTINE").id, 30000, "INSTALLMENTS", 3);
    console.log("Tarifs de démo créés (15 000 inscription, 90 000 scolarité 3×, 30 000 cantine 3×)");
  } else {
    console.log(`${existing} tarifs existants — conservation`);
  }

  const gen = await generateCharges(ctx, { academicYearId: year.id });
  console.log("Créances:", JSON.stringify(gen));

  // Un premier paiement par élève (clé d'idempotence déterministe)
  const students = await prisma.enrollment.findMany({
    where: { schoolId: school.id, academicYearId: year.id, status: "ENROLLED" },
    select: { studentId: true },
  });
  for (const s of students) {
    const res = await recordPayment(ctx, {
      studentId: s.studentId,
      academicYearId: year.id,
      amount: 30000,
      method: "CASH",
      observation: "Versement initial — données de démonstration",
      idempotencyKey: `demo-first-${s.studentId}-${year.id}`,
    });
    if (res.ok) console.log(`Paiement démo ${res.result.receiptNumber} → ${s.studentId}`);
  }
  console.log("Seed finance démo terminé.");
}

main()
  .catch((e) => {
    console.error("SEED_FINANCE_DEMO_FAILED", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
