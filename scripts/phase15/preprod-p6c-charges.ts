/**
 * P6c — preuve métier sur la génération de créances (préprod, lecture/écriture
 * sur fixtures dédiées de l'école fictive LYC-RECETTE uniquement).
 *
 * Usage sur le serveur (depuis la release active) :
 *   DATABASE_URL=... npx tsx scripts/phase15/preprod-p6c-charges.ts
 *
 * Scénario :
 *   1. Fixtures isolées : niveau, année P6C, classe, élève, inscription,
 *      2 catégories + 2 tarifs obligatoires avec plan en échéances.
 *   2. Première génération → created=2, existing=0.
 *   3. Seconde génération identique → created=0, existing=2.
 *   4. Deux générations concurrentes → aucun doublon, aucune échéance
 *      manquante, comptage exact (created total = 0).
 *   5. Nettoyage complet des fixtures.
 */
import { prisma } from "@/lib/db/prisma";
import { generateCharges } from "@/lib/services/finance/accounts";

const TAG = "P6C-RECETTE";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

async function main() {
  const school = await prisma.school.findFirst({
    where: { slug: "lycee-horizon-recette" },
    select: { id: true },
  });
  if (!school) throw new Error("École de recette (lycee-horizon-recette) introuvable");
  const schoolId = school.id;
  const admin = await prisma.schoolMembership.findFirst({
    where: { schoolId },
    select: { userId: true },
  });
  const ctx = { userId: admin?.userId ?? "p6c-recette", schoolId };

  // ---------- Fixtures ----------
  const level = await prisma.level.create({
    data: { schoolId, name: `${TAG} Niveau`, order: 99 },
  });
  const year = await prisma.academicYear.create({
    data: {
      schoolId,
      name: `${TAG} 2099-2100`,
      startDate: new Date("2099-09-01"),
      endDate: new Date("2100-06-30"),
      status: "ACTIVE",
    },
    select: { id: true },
  });
  const classroom = await prisma.classroom.create({
    data: {
      schoolId,
      academicYearId: year.id,
      levelId: level.id,
      name: `${TAG} 6e A`,
    },
  });
  const student = await prisma.student.create({
    data: {
      schoolId,
      matricule: `${TAG}-001`,
      firstName: "Recette",
      lastName: "P6C",
    },
  });
  const enrollment = await prisma.enrollment.create({
    data: {
      schoolId,
      studentId: student.id,
      classroomId: classroom.id,
      academicYearId: year.id,
    },
    select: { id: true },
  });
  const catA = await prisma.feeCategory.create({
    data: { schoolId, code: `${TAG}-SCOL`, label: `${TAG} Scolarité` },
  });
  const catB = await prisma.feeCategory.create({
    data: { schoolId, code: `${TAG}-CANT`, label: `${TAG} Cantine` },
  });
  await prisma.feeTariff.createMany({
    data: [
      {
        schoolId,
        academicYearId: year.id,
        categoryId: catA.id,
        amount: 100000,
        mandatory: true,
        paymentPlan: "INSTALLMENTS",
        installmentCount: 3,
      },
      {
        schoolId,
        academicYearId: year.id,
        categoryId: catB.id,
        amount: 50000,
        mandatory: true,
        paymentPlan: "SINGLE",
        installmentCount: 1,
      },
    ],
  });
  console.log("Fixtures créées (LYC-RECETTE, année P6C, 2 tarifs obligatoires).");

  const countCharges = () =>
    prisma.studentFeeCharge.findMany({
      where: { schoolId, academicYearId: year.id },
      select: { id: true, studentId: true, categoryId: true, amount: true },
    });
  const countInstallments = () =>
    prisma.feeInstallment.groupBy({
      by: ["chargeId"],
      where: { schoolId, academicYearId: year.id },
      _count: true,
    });

  try {
    // ---------- 1ʳᵉ génération ----------
    const g1 = await generateCharges(ctx, { academicYearId: year.id });
    check("gen1 ok", g1.ok);
    if (g1.ok) {
      check("gen1 created=2", g1.result.created === 2, `got ${g1.result.created}`);
      check("gen1 existing=0", g1.result.existing === 0, `got ${g1.result.existing}`);
      check("gen1 skipped=0", g1.result.skipped === 0);
    }
    const charges = await countCharges();
    check("2 créances en base", charges.length === 2, `${charges.length}`);
    const inst = await countInstallments();
    check(
      "échéances créées (3 + 1)",
      inst.length === 2 && inst.reduce((a, b) => a + b._count, 0) === 4,
      JSON.stringify(inst),
    );

    // ---------- 2ᵉ génération identique ----------
    const g2 = await generateCharges(ctx, { academicYearId: year.id });
    check("gen2 ok", g2.ok);
    if (g2.ok) {
      check("gen2 created=0", g2.result.created === 0, `got ${g2.result.created}`);
      check("gen2 existing=2", g2.result.existing === 2, `got ${g2.result.existing}`);
      check("gen2 skipped=0", g2.result.skipped === 0);
    }
    check(
      "toujours 2 créances",
      (await countCharges()).length === 2,
    );

    // ---------- Concurrence : 2 générations simultanées ----------
    // Nouvelle année + nouvelle classe pour mesurer le comptage concurrent.
    const year2 = await prisma.academicYear.create({
      data: {
        schoolId,
        name: `${TAG} 2100-2101`,
        startDate: new Date("2100-09-01"),
        endDate: new Date("2101-06-30"),
        status: "ACTIVE",
      },
      select: { id: true },
    });
    const classroom2 = await prisma.classroom.create({
      data: {
        schoolId,
        academicYearId: year2.id,
        levelId: level.id,
        name: `${TAG} 5e A`,
      },
    });
    await prisma.enrollment.create({
      data: {
        schoolId,
        studentId: student.id,
        classroomId: classroom2.id,
        academicYearId: year2.id,
      },
      select: { id: true },
    });
    await prisma.feeTariff.createMany({
      data: [
        {
          schoolId,
          academicYearId: year2.id,
          categoryId: catA.id,
          amount: 90000,
          mandatory: true,
          paymentPlan: "INSTALLMENTS",
          installmentCount: 2,
        },
        {
          schoolId,
          academicYearId: year2.id,
          categoryId: catB.id,
          amount: 40000,
          mandatory: true,
        },
      ],
    });

    const [c1, c2] = await Promise.all([
      generateCharges(ctx, { academicYearId: year2.id }),
      generateCharges(ctx, { academicYearId: year2.id }),
    ]);
    check("concurrence : les 2 réponses ok", c1.ok && c2.ok);
    if (c1.ok && c2.ok) {
      const totalCreated = c1.result.created + c2.result.created;
      const totalExisting = c1.result.existing + c2.result.existing;
      check(
        "concurrence : created total = 2 (réellement insérées)",
        totalCreated === 2,
        `c1=${JSON.stringify(c1.result)} c2=${JSON.stringify(c2.result)}`,
      );
      check(
        "concurrence : existing total = 2",
        totalExisting === 2,
        `c1=${JSON.stringify(c1.result)} c2=${JSON.stringify(c2.result)}`,
      );
      check(
        "concurrence : skipped total = 0",
        c1.result.skipped + c2.result.skipped === 0,
      );
    }
    const charges2 = await prisma.studentFeeCharge.findMany({
      where: { schoolId, academicYearId: year2.id },
      select: { studentId: true, categoryId: true, amount: true },
    });
    const keys = new Set(charges2.map((c) => `${c.studentId}:${c.categoryId}`));
    check(
      "concurrence : 2 créances, aucun doublon",
      charges2.length === 2 && keys.size === 2,
      `${charges2.length} lignes / ${keys.size} clés`,
    );
    const inst2 = await prisma.feeInstallment.groupBy({
      by: ["chargeId"],
      where: { schoolId, academicYearId: year2.id },
      _count: true,
    });
    check(
      "concurrence : échéances complètes (2 + 1)",
      inst2.length === 2 && inst2.reduce((a, b) => a + b._count, 0) === 3,
      JSON.stringify(inst2),
    );
    const sums = await prisma.feeInstallment.groupBy({
      by: ["chargeId"],
      where: { schoolId, academicYearId: year2.id },
      _sum: { amount: true },
    });
    check(
      "concurrence : soldes échéances = montants tarifs",
      sums.every((s) => s._sum.amount === 90000 || s._sum.amount === 40000) &&
        sums.length === 2,
      JSON.stringify(sums),
    );

    // ---------- Nettoyage ----------
    await prisma.feeInstallment.deleteMany({ where: { schoolId, academicYearId: { in: [year.id, year2.id] } } });
    await prisma.studentFeeCharge.deleteMany({ where: { schoolId, academicYearId: { in: [year.id, year2.id] } } });
    await prisma.feeTariff.deleteMany({ where: { schoolId, categoryId: { in: [catA.id, catB.id] } } });
    await prisma.feeCategory.deleteMany({ where: { schoolId, id: { in: [catA.id, catB.id] } } });
    await prisma.enrollment.deleteMany({ where: { schoolId, studentId: student.id } });
    await prisma.student.delete({ where: { id: student.id } });
    await prisma.classroom.deleteMany({ where: { schoolId, id: { in: [classroom.id, classroom2.id] } } });
    await prisma.level.delete({ where: { id: level.id } });
    await prisma.academicYear.deleteMany({ where: { schoolId, id: { in: [year.id, year2.id] } } });
    await prisma.auditLog.deleteMany({
      where: { schoolId, action: "finance.charges.generate" },
    });
    const residu = await prisma.studentFeeCharge.count({
      where: { schoolId, academicYearId: { in: [year.id, year2.id] } },
    });
    check("nettoyage : résidu = 0", residu === 0);
  } catch (e) {
    console.error("ERREUR — nettoyage incomplet possible :", e);
    failures++;
  }
}

main()
  .catch((e) => {
    console.error("FATAL", e);
    failures++;
  })
  .finally(async () => {
    console.log(failures === 0 ? "TOUT CONFORME" : `${failures} échec(s)`);
    await prisma.$disconnect();
    process.exitCode = failures === 0 ? 0 : 1;
  });
