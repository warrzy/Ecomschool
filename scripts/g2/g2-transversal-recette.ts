/**
 * Recette transversale G2 — cycle complet sur données fictives :
 * campagne d'admission → dépôt public → pièces → instruction →
 * admission → conversion en inscription → créances année A →
 * campagne de réinscription année B → dépôt parent → approbation →
 * finalisation → vérification des deux années, dettes préservées,
 * absence de doublons, isolation.
 *
 * Usage : npx tsx scripts/g2/g2-transversal-recette.ts
 *         G2X_CLEANUP=1 …  (supprime les fixtures à la fin)
 */
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "g2x-docs-"));
process.env.DOCUMENTS_ROOT = TEST_ROOT;
process.env.ADMISSIONS_TICKET_SECRET = "g2x-recette-secret";

import { prisma } from "../../src/lib/db/prisma";
import {
  createCampaign,
  decideApplication,
  submitApplication,
  transitionApplication,
} from "../../src/lib/services/admissions";
import { convertApplication } from "../../src/lib/services/admissionConversion";
import {
  createReenrollmentCampaign,
  decideReenrollmentRequest,
  finalizeReenrollment,
  listEligibleStudents,
  parentReenrollmentView,
  reviewReenrollmentRequest,
  setReenrollmentCampaignStatus,
  submitParentReenrollment,
} from "../../src/lib/services/reenrollment";

let pass = 0, fail = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};

const PDF = Buffer.concat([
  Buffer.from("%PDF-1.4\n"),
  Buffer.from("1 0 obj <<>> endobj\n%%EOF\n"),
]);

const FX = "G2X-FX";
const EMAILS = ["g2x-admin@test.local", "g2x-parent@test.local", "g2x-other@test.local"];

async function cleanup(schoolId: string) {
  const docs = await prisma.document.findMany({ where: { schoolId }, select: { storagePath: true } });
  for (const d of docs) {
    try { fs.rmSync(path.join(TEST_ROOT, d.storagePath), { force: true }); } catch { /* ok */ }
  }
  await prisma.paymentAllocation.deleteMany({ where: { installment: { schoolId } } });
  await prisma.payment.deleteMany({ where: { schoolId } });
  await prisma.feeDiscount.deleteMany({ where: { schoolId } });
  await prisma.feeInstallment.deleteMany({ where: { schoolId } });
  await prisma.studentFeeCharge.deleteMany({ where: { schoolId } });
  await prisma.feeTariff.deleteMany({ where: { schoolId } });
  await prisma.feeCategory.deleteMany({ where: { schoolId } });
  await prisma.notification.deleteMany({ where: { schoolId } });
  await prisma.document.deleteMany({ where: { schoolId } });
  await prisma.reenrollmentMessage.deleteMany({ where: { schoolId } });
  await prisma.reenrollmentRequest.deleteMany({ where: { schoolId } });
  await prisma.reenrollmentCampaign.deleteMany({ where: { schoolId } });
  await prisma.admissionInterview.deleteMany({ where: { schoolId } });
  await prisma.admissionEvent.deleteMany({ where: { schoolId } });
  await prisma.admissionMessage.deleteMany({ where: { schoolId } });
  await prisma.admissionApplication.deleteMany({ where: { schoolId } });
  await prisma.admissionCampaign.deleteMany({ where: { schoolId } });
  await prisma.studentGuardian.deleteMany({ where: { schoolId } });
  await prisma.enrollment.deleteMany({ where: { schoolId } });
  await prisma.student.deleteMany({ where: { schoolId } });
  await prisma.guardian.deleteMany({ where: { schoolId } });
  await prisma.classroom.deleteMany({ where: { schoolId } });
  await prisma.academicYear.deleteMany({ where: { schoolId } });
  await prisma.level.deleteMany({ where: { schoolId } });
  await prisma.accountInvite.deleteMany({ where: { schoolId } });
  await prisma.auditLog.deleteMany({ where: { schoolId } });
  await prisma.schoolMembership.deleteMany({ where: { schoolId } });
  const schoolUsers = await prisma.user.findMany({ where: { schoolId }, select: { id: true } });
  if (schoolUsers.length) {
    await prisma.accountInvite.deleteMany({ where: { userId: { in: schoolUsers.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: schoolUsers.map((u) => u.id) } } });
  }
  const roles = await prisma.role.findMany({ where: { schoolId }, select: { id: true } });
  if (roles.length) {
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: roles.map((r) => r.id) } } });
    await prisma.role.deleteMany({ where: { id: { in: roles.map((r) => r.id) } } });
  }
  await prisma.school.deleteMany({ where: { id: schoolId } });
}

