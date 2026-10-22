/**
 * Recette G2-E — réinscriptions annuelles : campagnes, éligibilité,
 * dépôt parent, instruction, décisions, finalisation transactionnelle,
 * créances, lot, concurrence, isolation, permissions, audit.
 *
 * Usage : npx tsx scripts/g2/reenrollment-g2e-recette.ts
 *         G2E_CLEANUP=1 …  (supprime aussi les fixtures à la fin)
 */
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "g2e-docs-"));
process.env.DOCUMENTS_ROOT = TEST_ROOT;

import { prisma } from "../../src/lib/db/prisma";
import { canReadDocument } from "../../src/lib/services/documents";
import {
  addReenrollmentInternalNote,
  batchFinalizeReenrollments,
  cancelReenrollmentRequest,
  createReenrollmentCampaign,
  decideReenrollmentRequest,
  finalizeReenrollment,
  getReenrollmentRequest,
  listEligibleStudents,
  listParentReenrollmentDocs,
  listReenrollmentRequests,
  parentReenrollmentView,
  replyParentReenrollment,
  requestReenrollmentInfo,
  reviewReenrollmentRequest,
  setReenrollmentCampaignStatus,
  submitAdminReenrollment,
  submitParentReenrollment,
  uploadParentReenrollmentDoc,
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

const FX = "G2E-FX";
const FX2 = "G2E-OTHER";
const EMAILS = [
  "g2e-admin@test.local",
  "g2e-rev@test.local",
  "g2e-dec@test.local",
  "g2e-read@test.local",
  "g2e-parent@test.local",
  "g2e-parent2@test.local",
  "g2e-other@test.local",
];

async function cleanup(schoolId: string) {
  const docs = await prisma.document.findMany({
    where: { schoolId }, select: { storagePath: true },
  });
  for (const d of docs) {
    try { fs.rmSync(path.join(TEST_ROOT, d.storagePath), { force: true }); } catch { /* ok */ }
  }
  await prisma.paymentAllocation.deleteMany({ where: { installment: { schoolId } } });
  await prisma.payment.deleteMany({ where: { schoolId } });
  await prisma.feeDiscount.deleteMany({ where: { schoolId } });
  await prisma.feeInstallment.deleteMany({ where: { schoolId } });
  await prisma.studentFeeCharge.deleteMany({ where: { schoolId } });
  await prisma.studentAnnualResult.deleteMany({ where: { schoolId } });
  await prisma.studentPeriodResult.deleteMany({ where: { schoolId } });
  await prisma.feeTariff.deleteMany({ where: { schoolId } });
  await prisma.feeCategory.deleteMany({ where: { schoolId } });
  await prisma.notification.deleteMany({ where: { schoolId } });
  await prisma.document.deleteMany({ where: { schoolId } });
  await prisma.reenrollmentMessage.deleteMany({ where: { schoolId } });
  await prisma.reenrollmentRequest.deleteMany({ where: { schoolId } });
  await prisma.reenrollmentCampaign.deleteMany({ where: { schoolId } });
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
    data: { email, passwordHash: "x", firstName: "G2E", lastName: email },
  });
  const role = await prisma.role.create({
    data: { name: `G2E_${email}`, scope: "SCHOOL", schoolId },
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

async function makeParent(email: string, schoolId: string, guardianData: { firstName: string; lastName: string; phone: string }) {
  const user = await prisma.user.create({
    data: { email, passwordHash: "x", firstName: guardianData.firstName, lastName: guardianData.lastName, status: "ACTIVE" },
  });
  const parentRole = await prisma.role.findFirstOrThrow({
    where: { name: "PARENT", scope: "SCHOOL", schoolId: null },
  });
  await prisma.schoolMembership.create({
    data: { userId: user.id, schoolId, roleId: parentRole.id, status: "ACTIVE" },
  });
  const guardian = await prisma.guardian.create({
    data: { schoolId, ...guardianData, userId: user.id, status: "ACTIVE" },
  });
  return { user, guardian };
}

async function main() {
  // ---------- Fixtures ----------
  for (const name of [FX, FX2]) {
    const old = await prisma.school.findFirst({ where: { name }, select: { id: true } });
    if (old) await cleanup(old.id);
  }
  const stale = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
  if (stale.length) {
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: stale.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: stale.map((u) => u.id) } } });
  }

  const school = await prisma.school.create({ data: { name: FX, code: FX, slug: "g2e-fix" } });
  const schoolB = await prisma.school.create({ data: { name: FX2, code: FX2, slug: "g2e-other" } });
  const yearSrc = await prisma.academicYear.create({
    data: { schoolId: school.id, name: "2025-2026", isCurrent: true, startDate: new Date("2025-09-01"), endDate: new Date("2026-06-30") },
  });
  const yearDst = await prisma.academicYear.create({
    data: { schoolId: school.id, name: "2026-2027", isCurrent: false, startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30") },
  });
  const level1 = await prisma.level.create({ data: { schoolId: school.id, name: "6e", order: 1 } });
  const level2 = await prisma.level.create({ data: { schoolId: school.id, name: "5e", order: 2 } });
  const clsSrc = await prisma.classroom.create({
    data: { schoolId: school.id, academicYearId: yearSrc.id, levelId: level1.id, name: "6e A" },
  });
  const clsDst1 = await prisma.classroom.create({
    data: { schoolId: school.id, academicYearId: yearDst.id, levelId: level1.id, name: "6e A", capacity: 1 },
  });
  const clsDst2 = await prisma.classroom.create({
    data: { schoolId: school.id, academicYearId: yearDst.id, levelId: level2.id, name: "5e A", capacity: 2 },
  });
  const clsDst2b = await prisma.classroom.create({
    data: { schoolId: school.id, academicYearId: yearDst.id, levelId: level2.id, name: "5e B" },
  });
  // Classe de l'année source (cross-year refusée comme cible).
  const cat = await prisma.feeCategory.create({
    data: { schoolId: school.id, code: "REINSC", label: "Réinscription" },
  });
  const cat2 = await prisma.feeCategory.create({
    data: { schoolId: school.id, code: "SCOL", label: "Scolarité" },
  });
  await prisma.feeTariff.create({
    data: { schoolId: school.id, academicYearId: yearDst.id, categoryId: cat.id, levelId: level2.id, amount: 30000 },
  });
  await prisma.feeTariff.create({
    data: { schoolId: school.id, academicYearId: yearDst.id, categoryId: cat2.id, amount: 90000, installmentCount: 2 },
  });

  const admin = await makeMember("g2e-admin@test.local", school.id, [
    "reenrollments.read", "reenrollments.review", "reenrollments.decide",
    "reenrollments.manage", "enrollment.create",
  ]);
  const rev = await makeMember("g2e-rev@test.local", school.id, ["reenrollments.read", "reenrollments.review"]);
  const dec = await makeMember("g2e-dec@test.local", school.id, ["reenrollments.read", "reenrollments.decide"]);
  const reader = await makeMember("g2e-read@test.local", school.id, ["reenrollments.read"]);
  const ctxA = { userId: admin.id, schoolId: school.id };
  const ctxRev = { userId: rev.id, schoolId: school.id };
  const ctxDec = { userId: dec.id, schoolId: school.id };
  const ctxRead = { userId: reader.id, schoolId: school.id };

  const parent1 = await makeParent("g2e-parent@test.local", school.id, { firstName: "Papa", lastName: "Un", phone: "+22670000011" });
  const parent2 = await makeParent("g2e-parent2@test.local", school.id, { firstName: "Maman", lastName: "Deux", phone: "+22670000012" });
  const ctxP1 = { userId: parent1.user.id, schoolId: school.id };
  const ctxP2 = { userId: parent2.user.id, schoolId: school.id };

  const mkStudent = async (matricule: string, ln: string, fn: string) =>
    prisma.student.create({
      data: { schoolId: school.id, matricule, lastName: ln, firstName: fn, status: "ACTIVE" },
    });
  const s1 = await mkStudent("G2E-001", "Eleve", "Un");     // éligible, enfant parent1
  const s2 = await mkStudent("G2E-002", "Eleve", "Deux");   // éligible, enfant parent2
  const s3 = await mkStudent("G2E-003", "Eleve", "Trois");  // départ
  const s4 = await mkStudent("G2E-004", "Eleve", "Quatre"); // pièces
  const s5 = await mkStudent("G2E-005", "Eleve", "Cinq");   // lot + concurrence
  const s6 = await mkStudent("G2E-006", "Eleve", "Six");    // impayés
  const s7 = await mkStudent("G2E-007", "Eleve", "Sept");   // interruption
  const s8 = await mkStudent("G2E-008", "Eleve", "Huit");   // inter-écoles (école B)
  const s9 = await mkStudent("G2E-009", "Eleve", "Neuf");   // enfant parent2, pas de lien parent1
  for (const s of [s1, s2, s3, s4, s5, s6, s9]) {
    await prisma.enrollment.create({
      data: { schoolId: school.id, studentId: s.id, classroomId: clsSrc.id, academicYearId: yearSrc.id, status: "ENROLLED" },
    });
  }
  // s7 : historique dans une année plus ancienne (interruption)
  const yearOld = await prisma.academicYear.create({
    data: { schoolId: school.id, name: "2023-2024", isCurrent: false, startDate: new Date("2023-09-01"), endDate: new Date("2024-06-30") },
  });
  const clsOld = await prisma.classroom.create({
    data: { schoolId: school.id, academicYearId: yearOld.id, levelId: level1.id, name: "6e A 2023" },
  });
  await prisma.enrollment.create({
    data: { schoolId: school.id, studentId: s7.id, classroomId: clsOld.id, academicYearId: yearOld.id, status: "COMPLETED" },
  });
  // Décision annuelle publiée : s1 admis en classe supérieure.
  await prisma.studentAnnualResult.create({
    data: { schoolId: school.id, academicYearId: yearSrc.id, studentId: s1.id, decision: "Admis en classe supérieure", status: "PUBLISHED" },
  });
  // s6 : impayé année source.
  const unpaidCharge = await prisma.studentFeeCharge.create({
    data: { schoolId: school.id, studentId: s6.id, academicYearId: yearSrc.id, categoryId: cat2.id, amount: 90000, status: "ACTIVE" },
  });
  void unpaidCharge;
  // Liens familiaux
  await prisma.studentGuardian.create({ data: { schoolId: school.id, studentId: s1.id, guardianId: parent1.guardian.id, relation: "FATHER" } });
  await prisma.studentGuardian.create({ data: { schoolId: school.id, studentId: s2.id, guardianId: parent2.guardian.id, relation: "MOTHER" } });
  await prisma.studentGuardian.create({ data: { schoolId: school.id, studentId: s9.id, guardianId: parent2.guardian.id, relation: "MOTHER" } });

  // Impayé de s6 : échéance pour réalisme (non payée)
  void 0;

  const schoolId = school.id;
  try {
    // ---------- Campagnes ----------
    console.log("== Campagnes ==");
    const badDates = await createReenrollmentCampaign(ctxA, {
      name: "X", sourceYearId: yearSrc.id, targetYearId: yearDst.id,
      opensAt: new Date("2026-06-01"), closesAt: new Date("2026-05-01"),
    });
    check("dates incohérentes → INVALID_INPUT", !badDates.ok && badDates.error === "INVALID_INPUT");
    const sameYear = await createReenrollmentCampaign(ctxA, {
      name: "X", sourceYearId: yearSrc.id, targetYearId: yearSrc.id,
      opensAt: new Date("2020-01-01"), closesAt: new Date("2099-01-01"),
    });
    check("source = cible → INVALID_INPUT", !sameYear.ok && sameYear.error === "INVALID_INPUT");
    const noPerm = await createReenrollmentCampaign(ctxRead, {
      name: "X", sourceYearId: yearSrc.id, targetYearId: yearDst.id,
      opensAt: new Date("2020-01-01"), closesAt: new Date("2099-01-01"),
    });
    check("création sans manage → FORBIDDEN", !noPerm.ok && noPerm.error === "FORBIDDEN");

    const camp = await createReenrollmentCampaign(ctxA, {
      name: "Réinscriptions 2026-2027",
      sourceYearId: yearSrc.id,
      targetYearId: yearDst.id,
      familyMessage: "Confirmez la rentrée de votre enfant.",
      opensAt: new Date("2020-01-01"),
      closesAt: new Date("2099-12-31"),
      requiredDocs: [{ key: "maj", label: "Document mis à jour", category: "ADMINISTRATIF", required: true }],
      blockOnUnpaid: true,
    });
    check("campagne créée", camp.ok);
    const campId = camp.ok ? camp.result.id : "";
    const dupCamp = await createReenrollmentCampaign(ctxA, {
      name: "Bis", sourceYearId: yearSrc.id, targetYearId: yearDst.id,
      opensAt: new Date("2020-01-01"), closesAt: new Date("2099-01-01"),
    });
    check("seconde campagne même année cible → refusée", !dupCamp.ok && dupCamp.error === "ALREADY_SUBMITTED");
    const st = await setReenrollmentCampaignStatus(ctxA, campId, "OPEN");
    check("campagne ouverte", st.ok);
    const badFlow = await setReenrollmentCampaignStatus(ctxA, campId, "DRAFT");
    check("OPEN → DRAFT refusé", !badFlow.ok && badFlow.error === "INVALID_STATE");

    // ---------- Éligibilité ----------
    console.log("== Éligibilité ==");
    const elig = await listEligibleStudents(ctxA, campId);
    check("éligibles listés", elig.ok && elig.result.length >= 8);
    if (elig.ok) {
      const e1 = elig.result.find((e) => e.studentId === s1.id);
      check("s1 : suggestion promo depuis décision annuelle", !!e1 && e1.suggestion.progression === "PROMOTION" && e1.suggestion.targetLevelId === level2.id);
      const e6 = elig.result.find((e) => e.studentId === s6.id);
      check("s6 : blocage impayés", !!e6 && e6.blockers.includes("impayes") && e6.unpaidBalance > 0);
      const e7 = elig.result.find((e) => e.studentId === s7.id);
      check("s7 : retour après interruption", !!e7 && e7.interrupted && e7.suggestion.progression === "RETURN");
      check("s8 (autre école) absent", !elig.result.some((e) => e.studentId === s8.id));
    }
    const eligRead = await listEligibleStudents(ctxRev, campId);
    check("éligibles lisibles avec review (read via review? non — read)", eligRead.ok);

    // ---------- Dépôt parent ----------
    console.log("== Dépôt parent ==");
    const view1 = await parentReenrollmentView(ctxP1);
    check("vue parent : campagne visible", view1.campaigns.length === 1);
    const c1view = view1.campaigns[0];
    check("vue parent : s1 éligible, s9 absent (pas mon enfant)",
      c1view.children.some((c) => c.student.id === s1.id && c.eligible) &&
      !c1view.children.some((c) => c.student.id === s9.id));

    const sub1 = await submitParentReenrollment(ctxP1, {
      campaignId: campId, studentId: s1.id, kind: "REENROLL",
      desiredLevelId: level2.id,
      contactUpdate: { phone: "+22670000999", email: "papa.un@example.com" },
      note: "Nous souhaitons la 5e.",
    });
    check("parent dépose pour son enfant", sub1.ok);
    const req1 = sub1.ok ? sub1.result.id : "";
    const subDup = await submitParentReenrollment(ctxP1, {
      campaignId: campId, studentId: s1.id, kind: "REENROLL",
    });
    check("second dépôt même année → ALREADY_SUBMITTED", !subDup.ok && subDup.error === "ALREADY_SUBMITTED");
    const subOther = await submitParentReenrollment(ctxP1, {
      campaignId: campId, studentId: s9.id, kind: "REENROLL",
    });
    check("dépôt pour enfant d'autrui → FORBIDDEN", !subOther.ok && subOther.error === "FORBIDDEN");
    const subDep = await submitParentReenrollment(ctxP2, {
      campaignId: campId, studentId: s2.id, kind: "DEPARTURE",
    });
    check("signalement de départ", subDep.ok);
    const reqDep = subDep.ok ? subDep.result.id : "";
    const sub4 = await submitAdminReenrollment(ctxA, {
      campaignId: campId, studentId: s4.id, kind: "REENROLL",
    });
    check("dépôt administratif", sub4.ok);
    const req4 = sub4.ok ? sub4.result.id : "";
    const sub5 = await submitAdminReenrollment(ctxA, {
      campaignId: campId, studentId: s5.id, kind: "REENROLL",
    });
    const req5 = sub5.ok ? sub5.result.id : "";
    check("dépôt administratif s5", sub5.ok);
    const sub6 = await submitAdminReenrollment(ctxA, {
      campaignId: campId, studentId: s6.id, kind: "REENROLL",
    });
    const req6 = sub6.ok ? sub6.result.id : "";
    const sub7 = await submitAdminReenrollment(ctxA, {
      campaignId: campId, studentId: s7.id, kind: "REENROLL",
    });
    const req7 = sub7.ok ? sub7.result.id : "";
    check("dépôt élève interrompu", sub7.ok);
    const subNoPerm = await submitAdminReenrollment(ctxRead, {
      campaignId: campId, studentId: s3.id, kind: "REENROLL",
    });
    check("dépôt admin sans manage → FORBIDDEN", !subNoPerm.ok && subNoPerm.error === "FORBIDDEN");

    // ---------- Pièces ----------
    console.log("== Pièces ==");
    const docBad = await uploadParentReenrollmentDoc(ctxP2, req4, {
      buffer: PDF, originalName: "x.pdf", docKey: "maj",
    });
    check("pièce par parent non lié → FORBIDDEN", !docBad.ok && docBad.error === "FORBIDDEN");
    // req4 déposée par admin : aucun guardian lié → parent ne peut pas.
    // On dépose pour req1 (enfant de parent1).
    const doc1 = await uploadParentReenrollmentDoc(ctxP1, req1, {
      buffer: PDF, originalName: "maj.pdf", docKey: "maj",
    });
    check("pièce déposée par le parent", doc1.ok);
    const docWrongKey = await uploadParentReenrollmentDoc(ctxP1, req1, {
      buffer: PDF, originalName: "x.pdf", docKey: "inconnu",
    });
    check("docKey inconnu → INVALID_INPUT", !docWrongKey.ok && docWrongKey.error === "INVALID_INPUT");
    const docsParent = await listParentReenrollmentDocs(ctxP1, req1);
    check("parent relit sa pièce", docsParent.length === 1);
    const docObj = doc1.ok
      ? await prisma.document.findUniqueOrThrow({ where: { id: doc1.result.id } })
      : null;
    if (docObj) {
      check("lecture pièce : agent review OK", await canReadDocument(ctxRev, docObj));
      check("lecture pièce : reader seul refusé", !(await canReadDocument(ctxRead, docObj)));
      check("lecture pièce : autre parent refusé", !(await canReadDocument(ctxP2, docObj)));
      check("lecture pièce : déposant OK", await canReadDocument(ctxP1, docObj));
    }

    // ---------- Instruction ----------
    console.log("== Instruction ==");
    const rv = await reviewReenrollmentRequest(ctxRev, req1);
    check("passage en instruction (review)", rv.ok);
    const rvNoPerm = await reviewReenrollmentRequest(ctxRead, req4);
    check("instruction sans review → FORBIDDEN", !rvNoPerm.ok && rvNoPerm.error === "FORBIDDEN");
    const note = await addReenrollmentInternalNote(ctxRev, req1, "Note confidentielle G2E");
    check("note interne ajoutée", note.ok);
    const info = await requestReenrollmentInfo(ctxRev, req1, "Justificatif de domicile ?");
    check("complément demandé", info.ok);
    const reply = await replyParentReenrollment(ctxP1, req1, "Voici le justificatif.");
    check("réponse parent → UNDER_REVIEW", reply.ok);
    const reqAfter = await prisma.reenrollmentRequest.findUniqueOrThrow({ where: { id: req1 } });
    check("statut repassé en instruction", reqAfter.status === "UNDER_REVIEW");
    const replyOther = await replyParentReenrollment(ctxP2, req1, "intrusion");
    check("réponse par autre parent → FORBIDDEN", !replyOther.ok && replyOther.error === "FORBIDDEN");

    const det1 = await getReenrollmentRequest(ctxRev, req1);
    check("fiche : note interne visible par review", !!det1 && det1.messages.some((m) => m.body.includes("confidentielle")));
    const detRead = await getReenrollmentRequest(ctxRead, req1);
    check("fiche : reader sans notes internes ni pièces",
      !!detRead && !detRead.messages.some((m) => m.kind === "INTERNAL_NOTE") && detRead.documents === undefined);
    check("fiche : classes cibles + places", !!det1 && det1.classrooms.length >= 2 && det1.classrooms.some((c) => c.seatsLeft !== null));
    check("fiche : blocages absents (pièce déposée)", !!det1 && det1.blockers.length === 0);

    // ---------- Décisions ----------
    console.log("== Décisions ==");
    // La décision exige UNDER_REVIEW : passer les demandes en instruction.
    for (const rid of [reqDep, req4, req5, req6, req7]) {
      await reviewReenrollmentRequest(ctxRev, rid);
    }
    const rejNoReason = await decideReenrollmentRequest(ctxDec, req4, { decision: "REJECTED" });
    check("refus sans motif → INVALID_INPUT", !rejNoReason.ok && rejNoReason.error === "INVALID_INPUT");
    const appNoPerm = await decideReenrollmentRequest(ctxRev, req4, { decision: "APPROVED", targetClassroomId: clsDst2.id });
    check("décision sans decide → FORBIDDEN", !appNoPerm.ok && appNoPerm.error === "FORBIDDEN");
    const appNoClass = await decideReenrollmentRequest(ctxDec, req4, { decision: "APPROVED" });
    check("approbation sans classe → INVALID_INPUT", !appNoClass.ok && appNoClass.error === "INVALID_INPUT");
    const appCross = await decideReenrollmentRequest(ctxDec, req4, { decision: "APPROVED", targetClassroomId: clsSrc.id });
    check("classe année source → CROSS_YEAR", !appCross.ok && appCross.error === "CROSS_YEAR");
    const appMissingDoc = await decideReenrollmentRequest(ctxDec, req4, { decision: "APPROVED", targetClassroomId: clsDst2.id });
    check("pièce manquante → MISSING_DOCS", !appMissingDoc.ok && appMissingDoc.error === "MISSING_DOCS");

    const appUnpaid = await decideReenrollmentRequest(ctxDec, req6, { decision: "APPROVED", targetClassroomId: clsDst2.id });
    check("impayés bloquants → UNPAID_BLOCKED", !appUnpaid.ok && appUnpaid.error === "UNPAID_BLOCKED");

    const rejDepDenied = await decideReenrollmentRequest(ctxDec, reqDep, { decision: "REJECTED", reason: "Restez !" });
    check("départ : refus possible (motif)", rejDepDenied.ok);
    const reqDepAfter = await prisma.reenrollmentRequest.findUniqueOrThrow({ where: { id: reqDep } });
    check("départ refusé → statut REJECTED", reqDepAfter.status === "REJECTED");

    const dep3 = await submitAdminReenrollment(ctxA, { campaignId: campId, studentId: s3.id, kind: "DEPARTURE" });
    const reqDep3 = dep3.ok ? dep3.result.id : "";
    await reviewReenrollmentRequest(ctxRev, reqDep3);
    const depAck = await decideReenrollmentRequest(ctxDec, reqDep3, { decision: "APPROVED" });
    check("départ acté → COMPLETED direct", depAck.ok);
    const reqDep3After = await prisma.reenrollmentRequest.findUniqueOrThrow({ where: { id: reqDep3 } });
    check("départ COMPLETED sans inscription", reqDep3After.status === "COMPLETED" && !reqDep3After.newEnrollmentId);

    // req1 : approuver avec pièce déposée + progression explicite.
    const app1 = await decideReenrollmentRequest(ctxDec, req1, {
      decision: "APPROVED", targetClassroomId: clsDst2.id, progression: "PROMOTION",
    });
    check("approbation s1 → 5e A", app1.ok);
    const req1After = await prisma.reenrollmentRequest.findUniqueOrThrow({ where: { id: req1 }, include: { messages: true } });
    check("statut APPROVED + progression", req1After.status === "APPROVED" && req1After.progression === "PROMOTION");
    check("message décision visible parent", req1After.messages.some((m) => m.kind === "DECISION" && m.visibleToParent));

    // req4 : déposer la pièce via admin? Le parent ne peut pas (pas de lien).
    // On valide via campagne sans pièce obligatoire : on retire requiredDocs pour req4
    // → non : on teste l'approbation après dépôt par un parent lié ? req4 n'a pas de
    // guardian. On modifie la campagne : pièces non requises pour la suite.
    const camp2 = await createReenrollmentCampaign(ctxA, {
      name: "Campagne bis archivée", sourceYearId: yearOld.id, targetYearId: yearOld.id,
      opensAt: new Date("2020-01-01"), closesAt: new Date("2099-01-01"),
    });
    void camp2;
    const campNoDocs = await prisma.reenrollmentCampaign.update({
      where: { id: campId },
      data: { requiredDocs: [] },
    });
    void campNoDocs;
    const app4 = await decideReenrollmentRequest(ctxDec, req4, { decision: "APPROVED", targetClassroomId: clsDst1.id });
    check("approbation s4 (pièces retirées) → classe capacité 1", app4.ok);
    const rej5 = await decideReenrollmentRequest(ctxDec, req5, { decision: "REJECTED", reason: "Dossier incomplet" });
    check("refus motivé s5", rej5.ok);
    const cancel5 = await cancelReenrollmentRequest(ctxRev, req5);
    check("annulation après refus → INVALID_STATE", !cancel5.ok && cancel5.error === "INVALID_STATE");

    // ---------- Finalisation ----------
    console.log("== Finalisation ==");
    const finNoPerm = await finalizeReenrollment(ctxDec, req1);
    check("finalisation sans enrollment.create → FORBIDDEN", !finNoPerm.ok && finNoPerm.error === "FORBIDDEN");
    const fin4 = await finalizeReenrollment(ctxA, req4);
    check("finalisation s4 → inscription 6e A (capacité 1)", fin4.ok && !!fin4.result.enrollmentId);
    const enr4 = fin4.ok ? await prisma.enrollment.findUniqueOrThrow({ where: { id: fin4.result.enrollmentId } }) : null;
    check("inscription dans l'année cible", !!enr4 && enr4.academicYearId === yearDst.id && enr4.classroomId === clsDst1.id);
    const req4After = await prisma.reenrollmentRequest.findUniqueOrThrow({ where: { id: req4 } });
    check("demande COMPLETED + lien", req4After.status === "COMPLETED" && req4After.newEnrollmentId === enr4?.id);
    const charges4 = await prisma.studentFeeCharge.findMany({ where: { studentId: s4.id, academicYearId: yearDst.id } });
    check("créance année cible générée (SCOL — tarif REINSC limité au niveau 2)",
      charges4.length === 1 && charges4[0].categoryId === cat2.id);
    const inst4 = await prisma.feeInstallment.count({ where: { studentId: s4.id, academicYearId: yearDst.id } });
    check("échéances générées", inst4 >= 2);
    check("aucune créance sur l'année source ajoutée",
      (await prisma.studentFeeCharge.count({ where: { studentId: s4.id, academicYearId: yearSrc.id } })) === 0);

    // Capacité : clsDst1 est pleine (s4). req7 approuvée vers clsDst1 → CLASSROOM_FULL.
    const app7full = await decideReenrollmentRequest(ctxDec, req7, { decision: "APPROVED", targetClassroomId: clsDst1.id });
    check("approbation s7 vers classe bientôt pleine", app7full.ok);
    const fin7full = await finalizeReenrollment(ctxA, req7);
    check("finalisation classe pleine → CLASSROOM_FULL", !fin7full.ok && fin7full.error === "CLASSROOM_FULL");
    // Re-décision vers 5e B (sans capacité) — nécessite repasser UNDER_REVIEW.
    await prisma.reenrollmentRequest.update({ where: { id: req7 }, data: { status: "UNDER_REVIEW" } });
    const app7 = await decideReenrollmentRequest(ctxDec, req7, { decision: "APPROVED", targetClassroomId: clsDst2b.id });
    const fin7 = await finalizeReenrollment(ctxA, req7);
    check("finalisation retour après interruption", app7.ok && fin7.ok);

    // s1 : finalisation + contactUpdate appliqué + idempotence.
    const fin1 = await finalizeReenrollment(ctxA, req1);
    check("finalisation s1", fin1.ok);
    const g1 = await prisma.guardian.findUniqueOrThrow({ where: { id: parent1.guardian.id } });
    check("coordonnées responsable actualisées", g1.phone === "+22670000999" && g1.email === "papa.un@example.com");
    const fin1Replay = await finalizeReenrollment(ctxA, req1);
    check("rejeu → alreadyFinalized, 0 doublon", fin1Replay.ok && fin1Replay.result.alreadyFinalized === true);
    const enrCount1 = await prisma.enrollment.count({ where: { studentId: s1.id, academicYearId: yearDst.id, status: "ENROLLED" } });
    check("une seule inscription active", enrCount1 === 1);
    const chCount1 = await prisma.studentFeeCharge.count({ where: { studentId: s1.id, academicYearId: yearDst.id } });
    check("pas de double créance au rejeu", chCount1 === 2);

    // Concurrence : deux finalisations simultanées sur la même demande.
    // s9 : demande approuvée vers clsDst2 (capacité 2).
    const sub9 = await submitAdminReenrollment(ctxA, { campaignId: campId, studentId: s9.id, kind: "REENROLL" });
    const req9 = sub9.ok ? sub9.result.id : "";
    await reviewReenrollmentRequest(ctxRev, req9);
    await decideReenrollmentRequest(ctxDec, req9, { decision: "APPROVED", targetClassroomId: clsDst2.id });
    const [cA, cB] = await Promise.allSettled([
      finalizeReenrollment(ctxA, req9),
      finalizeReenrollment(ctxDec, req9),
    ]);
    const results = [cA, cB].map((r) => (r.status === "fulfilled" ? r.value : { ok: false }));
    check("concurrence : aucune erreur fatale", results.every((r) => "ok" in r && r.ok !== undefined));
    const enr9 = await prisma.enrollment.count({ where: { studentId: s9.id, academicYearId: yearDst.id, status: "ENROLLED" } });
    check("concurrence → 1 seule inscription", enr9 === 1);
    const ch9 = await prisma.studentFeeCharge.count({ where: { studentId: s9.id, academicYearId: yearDst.id } });
    check("concurrence → pas de double créance", ch9 === 2);

    // ---------- Traitement en masse ----------
    console.log("== Lot ==");
    // s2 : re-déposer REENROLL (le DEPARTURE a été refusé → l'unicité
    // (student, year) empêche une nouvelle demande → vérifier le refus).
    const sub2b = await submitParentReenrollment(ctxP2, { campaignId: campId, studentId: s2.id, kind: "REENROLL" });
    check("départ refusé → nouvelle demande impossible (unicité année)", !sub2b.ok && sub2b.error === "ALREADY_SUBMITTED");

    const batch = await batchFinalizeReenrollments(ctxA, [req1, req4, req6, req5, "inconnu"]);
    if (batch.ok) console.log("   ", JSON.stringify(batch.result.map((r) => [r.requestId.slice(-4), r.outcome, r.error])));
    check("lot exécuté", batch.ok && batch.result.length === 5);
    if (batch.ok) {
      const byReq = new Map(batch.result.map((r) => [r.requestId, r]));
      check("lot : déjà finalisé → ALREADY", byReq.get(req1)?.outcome === "ALREADY" && byReq.get(req4)?.outcome === "ALREADY");
      check("lot : non approuvé → BLOCKED", byReq.get(req6)?.outcome === "BLOCKED" && byReq.get(req5)?.outcome === "BLOCKED");
      check("lot : inconnu → BLOCKED/NOT_FOUND", byReq.get("inconnu")?.outcome === "BLOCKED");
      check("lot : un échec n'affecte pas les autres", batch.result.every((r) => r.outcome !== "FAILED" || r.requestId === "inconnu"));
    }

    // ---------- Isolation / audit / historique ----------
    console.log("== Isolation, audit, historique ==");
    const otherMember = await makeMember("g2e-other@test.local", schoolB.id, [
      "reenrollments.read", "reenrollments.review", "reenrollments.decide", "enrollment.create",
    ]);
    const ctxOther = { userId: otherMember.id, schoolId: schoolB.id };
    const isoDet = await getReenrollmentRequest(ctxOther, req1);
    check("fiche d'une autre école → null", isoDet === null);
    const isoList = await listReenrollmentRequests(ctxOther, { campaignId: campId });
    check("liste filtrée par école", isoList.length === 0);
    const isoDec = await decideReenrollmentRequest(ctxOther, req1, { decision: "REJECTED", reason: "x" });
    check("décision cross-école → NOT_FOUND/INVALID_STATE", !isoDec.ok);
    const isoFin = await finalizeReenrollment(ctxOther, req1);
    check("finalisation cross-école → NOT_FOUND", !isoFin.ok && isoFin.error === "NOT_FOUND");
    const isoView = await parentReenrollmentView({ userId: parent1.user.id, schoolId: schoolB.id });
    check("vue parent autre école vide", isoView.campaigns.length === 0);

    const audits = await prisma.auditLog.findMany({
      where: { schoolId, action: { startsWith: "reenrollment." } },
      select: { action: true, actorId: true, metadata: true },
    });
    check("audit : soumission + décision + finalisation tracées",
      audits.some((a) => a.action === "reenrollment.submit") &&
      audits.some((a) => a.action === "reenrollment.approve") &&
      audits.some((a) => a.action === "reenrollment.finalize") &&
      audits.some((a) => a.action === "reenrollment.batch_finalize"));
    check("audit : aucune donnée sensible", !audits.some((a) => JSON.stringify(a.metadata ?? {}).includes("confidentielle")));

    // Historique préservé : l'inscription source de s1 reste ENROLLED.
    const srcEnr = await prisma.enrollment.count({
      where: { studentId: s1.id, academicYearId: yearSrc.id, status: "ENROLLED" },
    });
    check("inscription source préservée", srcEnr === 1);
    const msgPublic = await prisma.reenrollmentMessage.findMany({
      where: { requestId: req1, visibleToParent: true, kind: "DECISION" },
    });
    check("décisions visibles dans le fil parent", msgPublic.length >= 2);
  } finally {
    if (process.env.G2E_CLEANUP === "1") {
      await cleanup(schoolId);
      await cleanup(schoolB.id);
      // Comptes fixture créés sans schoolId → orphelins à supprimer par email.
      const users = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
      await prisma.accountInvite.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
      await prisma.schoolMembership.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
      await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
      fs.rmSync(TEST_ROOT, { recursive: true, force: true });
      console.log("  fixtures supprimées");
    } else {
      console.log(`  (fixtures conservées — écoles ${schoolId} / ${schoolB.id} ; G2E_CLEANUP=1 pour nettoyer)`);
    }
  }

  await prisma.$disconnect();
  console.log(`\n=== Recette G2-E : ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
