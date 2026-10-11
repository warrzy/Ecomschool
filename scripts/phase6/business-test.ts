import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { createYear } from "@/lib/services/academic";
import { createLevel, createClassroom } from "@/lib/services/classes";
import { createTeacher } from "@/lib/services/teachers";
import { createSubject, setClassroomSubject } from "@/lib/services/subjects";
import { createStudent } from "@/lib/services/students";
import { enrollStudent } from "@/lib/services/enrollments";
import { upsertPolicy } from "@/lib/services/grading/policy";
import {
  ensureDefaultAssessmentTypes,
  createAssessment,
} from "@/lib/services/grading/assessments";
import { saveGrades } from "@/lib/services/grading/grades";
import {
  computeAndStore,
  setValidationStatus,
} from "@/lib/services/grading/results";
import {
  generateClassReportCards,
  ensureDefaultTemplates,
  updateResultAnnotations,
  updateSubjectAppreciation,
  getReportCard,
} from "@/lib/services/grading/reportcards";
import {
  inviteStudentAccount,
  inviteGuardianAccount,
  acceptInvite,
  resendInvite,
  setPortalAccountStatus,
} from "@/lib/services/portal/accounts";
import {
  verifyChildAccess,
  listChildren,
  getChildGrades,
  getChildResults,
  getChildReportCards,
} from "@/lib/services/portal/parent";
import {
  resolveStudent,
  getStudentReportCards,
} from "@/lib/services/portal/student";
import {
  createAnnouncement,
  publishAnnouncement,
  listPublishedAnnouncements,
} from "@/lib/services/announcements";
import { renderReportCard } from "@/lib/pdf/report-card";
import type { ReportCardPayload } from "@/lib/pdf/report-card";
import PDFDocument from "pdfkit";

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];
const record = (name: string, ok: boolean, detail?: string) =>
  checks.push({ name, ok, detail });

async function ensureSchool(code: string, name: string) {
  return prisma.school.upsert({
    where: { code },
    update: { status: "ACTIVE" },
    create: { name, code, slug: code.toLowerCase(), status: "ACTIVE" },
    select: { id: true },
  });
}

async function ensureUser(schoolId: string, email: string, roleName: string) {
  const passwordHash = await hashPassword(process.env.SEED_TEST_PASSWORD!);
  const role = await prisma.role.findFirstOrThrow({
    where: { name: roleName, scope: "SCHOOL", schoolId: null },
    select: { id: true },
  });
  const user = await prisma.user.upsert({
    where: { email },
    update: { schoolId, status: "ACTIVE" },
    create: {
      email,
      passwordHash,
      schoolId,
      status: "ACTIVE",
      firstName: "Test",
      lastName: email.split("@")[0],
    },
    select: { id: true },
  });
  await prisma.schoolMembership.upsert({
    where: { schoolId_userId: { schoolId, userId: user.id } },
    update: { roleId: role.id, status: "ACTIVE" },
    create: { schoolId, userId: user.id, roleId: role.id, status: "ACTIVE" },
  });
  return user.id;
}

async function renderPdf(payload: ReportCardPayload, templateKey: string) {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks))),
  );
  renderReportCard(doc, payload, {
    identifier: "TEST-001",
    version: 1,
    status: "PUBLISHED",
    publishedAt: new Date(),
  }, { templateKey });
  doc.end();
  return done;
}

const S = Date.now() % 100000;