async function makeMember(email: string, schoolId: string, permKeys: string[]) {
  const user = await prisma.user.create({
    data: { email, passwordHash: "x", firstName: "G2X", lastName: email },
  });
  const role = await prisma.role.create({
    data: { name: `G2X_${email}`, scope: "SCHOOL", schoolId },
  });
  const perms = await prisma.permission.findMany({
    where: { key: { in: permKeys } }, select: { id: true },
  });
  await prisma.rolePermission.createMany({
    data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
    skipDuplicates: true,
  });
  await prisma.schoolMembership.create({
    data: { userId: user.id, schoolId, roleId: role.id, status: "ACTIVE" },
  });
  return user;
}

async function main() {
  const old = await prisma.school.findFirst({ where: { name: FX }, select: { id: true } });
  if (old) await cleanup(old.id);
  const stale = await prisma.user.findMany({
    where: { email: { in: EMAILS } },
    select: { id: true },
  });
  if (stale.length) {
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: stale.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: stale.map((u) => u.id) } } });
  }

  const school = await prisma.school.create({ data: { name: FX, code: FX, slug: "g2x-fix" } });
  const yearA = await prisma.academicYear.create({
    data: { schoolId: school.id, name: "2025-2026", isCurrent: true, startDate: new Date("2025-09-01"), endDate: new Date("2026-06-30") },
  });
  const yearB = await prisma.academicYear.create({
    data: { schoolId: school.id, name: "2026-2027", isCurrent: false, startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30") },
  });
  const level1 = await prisma.level.create({ data: { schoolId: school.id, name: "6e", order: 1 } });
  const level2 = await prisma.level.create({ data: { schoolId: school.id, name: "5e", order: 2 } });
  const clsA = await prisma.classroom.create({
    data: { schoolId: school.id, academicYearId: yearA.id, levelId: level1.id, name: "6e A" },
  });
  const clsB = await prisma.classroom.create({
    data: { schoolId: school.id, academicYearId: yearB.id, levelId: level2.id, name: "5e A" },
  });
  const cat = await prisma.feeCategory.create({
    data: { schoolId: school.id, code: "INSC", label: "Inscription" },
  });
  const cat2 = await prisma.feeCategory.create({
    data: { schoolId: school.id, code: "SCOL", label: "Scolarité" },
  });
  // Tarifs année A (conversion) et année B (réinscription).
  await prisma.feeTariff.createMany({
    data: [
      { schoolId: school.id, academicYearId: yearA.id, categoryId: cat.id, levelId: level1.id, amount: 20000 },
      { schoolId: school.id, academicYearId: yearA.id, categoryId: cat2.id, amount: 80000, installmentCount: 2 },
      { schoolId: school.id, academicYearId: yearB.id, categoryId: cat.id, levelId: level2.id, amount: 25000 },
      { schoolId: school.id, academicYearId: yearB.id, categoryId: cat2.id, amount: 95000, installmentCount: 3 },
    ],
  });

  const admin = await makeMember("g2x-admin@test.local", school.id, [
    "admissions.read", "admissions.review", "admissions.decide", "admissions.convert",
    "admissions.manage",
    "student.create", "enrollment.create", "guardian.manage",
    "reenrollments.read", "reenrollments.review", "reenrollments.decide", "reenrollments.manage",
  ]);
  const ctxA = { userId: admin.id, schoolId: school.id };

  const schoolId = school.id;
  try {
    // ============ PARTIE 1 — ADMISSION → CONVERSION (G2-A→G2-D) ============
    console.log("== G2-A/B/C/D : admission → conversion ==");
    const campRes = await createCampaign(ctxA, {
      academicYearId: yearA.id,
      name: "G2X Admissions",
      opensAt: "2020-01-01",
      closesAt: "2099-12-31",
      targetLevelIds: [level1.id],
      trainingOptions: [],
      requiredDocs: [{ key: "naissance", label: "Extrait de naissance", category: "IDENTITE", required: true }],
    });
    check("campagne d'admission créée", campRes.ok);
    const admCampId = campRes.ok ? campRes.result.id : "";
    await prisma.admissionCampaign.update({
      where: { id: admCampId }, data: { status: "OPEN" },
    });

    const sub = await submitApplication({
      campaignId: admCampId,
      selfApplicant: false,
      guardianFirstName: "Parent",
      guardianLastName: "Transversal",
      guardianRelation: "Père",
      guardianPhone: "+22670077701",
      guardianEmail: "g2x-parent@test.local",
      children: [{
        firstName: "Enfant", lastName: "Transversal",
        birthDate: "2014-05-05", targetLevelId: level1.id,
      }],
      files: [{ childIndex: 0, docKey: "naissance", category: "IDENTITE", buffer: PDF, originalName: "n.pdf" }],
    });
    check("candidature publique déposée avec pièce", sub.ok);
    const app = await prisma.admissionApplication.findUniqueOrThrow({
      where: { fileNumber: sub.ok ? sub.result.fileNumbers[0]! : "-" },
    });
    check("pièce requise enregistrée",
      (await prisma.document.count({ where: { ownerType: "ADMISSION", ownerId: app.id } })) === 1);

    const rv = await transitionApplication(ctxA, app.id, "UNDER_REVIEW");
    check("passage en instruction", rv.ok);
    const dec = await decideApplication(ctxA, app.id, "ACCEPTED");
    check("décision favorable", dec.ok);
    const cv = await convertApplication(ctxA, {
      applicationId: app.id, classroomId: clsA.id, matricule: "G2X-001",
    });
    check("conversion en inscription", cv.ok);
    const studentId = cv.ok ? cv.result.studentId : "";
    const guardianId = cv.ok ? cv.result.guardianId : null;
    const enrA = await prisma.enrollment.findFirstOrThrow({
      where: { studentId, academicYearId: yearA.id },
    });
    check("inscription année A en 6e A", enrA.classroomId === clsA.id && enrA.status === "ENROLLED");
    const chargesA = await prisma.studentFeeCharge.findMany({
      where: { studentId, academicYearId: yearA.id },
    });
    check("créances année A (INSC 20000 + SCOL 80000)",
      chargesA.length === 2 && chargesA.reduce((s, c) => s + c.amount, 0) === 100000);
    check("aucun paiement créé",
      (await prisma.payment.count({ where: { studentId } })) === 0);

    // Parent : compte rattaché au responsable créé par la conversion.
    const portalPerm = await prisma.permission.findFirstOrThrow({ where: { key: "portal.parent" } });
    const parentRole = await prisma.role.create({
      data: { name: "G2X_PARENT", scope: "SCHOOL", schoolId },
    });
    await prisma.rolePermission.create({
      data: { roleId: parentRole.id, permissionId: portalPerm.id },
    });
    const parent = await prisma.user.create({
      data: { email: "g2x-parent@test.local", passwordHash: "x", firstName: "Parent", lastName: "Transversal", status: "ACTIVE" },
    });
    await prisma.schoolMembership.create({
      data: { userId: parent.id, schoolId, roleId: parentRole.id, status: "ACTIVE" },
    });
    await prisma.guardian.update({
      where: { id: guardianId! }, data: { userId: parent.id, status: "ACTIVE" },
    });
    const ctxP = { userId: parent.id, schoolId };

    // ============ PARTIE 2 — RÉINSCRIPTION (G2-E) ============
    console.log("== G2-E : campagne de réinscription ==");
    const rc = await createReenrollmentCampaign(ctxA, {
      name: "G2X Réinscriptions",
      sourceYearId: yearA.id,
      targetYearId: yearB.id,
      opensAt: new Date("2020-01-01"),
      closesAt: new Date("2099-12-31"),
      blockOnUnpaid: false,
    });
    check("campagne de réinscription créée", rc.ok);
    const rcId = rc.ok ? rc.result.id : "";
    await setReenrollmentCampaignStatus(ctxA, rcId, "OPEN");

    const elig = await listEligibleStudents(ctxA, rcId);
    const eligRow = elig.ok ? elig.result.find((e) => e.studentId === studentId) : null;
    check("élève converti éligible à la réinscription", !!eligRow && eligRow.blockers.length === 0);
    check("impayés année A remontés (non bloquants ici)", !!eligRow && eligRow.unpaidBalance === 100000);

    const view = await parentReenrollmentView(ctxP);
    check("parent voit son enfant éligible",
      view.campaigns.length === 1 && view.campaigns[0].children.some((c) => c.student.id === studentId));

    // Accès refusé : enfant non lié.
    const stranger = await prisma.student.create({
      data: { schoolId, matricule: "G2X-999", lastName: "Autre", firstName: "Enfant" },
    });
    const denied = await submitParentReenrollment(ctxP, {
      campaignId: rcId, studentId: stranger.id, kind: "REENROLL",
    });
    check("dépôt pour enfant non autorisé → FORBIDDEN", !denied.ok && denied.error === "FORBIDDEN");
    await prisma.student.delete({ where: { id: stranger.id } });

    const psub = await submitParentReenrollment(ctxP, {
      campaignId: rcId, studentId, kind: "REENROLL", desiredLevelId: level2.id,
      contactUpdate: { phone: "+22670077702" },
    });
    check("demande de réinscription déposée par le parent", psub.ok);
    const reqId = psub.ok ? psub.result.id : "";
    const psubDup = await submitParentReenrollment(ctxP, {
      campaignId: rcId, studentId, kind: "REENROLL",
    });
    check("second dépôt → ALREADY_SUBMITTED", !psubDup.ok && psubDup.error === "ALREADY_SUBMITTED");

    await reviewReenrollmentRequest(ctxA, reqId);
    const appR = await decideReenrollmentRequest(ctxA, reqId, {
      decision: "APPROVED", targetClassroomId: clsB.id, progression: "PROMOTION",
    });
    check("approbation vers 5e A (promotion)", appR.ok);
    const fin = await finalizeReenrollment(ctxA, reqId);
    check("finalisation → inscription année B", fin.ok && !!fin.result.enrollmentId);
    const finReplay = await finalizeReenrollment(ctxA, reqId);
    check("rejeu idempotent", finReplay.ok && finReplay.result.alreadyFinalized === true);

    const enrB = await prisma.enrollment.findFirstOrThrow({
      where: { studentId, academicYearId: yearB.id },
    });
    check("inscription année B en 5e A", enrB.classroomId === clsB.id && enrB.status === "ENROLLED");
    check("inscription année A préservée (ENROLLED, inchangée)",
      (await prisma.enrollment.findUniqueOrThrow({ where: { id: enrA.id } })).status === "ENROLLED");

    const chargesB = await prisma.studentFeeCharge.findMany({
      where: { studentId, academicYearId: yearB.id },
    });
    check("créances année B (INSC 25000 + SCOL 95000, tarifs année cible)",
      chargesB.length === 2 && chargesB.reduce((s, c) => s + c.amount, 0) === 120000);
    const instB = await prisma.feeInstallment.count({
      where: { studentId, academicYearId: yearB.id },
    });
    check("échéances année B générées (INSC 1 + SCOL 3)", instB === 4);
    const chargesA2 = await prisma.studentFeeCharge.findMany({
      where: { studentId, academicYearId: yearA.id },
    });
    check("dettes année A intactes (mêmes créances, mêmes montants)",
      chargesA2.length === chargesA.length &&
      chargesA2.every((c) => chargesA.some((o) => o.id === c.id && o.amount === c.amount)));
    check("aucune créance dupliquée au rejeu",
      (await prisma.studentFeeCharge.count({ where: { studentId } })) === 4);
    check("toujours aucun paiement fictif",
      (await prisma.payment.count({ where: { studentId } })) === 0);
    check("coordonnées responsable actualisées",
      (await prisma.guardian.findUniqueOrThrow({ where: { id: guardianId! } })).phone === "+22670077702");
    const reqFinal = await prisma.reenrollmentRequest.findUniqueOrThrow({ where: { id: reqId } });
    check("demande COMPLETED reliée à la nouvelle inscription",
      reqFinal.status === "COMPLETED" && reqFinal.newEnrollmentId === enrB.id &&
      reqFinal.sourceEnrollmentId === enrA.id);

    // Isolation : autre école ne voit rien.
    const schoolB = await prisma.school.create({ data: { name: "G2X-AUTRE", code: "G2X-AUTRE", slug: "g2x-autre" } });
    const other = await makeMember("g2x-other@test.local", schoolB.id, [
      "reenrollments.read", "admissions.read",
    ]);
    const viewOther = await parentReenrollmentView({ userId: parent.id, schoolId: schoolB.id });
    check("vue parent vide dans l'autre école", viewOther.campaigns.length === 0);
    void other;
    await cleanup(schoolB.id);

    // Historique d'admission conservé.
    const appFinal = await prisma.admissionApplication.findUniqueOrThrow({ where: { id: app.id } });
    check("dossier d'admission conservé (CONVERTED, liens intacts)",
      appFinal.status === "CONVERTED" && appFinal.studentId === studentId &&
      appFinal.enrollmentId === enrA.id);
    check("événements d'admission historisés",
      (await prisma.admissionEvent.count({ where: { applicationId: app.id } })) >= 3);
  } finally {
    if (process.env.G2X_CLEANUP === "1") {
      await cleanup(schoolId);
      // Comptes fixture créés sans schoolId → orphelins à supprimer par email.
      const users = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
      await prisma.accountInvite.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
      await prisma.schoolMembership.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
      await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
      fs.rmSync(TEST_ROOT, { recursive: true, force: true });
      console.log("  fixtures supprimées");
    } else {
      console.log(`  (fixtures conservées — école ${schoolId} ; G2X_CLEANUP=1 pour nettoyer)`);
    }
  }

  await prisma.$disconnect();
  console.log(`\n=== Recette transversale G2 : ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
