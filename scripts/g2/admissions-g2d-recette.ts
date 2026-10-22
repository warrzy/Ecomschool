/**
 * Recette G2-D — conversion des candidatures en inscriptions définitives :
 * nouvel élève / rattachement, responsable existant / nouveau, candidat
 * majeur, conditions non levées, refus, classe complète, année invalide,
 * pièce manquante, doublon ambigu, conversions simultanées, rejeu
 * idempotent, rollback complet, absence de double créance, isolation
 * inter-établissements, permissions, audit, portail parent.
 *
 * Usage : npx tsx scripts/g2/admissions-g2d-recette.ts
 *         G2D_CLEANUP=1 …  (supprime aussi les fixtures à la fin)
 */
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "g2d-docs-"));
process.env.DOCUMENTS_ROOT = TEST_ROOT;
process.env.ADMISSIONS_TICKET_SECRET = "g2d-recette-secret";

import { prisma } from "../../src/lib/db/prisma";
import {
  createCampaign,
  decideApplication,
  getTrackingView,
  setCampaignStatus,
  submitApplication,
} from "../../src/lib/services/admissions";
import {
  convertApplication,
  inviteConvertedAccount,
  liftConditions,
  previewConversion,
} from "../../src/lib/services/admissionConversion";

let pass = 0, fail = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};

const PDF = Buffer.concat([
  Buffer.from("%PDF-1.4\n"),
  Buffer.from("1 0 obj <<>> endobj\n%%EOF\n"),
]);

const FX = "G2D-FX";
const SLUG = "g2d-fix";
const EMAILS = [
  "g2d-admin@test.local",
  "g2d-cv@test.local",
  "g2d-dec@test.local",
  "g2d-read@test.local",
  "g2d-cvonly@test.local",
  "g2d-other@test.local",
  "parent.g2d@test.local",
];