async function main() {
  const schoolA = await ensureSchool("TEST-P6-A", "Ecole Test Phase6 A");
  const schoolB = await ensureSchool("TEST-P6-B", "Ecole Test Phase6 B");
  const adminA = await ensureUser(schoolA.id, "phase6-admin-a@ecom-test.local", "ADMIN_SCHOOL");
  await ensureUser(schoolB.id, "phase6-admin-b@ecom-test.local", "ADMIN_SCHOOL");
  const ctxA = { userId: adminA, schoolId: schoolA.id };

  // ---- Référentiels ----
  const year = await createYear(ctxA, {
    name: `P6-${S}`,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    periodType: "TRIMESTER",
    isCurrent: true,
  });
  if (!year.ok) throw new Error("createYear failed");
  const periods = await prisma.academicPeriod.findMany({
    where: { schoolId: schoolA.id, academicYearId: year.result.id },
    orderBy: { number: "asc" },
  });
  const period = periods.find((p) => p.number === 1)!;
  record("période T1 bornée (audit Étape 0)", period.endDate < new Date("2026-12-31"));

  const level = await createLevel(ctxA, { name: `6e-P6-${S}`, order: 1 });
  if (!level.ok) throw new Error("createLevel failed");
  const classroom = await createClassroom(ctxA, {
    name: `6eA-P6-${S}`,
    levelId: level.result.id,
    academicYearId: year.result.id,
  });
  if (!classroom.ok) throw new Error("createClassroom failed");
  const classroomId = classroom.result.id;

  const maths = await createSubject(ctxA, { name: `Maths-P6-${S}`, code: "MTH" });
  const teacher = await createTeacher(ctxA, { firstName: "Kadi", lastName: `P6-${S}` });
  if (!maths.ok || !teacher.ok) throw new Error("subject/teacher failed");
  await setClassroomSubject(ctxA, {
    classroomId,
    subjectId: maths.result.id,
    coefficient: 3,
    teacherId: teacher.result.id,
  });

  // Modèle collège affecté au niveau
  await ensureDefaultTemplates(ctxA);
  await prisma.reportCardTemplate.updateMany({
    where: { schoolId: schoolA.id, key: "college" },
    data: { levelId: level.result.id },
  });

  // ---- Élève + tuteur ----
  const st = await createStudent(ctxA, {
    matricule: `P6-${S}-1`,
    firstName: "Aminata",
    lastName: "Eleve",
    sex: "FEMALE",
  });
  if (!st.ok) throw new Error("createStudent failed");
  const studentId = st.result.id;
  const en1 = await enrollStudent(ctxA, {
    studentId,
    classroomId,
    academicYearId: year.result.id,
  });
  if (en1.ok) {
    await prisma.enrollment.update({
      where: { id: en1.result.id },
      data: { enrolledAt: new Date("2026-01-05T00:00:00.000Z") },
    });
  }

  const guardian = await prisma.guardian.create({
    data: {
      schoolId: schoolA.id,
      firstName: "Moussa",
      lastName: "Parent",
      email: `p6-parent-${S}@ecom-test.local`,
      students: {
        create: { schoolId: schoolA.id, studentId, relation: "FATHER" },
      },
    },
    select: { id: true },
  });

  const st2 = await createStudent(ctxA, {
    matricule: `P6-${S}-2`,
    firstName: "Ibrahim",
    lastName: "Eleve",
    sex: "MALE",
  });
  if (!st2.ok) throw new Error("createStudent2 failed");
  // Deuxième enfant rattaché au même parent
  await prisma.studentGuardian.create({
    data: {
      schoolId: schoolA.id,
      studentId: st2.result.id,
      guardianId: guardian.id,
      relation: "FATHER",
    },
  });
  const en2 = await enrollStudent(ctxA, {
    studentId: st2.result.id,
    classroomId,
    academicYearId: year.result.id,
  });
  if (en2.ok) {
    await prisma.enrollment.update({
      where: { id: en2.result.id },
      data: { enrolledAt: new Date("2026-01-05T00:00:00.000Z") },
    });
  }

  // ---- Politique + évaluation + notes ----
  await upsertPolicy(ctxA, {
    academicYearId: year.result.id,
    maxScore: 20,
    passMark: 10,
    missingGradePolicy: "EXCLUDE",
    absentPolicy: "EXCLUDE",
    tieRule: "SHARED_RANK",
  });
  const types = await ensureDefaultAssessmentTypes(ctxA);
  const devoir = types.find((t) => t.code === "DEVOIR")!;

  const assess = await createAssessment(ctxA, {
    academicYearId: year.result.id,
    academicPeriodId: period.id,
    classroomId,
    subjectId: maths.result.id,
    teacherId: teacher.result.id,
    typeId: devoir.id,
    title: "Devoir P6",
    date: new Date("2026-02-10T00:00:00.000Z"),
    maxScore: 20,
    coefficient: 1,
  });
  if (!assess.ok) throw new Error("createAssessment failed");

  await saveGrades(ctxA, assess.result.id, [
    { studentId, value: 15, status: "ENTERED" },
    { studentId: st2.result.id, value: 12, status: "ENTERED" },
  ]);

  // ---- Accès : invitations ----
  const invStudent = await inviteStudentAccount(ctxA, {
    studentId,
    email: `p6-student-${S}@ecom-test.local`,
  });
  record("invitation élève créée", invStudent.ok);
  if (!invStudent.ok) throw new Error("inviteStudent failed");
  const studentUser = await prisma.student.findUnique({
    where: { id: studentId },
    select: { user: { select: { id: true, status: true } } },
  });
  record("compte élève lié et désactivé", studentUser?.user?.status === "DISABLED");

  const invParent = await inviteGuardianAccount(ctxA, {
    guardianId: guardian.id,
    email: `p6-parent-${S}@ecom-test.local`,
  });
  record("invitation parent créée", invParent.ok);
  if (!invParent.ok) throw new Error("inviteGuardian failed");

  // Token invalide refusé
  const badToken = await acceptInvite("deadbeefdeadbeef", "password123");
  record("token invalide refusé", !badToken.ok && badToken.error === "INVALID_TOKEN");

  // Acceptation : mot de passe défini, compte activé
  const accept = await acceptInvite(invParent.result.token, "Motdepasse123!");
  record("invitation parent acceptée", accept.ok);
  const parentUser = await prisma.guardian.findUnique({
    where: { id: guardian.id },
    select: { user: { select: { id: true, status: true, passwordHash: true } } },
  });
  record(
    "parent activé, hash ≠ mot de passe clair",
    parentUser?.user?.status === "ACTIVE" &&
      !parentUser.user.passwordHash.includes("Motdepasse"),
  );
  const parentUserId = parentUser!.user!.id;
  const ctxP = { userId: parentUserId, schoolId: schoolA.id };

  // Le même token ne peut pas être réutilisé
  const reuse = await acceptInvite(invParent.result.token, "AutreMotdepasse1!");
  record("token consommé non réutilisable", !reuse.ok);

  // ---- Vérification parent↔enfant (serveur, pas le JWT) ----
  record("accès parent→enfant1 vérifié", !!(await verifyChildAccess(ctxP, studentId)));
  record("accès parent→enfant2 vérifié", !!(await verifyChildAccess(ctxP, st2.result.id)));
  const children = await listChildren(ctxP);
  record("2 enfants listés pour le parent", children.length === 2);

  // Parent B (école B) : accès refusé à l'élève de l'école A
  const parentB = await ensureUser(schoolB.id, `p6-parent-b-${S}@ecom-test.local`, "PARENT");
  const ctxPB = { userId: parentB, schoolId: schoolB.id };
  record(
    "parent école B → élève école A refusé",
    !(await verifyChildAccess(ctxPB, studentId)),
  );
  record(
    "parent école B : aucun enfant",
    (await listChildren(ctxPB)).length === 0,
  );

  // ---- Élève : résolution et restriction ----
  const acceptStudent = await acceptInvite(invStudent.result.token, "ElevePass123!");
  record("invitation élève acceptée", acceptStudent.ok);
  const studentUserId = (await prisma.student.findUnique({
    where: { id: studentId },
    select: { userId: true },
  }))!.userId!;
  const ctxS = { userId: studentUserId, schoolId: schoolA.id };
  record("élève résolu par son compte", (await resolveStudent(ctxS))?.id === studentId);
  record(
    "élève d'une autre école non résolu",
    (await resolveStudent({ userId: studentUserId, schoolId: schoolB.id })) === null,
  );

  // ---- Publication-seulement ----
  // Rien de publié : notes/résultats/bulletins invisibles
  record(
    "notes non publiées invisibles (parent)",
    (await getChildGrades(ctxP, studentId))?.length === 0,
  );
  record(
    "résultats non publiés invisibles (parent)",
    (await getChildResults(ctxP, studentId))?.results.length === 0,
  );
  record(
    "bulletins non publiés invisibles (élève)",
    (await getStudentReportCards(ctxS))?.length === 0,
  );

  // Évaluation publiée → note visible
  await prisma.assessment.update({
    where: { id: assess.result.id },
    data: { status: "PUBLISHED" },
  });
  record(
    "note visible après publication de l'évaluation",
    (await getChildGrades(ctxP, studentId))?.length === 1,
  );

  // ---- Calcul → validation → publication ----
  await computeAndStore(ctxA, {
    classroomId,
    academicPeriodId: period.id,
  });
  await generateClassReportCards(ctxA, {
    classroomId,
    academicPeriodId: period.id,
  });
  await setValidationStatus(ctxA, {
    classroomId,
    academicPeriodId: period.id,
    status: "VALIDATED",
  });
  await setValidationStatus(ctxA, {
    classroomId,
    academicPeriodId: period.id,
    status: "PUBLISHED",
  });

  const publishedResults = await getChildResults(ctxP, studentId);
  record(
    "résultats visibles après publication",
    publishedResults?.results.length === 1 &&
      publishedResults.results[0].generalAverage === 15,
  );
  const publishedCards = await getChildReportCards(ctxP, studentId);
  record("bulletin publié visible (parent)", publishedCards?.length === 1);
  record(
    "bulletin publié visible (élève)",
    (await getStudentReportCards(ctxS))?.length === 1,
  );

  // Notification de publication créée pour parent + élève
  const notifParent = await prisma.notification.count({
    where: { userId: parentUserId, type: "REPORT_CARD_PUBLISHED" },
  });
  const notifStudent = await prisma.notification.count({
    where: { userId: studentUserId, type: "REPORT_CARD_PUBLISHED" },
  });
  record("notifications publication (parent+élève)", notifParent >= 1 && notifStudent >= 1);

  // ---- Appréciations & décisions (Étape 2) ----
  await updateSubjectAppreciation(ctxA, {
    studentId,
    academicPeriodId: period.id,
    subjectId: maths.result.id,
    appreciation: "Bon travail",
  });
  await updateResultAnnotations(ctxA, {
    studentId,
    academicPeriodId: period.id,
    generalAppreciation: "Trimestre satisfaisant",
    councilDecision: "Encouragements",
    directionNote: "Poursuivre",
    sign: true,
  });
  const annotated = await prisma.studentPeriodResult.findFirst({
    where: { schoolId: schoolA.id, studentId, academicPeriodId: period.id },
    select: { generalAppreciation: true, councilDecision: true, directionSignedAt: true },
  });
  record(
    "appréciations + décision + signature persistées",
    annotated?.generalAppreciation === "Trimestre satisfaisant" &&
      annotated.councilDecision === "Encouragements" &&
      annotated.directionSignedAt != null,
  );

  // Régénération post-publication → nouvelle version historisée
  const cardRow = await prisma.reportCard.findFirst({
    where: { schoolId: schoolA.id, studentId, academicPeriodId: period.id },
    select: { id: true, currentVersion: true },
  });
  const regen = await generateClassReportCards(ctxA, {
    classroomId,
    academicPeriodId: period.id,
  });
  const cardAfter = await getReportCard(ctxA, cardRow!.id);
  record(
    "rectification = nouvelle version (payload enrichi)",
    regen.ok &&
      cardAfter!.currentVersion === cardRow!.currentVersion + 1 &&
      (cardAfter!.versions[0].payload as ReportCardPayload).generalAppreciation ===
        "Trimestre satisfaisant",
  );
  record(
    "ancienne version conservée",
    cardAfter!.versions.length === cardRow!.currentVersion + 1,
  );

  // ---- Rendus PDF des trois modèles ----
  const payload = cardAfter!.versions[0].payload as unknown as ReportCardPayload;
  const [pdfPrimary, pdfCollege, pdfLycee] = await Promise.all([
    renderPdf(payload, "primary"),
    renderPdf(payload, "college"),
    renderPdf(payload, "lycee"),
  ]);
  record(
    "3 modèles PDF générés et distincts",
    pdfPrimary.length > 500 &&
      pdfCollege.length > 500 &&
      pdfLycee.length > 500 &&
      !pdfPrimary.equals(pdfCollege) &&
      !pdfCollege.equals(pdfLycee),
    `sizes: ${pdfPrimary.length}/${pdfCollege.length}/${pdfLycee.length}`,
  );

  // ---- Annonces ----
  const ann = await createAnnouncement(ctxA, {
    title: "Réunion parents",
    body: "Samedi 10h",
    audience: "PARENTS",
  });
  record("annonce créée", ann.ok);
  if (!ann.ok) throw new Error("announcement failed");
  record(
    "annonce non publiée invisible",
    (await listPublishedAnnouncements(schoolA.id, "PARENTS")).length === 0,
  );
  await publishAnnouncement(ctxA, ann.result.id);
  record(
    "annonce publiée visible pour PARENTS",
    (await listPublishedAnnouncements(schoolA.id, "PARENTS")).length === 1,
  );
  record(
    "annonce PARENTS invisible pour STUDENTS",
    (await listPublishedAnnouncements(schoolA.id, "STUDENTS")).length === 0,
  );
  const notifAnn = await prisma.notification.count({
    where: { userId: parentUserId, type: "ANNOUNCEMENT" },
  });
  record("notification annonce reçue par le parent", notifAnn >= 1);
  // L'élève (audience PARENTS) ne reçoit pas la notification
  const notifAnnStudent = await prisma.notification.count({
    where: { userId: studentUserId, type: "ANNOUNCEMENT" },
  });
  record("annonce PARENTS non notifiée à l'élève", notifAnnStudent === 0);

  // ---- Gestion des accès ----
  const disable = await setPortalAccountStatus(ctxA, {
    userId: parentUserId,
    status: "DISABLED",
  });
  record("désactivation compte parent", disable.ok);
  record(
    "accès révoqué après désactivation",
    !(await verifyChildAccess(ctxP, studentId)),
  );
  await setPortalAccountStatus(ctxA, { userId: parentUserId, status: "ACTIVE" });
  record(
    "accès restauré après réactivation",
    !!(await verifyChildAccess(ctxP, studentId)),
  );

  // Renvoi d'invitation (élève B non encore activé)
  const g2 = await prisma.guardian.create({
    data: {
      schoolId: schoolA.id,
      firstName: "Fatou",
      lastName: "Parent2",
      email: `p6-parent2-${S}@ecom-test.local`,
    },
    select: { id: true },
  });
  const inv2 = await inviteGuardianAccount(ctxA, { guardianId: g2.id });
  if (!inv2.ok) throw new Error("invite2 failed");
  const g2User = await prisma.guardian.findUnique({
    where: { id: g2.id },
    select: { userId: true },
  });
  const resend = await resendInvite(ctxA, g2User!.userId!);
  record("renvoi invitation = nouveau token", resend.ok && resend.result.token !== inv2.result.token);
  const oldTokenDead = await acceptInvite(inv2.result.token, "Password1234!");
  record("ancien token révoqué au renvoi", !oldTokenDead.ok);

  // ---- Synthèse ----
  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    console.log(`${c.ok ? "PASS" : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) process.exit(1);
}

main()
  .catch((e) => {
    for (const c of checks) {
      console.log(`${c.ok ? "PASS" : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    }
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