async function cleanup(schoolId: string) {
  const docs = await prisma.document.findMany({
    where: { schoolId }, select: { storagePath: true },
  });
  for (const d of docs) {
    try { fs.rmSync(path.join(TEST_ROOT, d.storagePath), { force: true }); } catch { /* ok */ }
  }
  await prisma.feeInstallment.deleteMany({ where: { schoolId } });
  await prisma.studentFeeCharge.deleteMany({ where: { schoolId } });
  await prisma.feeTariff.deleteMany({ where: { schoolId } });
  await prisma.feeCategory.deleteMany({ where: { schoolId } });
  await prisma.notification.deleteMany({ where: { schoolId } });
  await prisma.document.deleteMany({ where: { schoolId } });
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
  // Comptes invités rattachés à l'école (User.schoolId → FK restrictive).
  const schoolUsers = await prisma.user.findMany({
    where: { schoolId }, select: { id: true },
  });
  if (schoolUsers.length) {
    await prisma.accountInvite.deleteMany({
      where: { userId: { in: schoolUsers.map((u) => u.id) } },
    });
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
    data: { email, passwordHash: "x", firstName: "G2D", lastName: email },
  });
  const role = await prisma.role.create({
    data: { name: `G2D_${email}`, scope: "SCHOOL", schoolId },
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

let seq = 0;
async function submit(
  campaignId: string,
  levelId: string,
  opts: {
    selfApplicant?: boolean;
    firstName?: string;
    phone?: string;
    email?: string;
  } = {},
) {
  seq += 1;
  const res = await submitApplication({
    campaignId,
    selfApplicant: opts.selfApplicant ?? false,
    guardianFirstName: "Parent",
    guardianLastName: "G2D",
    guardianRelation: "Père",
    guardianPhone: opts.phone ?? `+22670002${String(seq).padStart(3, "0")}`,
    guardianEmail: opts.email,
    children: [{
      firstName: opts.firstName ?? `Candidat${seq}`,
      lastName: "G2D",
      birthDate: "2015-03-03",
      targetLevelId: levelId,
    }],
    files: [{ childIndex: 0, docKey: "naissance", category: "IDENTITE", buffer: PDF, originalName: "n.pdf" }],
  });
  if (!res.ok) return null;
  const app = await prisma.admissionApplication.findUnique({
    where: { fileNumber: res.result.fileNumbers[0]! },
  });
  return { app: app!, secret: res.result.trackingSecret!, fileNumber: res.result.fileNumbers[0]! };
}

(async () => {
  const olds = await prisma.school.findMany({
    where: { OR: [{ name: { in: [FX, "G2D-AUTRE"] } }, { slug: { in: [SLUG, "g2d-autre"] } }] },
    select: { id: true },
  });
  for (const o of olds) await cleanup(o.id);
  const stale = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
  if (stale.length) {
    await prisma.accountInvite.deleteMany({ where: { userId: { in: stale.map((u) => u.id) } } });
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: stale.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: stale.map((u) => u.id) } } });
  }

  const school = await prisma.school.create({ data: { name: FX, code: FX, slug: SLUG } });
  const year = await prisma.academicYear.create({
    data: { schoolId: school.id, name: "2026-2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30"), status: "ACTIVE", isCurrent: true },
  });
  const oldYear = await prisma.academicYear.create({
    data: { schoolId: school.id, name: "2025-2026", startDate: new Date("2025-09-01"), endDate: new Date("2026-06-30"), status: "CLOSED" },
  });
  const level = await prisma.level.create({ data: { schoolId: school.id, name: "6e", order: 1 } });
  const clsA = await prisma.classroom.create({
    data: { schoolId: school.id, academicYearId: year.id, levelId: level.id, name: "6e A", capacity: 20 },
  });
  const clsFull = await prisma.classroom.create({
    data: { schoolId: school.id, academicYearId: year.id, levelId: level.id, name: "6e B", capacity: 1 },
  });
  // Classe B saturée : un élève déjà ENROLLED occupe la seule place.
  const stFiller = await prisma.student.create({
    data: { schoolId: school.id, matricule: "FILL-01", firstName: "Occupe", lastName: "Place" },
  });
  await prisma.enrollment.create({
    data: { schoolId: school.id, studentId: stFiller.id, classroomId: clsFull.id, academicYearId: year.id, status: "ENROLLED" },
  });
  const clsOldYear = await prisma.classroom.create({
    data: { schoolId: school.id, academicYearId: oldYear.id, levelId: level.id, name: "6e ancienne" },
  });
  const cat = await prisma.feeCategory.create({
    data: { schoolId: school.id, code: "INSC", label: "Frais d'inscription" },
  });
  const cat2 = await prisma.feeCategory.create({
    data: { schoolId: school.id, code: "SCOL", label: "Scolarité" },
  });
  await prisma.feeTariff.create({
    data: { schoolId: school.id, academicYearId: year.id, categoryId: cat.id, levelId: level.id, amount: 25000 },
  });
  await prisma.feeTariff.create({
    data: { schoolId: school.id, academicYearId: year.id, categoryId: cat2.id, amount: 120000, installmentCount: 3 },
  });

  const admin = await makeMember("g2d-admin@test.local", school.id, [
    "admissions.read", "admissions.review", "admissions.decide",
    "admissions.manage", "admissions.convert",
    "student.create", "enrollment.create", "guardian.manage",
  ]);
  const converter = await makeMember("g2d-cv@test.local", school.id, [
    "admissions.read", "admissions.convert",
    "student.create", "enrollment.create", "guardian.manage",
  ]);
  const decider = await makeMember("g2d-dec@test.local", school.id, [
    "admissions.read", "admissions.decide", "admissions.convert", "enrollment.create",
  ]);
  const reader = await makeMember("g2d-read@test.local", school.id, ["admissions.read"]);
  const cvOnly = await makeMember("g2d-cvonly@test.local", school.id, ["admissions.convert"]);
  const ctxA = { userId: admin.id, schoolId: school.id };
  const ctxCv = { userId: converter.id, schoolId: school.id };
  const ctxDec = { userId: decider.id, schoolId: school.id };
  const ctxRead = { userId: reader.id, schoolId: school.id };
  const ctxCvOnly = { userId: cvOnly.id, schoolId: school.id };

  const cRes = await createCampaign(ctxA, {
    name: "Campagne G2D",
    academicYearId: year.id,
    opensAt: "2020-01-01",
    closesAt: "2099-12-31",
    targetLevelIds: [level.id],
    trainingOptions: [],
    requiredDocs: [{ key: "naissance", label: "Extrait de naissance", category: "IDENTITE", required: true }],
  });
  const campaignId = cRes.ok ? cRes.result.id : "";
  await setCampaignStatus(ctxA, campaignId, "OPEN");

  // ---------- Nouvel élève + nouveau responsable ----------
  console.log("\n== Conversion : nouvel élève, nouveau responsable ==");
  const s1 = await submit(campaignId, level.id, { email: "parent.g2d@test.local" });
  check("candidature déposée", !!s1);
  await decideApplication(ctxDec, s1!.app.id, "ACCEPTED", { reason: "dossier complet" });

  const pvDenied = await previewConversion(ctxRead, s1!.app.id);
  check("preview sans admissions.convert → null", pvDenied === null);
  const pv1 = await previewConversion(ctxCv, s1!.app.id);
  check("preview éligible, aucun blocage",
    !!pv1 && pv1.eligible && pv1.blockers.length === 0);
  check("preview : classes listées avec places",
    !!pv1 && pv1.classrooms.some((c) => c.id === clsA.id && c.seatsLeft === 20));
  check("preview : créances estimées (2 tarifs)",
    !!pv1 && pv1.chargesPreview.length === 2);
  check("preview : classe cible présélectionnée", !!pv1 && !!pv1.classrooms.find((c) => c.selected));

  const cvDenied = await convertApplication(ctxRead, {
    applicationId: s1!.app.id, classroomId: clsA.id, matricule: "G2D-001",
  });
  check("conversion sans admissions.convert → FORBIDDEN",
    !cvDenied.ok && cvDenied.error === "FORBIDDEN");
  const cvNoEnroll = await convertApplication(ctxCvOnly, {
    applicationId: s1!.app.id, classroomId: clsA.id, matricule: "G2D-001",
  });
  check("convert sans enrollment.create → FORBIDDEN",
    !cvNoEnroll.ok && cvNoEnroll.error === "FORBIDDEN");
  const cvNoStudent = await convertApplication(ctxDec, {
    applicationId: s1!.app.id, classroomId: clsA.id, matricule: "G2D-001",
  });
  check("convert sans student.create (nouvel élève) → FORBIDDEN",
    !cvNoStudent.ok && cvNoStudent.error === "FORBIDDEN");

  const cv1 = await convertApplication(ctxCv, {
    applicationId: s1!.app.id, classroomId: clsA.id, matricule: "G2D-001",
  });
  check("conversion réussie", cv1.ok && !cv1.result.alreadyConverted);
  const r1 = cv1.ok ? cv1.result : null;
  check("élève créé", !!r1?.studentId);
  check("responsable créé + lié", !!r1?.guardianId);
  check("inscription créée", !!r1?.enrollmentId);
  check("2 créances générées", r1?.charges.created === 2);
  check("aucune erreur créances", r1?.chargesError === null);
  const app1 = await prisma.admissionApplication.findUnique({ where: { id: s1!.app.id } });
  check("statut CONVERTED + références", app1?.status === "CONVERTED" && app1.studentId === r1?.studentId && app1.enrollmentId === r1?.enrollmentId && !!app1.convertedById);
  const link1 = await prisma.studentGuardian.findFirst({
    where: { studentId: r1!.studentId, guardianId: r1!.guardianId! },
  });
  check("relation Père → FATHER", link1?.relation === "FATHER");
  const enroll1 = await prisma.enrollment.findUnique({
    where: { id: r1!.enrollmentId! }, select: { status: true, academicYearId: true },
  });
  check("inscription ENROLLED sur l'année cible",
    enroll1?.status === "ENROLLED" && enroll1.academicYearId === year.id);
  const ev1 = await prisma.admissionEvent.findFirst({
    where: { applicationId: app1!.id, toStatus: "CONVERTED" },
  });
  const msg1 = await prisma.admissionMessage.findFirst({
    where: { applicationId: app1!.id, kind: "CONVERSION", visibleToApplicant: true },
  });
  check("événement + message public de conversion", !!ev1 && !!msg1);
  const audit1 = await prisma.auditLog.findFirst({
    where: { schoolId: school.id, action: "admissions.convert", entityId: app1!.id },
  });
  check("audit admissions.convert (auteur, ids, sans secret)",
    !!audit1 && audit1.actorId === converter.id
    && !JSON.stringify(audit1.metadata).includes(s1!.secret));

  // Rejeu idempotent
  const cv1b = await convertApplication(ctxCv, {
    applicationId: s1!.app.id, classroomId: clsA.id,
  });
  check("rejeu → alreadyConverted", cv1b.ok && cv1b.result.alreadyConverted === true);
  check("rejeu : 0 créance supplémentaire", cv1b.ok && cv1b.result.charges.created === 0);
  const chargeCount = await prisma.studentFeeCharge.count({
    where: { schoolId: school.id, studentId: r1!.studentId },
  });
  check("aucune double créance après rejeu", chargeCount === 2);

  // ---------- Élève existant + responsable existant ----------
  console.log("\n== Conversion : élève et responsable existants ==");
  const st = await prisma.student.create({
    data: { schoolId: school.id, matricule: "EX-001", firstName: "CandidatX", lastName: "G2D", birthDate: new Date("2015-03-03") },
  });
  const gd = await prisma.guardian.create({
    data: { schoolId: school.id, firstName: "Parent", lastName: "G2D", phone: "+22670002999" },
  });
  const s2 = await submit(campaignId, level.id, { firstName: "CandidatX", phone: "+22670002999" });
  await decideApplication(ctxDec, s2!.app.id, "ACCEPTED");

  const pv2 = await previewConversion(ctxCv, s2!.app.id);
  check("preview : doublon élève détecté", !!pv2 && pv2.duplicates.some((d) => d.id === st.id));
  check("preview : responsable candidat détecté", !!pv2 && pv2.guardianCandidates.some((g) => g.id === gd.id));
  check("preview : blocages doublon + responsable",
    !!pv2 && pv2.blockers.includes("doublons_a_arbitrer") && pv2.blockers.includes("responsable_a_arbitrer"));

  const cvAmb = await convertApplication(ctxCv, {
    applicationId: s2!.app.id, classroomId: clsA.id, matricule: "G2D-002",
  });
  check("doublon sans arbitrage → DUPLICATE_AMBIGUOUS",
    !cvAmb.ok && cvAmb.error === "DUPLICATE_AMBIGUOUS");
  const cvG = await convertApplication(ctxCv, {
    applicationId: s2!.app.id, classroomId: clsA.id,
    matricule: "G2D-002", acknowledgeDuplicates: true,
  });
  check("responsable non arbitré → GUARDIAN_AMBIGUOUS",
    !cvG.ok && cvG.error === "GUARDIAN_AMBIGUOUS");
  const cv2 = await convertApplication(ctxCv, {
    applicationId: s2!.app.id, classroomId: clsA.id,
    studentId: st.id, guardianId: gd.id,
  });
  check("conversion vers élève + responsable existants",
    cv2.ok && cv2.result.studentId === st.id && cv2.result.guardianId === gd.id);
  const link2 = await prisma.studentGuardian.findFirst({
    where: { studentId: st.id, guardianId: gd.id },
  });
  check("responsable rattaché à l'élève existant", !!link2);
  check("aucune fiche élève dupliquée",
    (await prisma.student.count({ where: { schoolId: school.id, matricule: "G2D-002" } })) === 0);

  // ---------- Candidat majeur ----------
  console.log("\n== Candidat majeur (selfApplicant) ==");
  const s3 = await submit(campaignId, level.id, { selfApplicant: true });
  await decideApplication(ctxDec, s3!.app.id, "ACCEPTED");
  const cv3 = await convertApplication(ctxCv, {
    applicationId: s3!.app.id, classroomId: clsA.id, matricule: "G2D-003",
  });
  check("conversion candidat majeur", cv3.ok && cv3.result.guardianId === null);
  const st3 = await prisma.student.findUnique({ where: { id: cv3.ok ? cv3.result.studentId : "" } });
  check("coordonnées du majeur reportées sur l'élève",
    !!st3 && st3.phone === (await prisma.admissionApplication.findUnique({ where: { id: s3!.app.id } }))!.guardianPhone);

  // ---------- Admission conditionnelle ----------
  console.log("\n== Conditions et blocages ==");
  const s4 = await submit(campaignId, level.id);
  await decideApplication(ctxDec, s4!.app.id, "CONDITIONALLY_ACCEPTED", { conditions: "bulletin final" });
  const cv4a = await convertApplication(ctxCv, {
    applicationId: s4!.app.id, classroomId: clsA.id, matricule: "G2D-004",
  });
  check("conditionnelle non levée → CONDITIONS_PENDING",
    !cv4a.ok && cv4a.error === "CONDITIONS_PENDING");
  const liftDeny = await liftConditions(ctxRead, s4!.app.id);
  check("levée sans admissions.decide → FORBIDDEN", !liftDeny.ok && liftDeny.error === "FORBIDDEN");
  const liftOk = await liftConditions(ctxDec, s4!.app.id, "bulletin reçu");
  check("conditions levées", liftOk.ok);
  const cv4b = await convertApplication(ctxCv, {
    applicationId: s4!.app.id, classroomId: clsA.id, matricule: "G2D-004",
  });
  check("conversion après levée", cv4b.ok);

  // Refusé
  const s5 = await submit(campaignId, level.id);
  await decideApplication(ctxDec, s5!.app.id, "REJECTED", { reason: "profil" });
  const cv5 = await convertApplication(ctxCv, {
    applicationId: s5!.app.id, classroomId: clsA.id, matricule: "G2D-005",
  });
  check("candidature refusée → INVALID_STATE", !cv5.ok && cv5.error === "INVALID_STATE");

  // Classe pleine
  const s6 = await submit(campaignId, level.id);
  await decideApplication(ctxDec, s6!.app.id, "ACCEPTED");
  const cv6a = await convertApplication(ctxCv, {
    applicationId: s6!.app.id, classroomId: clsFull.id, matricule: "G2D-006",
  });
  check("classe pleine → CLASSROOM_FULL", !cv6a.ok && cv6a.error === "CLASSROOM_FULL");
  const cv6b = await convertApplication(ctxCv, {
    applicationId: s6!.app.id, classroomId: clsA.id, matricule: "G2D-006",
  });
  check("classe alternative → conversion OK", cv6b.ok);

  // Année invalide : classe d'une autre année
  const s7 = await submit(campaignId, level.id);
  await decideApplication(ctxDec, s7!.app.id, "ACCEPTED");
  const cv7 = await convertApplication(ctxCv, {
    applicationId: s7!.app.id, classroomId: clsOldYear.id, matricule: "G2D-007",
  });
  check("classe d'une autre année → CROSS_YEAR", !cv7.ok && cv7.error === "CROSS_YEAR");
  check("rollback : aucun élève créé sur échec",
    (await prisma.student.count({ where: { schoolId: school.id, matricule: "G2D-007" } })) === 0
    && (await prisma.admissionApplication.findUnique({ where: { id: s7!.app.id } }))!.status === "ACCEPTED");

  // Pièce obligatoire manquante (exigence ajoutée après dépôt)
  await prisma.admissionCampaign.update({
    where: { id: campaignId },
    data: {
      requiredDocs: [
        { key: "naissance", label: "Extrait de naissance", category: "IDENTITE", required: true },
        { key: "photo", label: "Photo d'identité", category: "PHOTO", required: true },
      ],
    },
  });
  const cv7b = await convertApplication(ctxCv, {
    applicationId: s7!.app.id, classroomId: clsA.id, matricule: "G2D-007",
  });
  check("pièce obligatoire manquante → MISSING_DOCS",
    !cv7b.ok && cv7b.error === "MISSING_DOCS");
  const pv7 = await previewConversion(ctxCv, s7!.app.id);
  check("preview liste la pièce manquante",
    !!pv7 && pv7.missingDocs.includes("Photo d'identité") && pv7.blockers.includes("pieces_manquantes"));
  // Levée du blocage : exigence retirée puis conversion.
  await prisma.admissionCampaign.update({
    where: { id: campaignId },
    data: { requiredDocs: [{ key: "naissance", label: "Extrait de naissance", category: "IDENTITE", required: true }] },
  });
  const cv7c = await convertApplication(ctxCv, {
    applicationId: s7!.app.id, classroomId: clsA.id, matricule: "G2D-007",
  });
  check("conversion après conformité des pièces", cv7c.ok);

  // ---------- Concurrence ----------
  console.log("\n== Concurrence et idempotence ==");
  const s8 = await submit(campaignId, level.id);
  await decideApplication(ctxDec, s8!.app.id, "ACCEPTED");
  const [ca, cb] = await Promise.all([
    convertApplication(ctxCv, {
      applicationId: s8!.app.id, classroomId: clsA.id, matricule: "G2D-008a",
    }),
    convertApplication(ctxCv, {
      applicationId: s8!.app.id, classroomId: clsA.id, matricule: "G2D-008b",
    }),
  ]);
  const wins = [ca, cb].filter((r) => r.ok);
  if (!(wins.length === 2)) console.log("   ", JSON.stringify({ ca, cb }));
  check("deux conversions simultanées → 1 seule inscription",
    wins.length === 2
    && wins.filter((w) => !w.result.alreadyConverted).length === 1
    && (await prisma.enrollment.count({
      where: { schoolId: school.id, student: { firstName: `Candidat${seq}` } },
    })) === 1);
  check("aucun élève dupliqué en concurrence",
    (await prisma.student.count({
      where: { schoolId: school.id, firstName: `Candidat${seq}`, lastName: "G2D" },
    })) === 1);

  // Isolation inter-établissements
  const other = await prisma.school.create({ data: { name: "G2D-AUTRE", code: "G2D-AUTRE", slug: "g2d-autre" } });
  const otherCv = await makeMember("g2d-other@test.local", other.id, [
    "admissions.convert", "enrollment.create", "student.create", "guardian.manage",
  ]);
  const s9 = await submit(campaignId, level.id);
  await decideApplication(ctxDec, s9!.app.id, "ACCEPTED");
  const cvX = await convertApplication(
    { userId: otherCv.id, schoolId: other.id },
    { applicationId: s9!.app.id, classroomId: clsA.id, matricule: "G2D-009" },
  );
  check("conversion depuis une autre école → NOT_FOUND",
    !cvX.ok && cvX.error === "NOT_FOUND");
  const pvX = await previewConversion({ userId: converter.id, schoolId: other.id }, s9!.app.id);
  check("preview inter-écoles → null", pvX === null);

  // ---------- Invitation portail ----------
  console.log("\n== Portail parent ==");
  const inv1 = await inviteConvertedAccount(ctxCv, s1!.app.id);
  check("invitation parent préparée (jeton)", inv1.ok && typeof inv1.token === "string" && inv1.token.length > 10);
  const g1 = await prisma.guardian.findUnique({ where: { id: r1!.guardianId! }, select: { userId: true } });
  check("responsable lié à un compte désactivé", !!g1?.userId);
  const u1 = await prisma.user.findUnique({ where: { id: g1!.userId! }, select: { status: true } });
  check("compte parent DISABLED en attente d'activation", u1?.status === "DISABLED");
  const inv2 = await inviteConvertedAccount(ctxCv, s1!.app.id);
  check("seconde invitation → ALREADY_LINKED", !inv2.ok && inv2.error === "ALREADY_LINKED");
  const invDenied = await inviteConvertedAccount(ctxRead, s1!.app.id);
  check("invitation sans convert → FORBIDDEN", !invDenied.ok);
  const auditInvite = await prisma.auditLog.findFirst({
    where: { schoolId: school.id, action: "portal.invite_parent" },
  });
  check("invitation auditée sans jeton",
    !!auditInvite && !JSON.stringify(auditInvite.metadata).includes(inv1.ok ? inv1.token : "zzz"));

  // ---------- Suivi public ----------
  const view = await getTrackingView({ fileNumber: s1!.fileNumber, secret: s1!.secret });
  check("suivi public : statut converti + message inscription",
    !!view && view.applications.some((a) => a.status === "CONVERTED")
    && JSON.stringify(view).includes("inscription définitive"));

  // ---------- Nettoyage ----------
  if (process.env.G2D_CLEANUP === "1") {
    await cleanup(school.id);
    await cleanup(other.id);
    const users = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
    await prisma.accountInvite.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    console.log("  fixtures supprimées");
  } else {
    console.log(`  (fixtures conservées — école ${school.id}; G2D_CLEANUP=1 pour nettoyer)`);
  }

  console.log(`\n=== Recette G2-D : ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("RECETTE_ABORTED", e);
  process.exit(1);
});
