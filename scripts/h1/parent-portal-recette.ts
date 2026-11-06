/**
 * Recette H1 — portail parent interactif :
 * rattachement multi-enfants, parent sans enfant, isolation
 * inter-écoles, notes/résultats/bulletins non publiés invisibles,
 * justificatif d'absence, demandes administratives (dépôt, suivi,
 * annulation, traitement admin, notification du parent), profil et
 * coordonnées, audit complet sans secret.
 *
 * Usage : npx tsx scripts/h1/parent-portal-recette.ts
 */
import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";
import {
  listChildren,
  verifyChildAccess,
  getChildGrades,
  getChildReportCards,
  getChildResults,
} from "../../src/lib/services/portal/parent";
import {
  cancelParentRequest,
  createParentRequest,
  getParentProfile,
  getSchoolRequest,
  listParentRequests,
  listSchoolRequests,
  respondSchoolRequest,
  submitAbsenceJustification,
  updateParentContact,
} from "../../src/lib/services/parent-requests";
import {
  listNotifications,
  markAllRead,
  markNotificationRead,
  unreadCount,
} from "../../src/lib/services/notifications";

let pass = 0, fail = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};

const SLUG = "h1-fix";
const SLUG2 = "h1-fix-bis";
const EMAILS = [
  "h1-parent2@test.local",
  "h1-parent1@test.local",
  "h1-parent0@test.local",
  "h1-noguardian@test.local",
  "h1-admin@test.local",
  "h1-noperm@test.local",
  "h1-parentb@test.local",
];

async function makeUser(email: string) {
  return prisma.user.create({
    data: { email, passwordHash: "x", firstName: "H1", lastName: email, status: "ACTIVE" },
  });
}

async function makeMember(userId: string, schoolId: string, permKeys: string[]) {
  const role = await prisma.role.create({
    data: { name: `H1_${userId.slice(-4)}_${schoolId.slice(-4)}`, scope: "SCHOOL", schoolId },
  });
  const perms = await prisma.permission.findMany({
    where: { key: { in: permKeys } }, select: { id: true },
  });
  await prisma.rolePermission.createMany({
    data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
    skipDuplicates: true,
  });
  await prisma.schoolMembership.create({
    data: { userId, schoolId, roleId: role.id, status: "ACTIVE" },
  });
}

async function cleanupSchool(schoolId: string) {
  await prisma.notification.deleteMany({ where: { schoolId } });
  await prisma.administrativeRequest.deleteMany({ where: { schoolId } });
  await prisma.attendanceRecord.deleteMany({ where: { schoolId } });
  await prisma.reportCard.deleteMany({ where: { schoolId } });
  await prisma.studentPeriodResult.deleteMany({ where: { schoolId } });
  await prisma.grade.deleteMany({ where: { schoolId } });
  await prisma.assessment.deleteMany({ where: { schoolId } });
  await prisma.assessmentType.deleteMany({ where: { schoolId } });
  await prisma.subjectPeriodResult.deleteMany({ where: { schoolId } });
  await prisma.academicPeriod.deleteMany({ where: { schoolId } });
  await prisma.enrollment.deleteMany({ where: { schoolId } });
  await prisma.studentGuardian.deleteMany({ where: { schoolId } });
  await prisma.guardian.deleteMany({ where: { schoolId } });
  await prisma.student.deleteMany({ where: { schoolId } });
  await prisma.classroom.deleteMany({ where: { schoolId } });
  await prisma.subject.deleteMany({ where: { schoolId } });
  await prisma.level.deleteMany({ where: { schoolId } });
  await prisma.academicYear.deleteMany({ where: { schoolId } });
  await prisma.auditLog.deleteMany({ where: { schoolId } });
  await prisma.schoolMembership.deleteMany({ where: { schoolId } });
  const roles = await prisma.role.findMany({ where: { schoolId }, select: { id: true } });
  if (roles.length) {
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: roles.map((r) => r.id) } } });
    await prisma.role.deleteMany({ where: { id: { in: roles.map((r) => r.id) } } });
  }
  await prisma.school.deleteMany({ where: { id: schoolId } });
}

async function makeSchool(name: string, slug: string, code: string) {
  const school = await prisma.school.create({ data: { name, code, slug } });
  const year = await prisma.academicYear.create({
    data: {
      schoolId: school.id, name: "2026-2027",
      startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30"),
      status: "ACTIVE", isCurrent: true,
    },
  });
  const period = await prisma.academicPeriod.create({
    data: {
      schoolId: school.id, academicYearId: year.id, name: "T1", number: 1,
      startDate: new Date("2026-09-01"), endDate: new Date("2026-12-31"),
      type: "TRIMESTER",
    },
  });
  const level = await prisma.level.create({ data: { schoolId: school.id, name: "6e", order: 1 } });
  const classroom = await prisma.classroom.create({
    data: { schoolId: school.id, academicYearId: year.id, levelId: level.id, name: "6e A" },
  });
  const subject = await prisma.subject.create({
    data: { schoolId: school.id, name: "Maths", code: `MAT-${code}` },
  });
  const assessType = await prisma.assessmentType.create({
    data: { schoolId: school.id, code: `DEV-${code}`, name: "Devoir" },
  });
  const mkStudent = async (mat: string, first: string) => {
    const student = await prisma.student.create({
      data: { schoolId: school.id, matricule: mat, firstName: first, lastName: code, sex: "FEMALE" },
    });
    await prisma.enrollment.create({
      data: {
        schoolId: school.id, studentId: student.id,
        classroomId: classroom.id, academicYearId: year.id, status: "ENROLLED",
      },
    });
    return student;
  };
  return { school, year, period, level, classroom, subject, assessType, mkStudent };
}

(async () => {
  for (const slug of [SLUG, SLUG2]) {
    const old = await prisma.school.findFirst({ where: { slug }, select: { id: true } });
    if (old) await cleanupSchool(old.id);
  }
  const stale = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
  if (stale.length) {
    const ids = stale.map((u) => u.id);
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: ids } } });
    await prisma.guardian.updateMany({ where: { userId: { in: ids } }, data: { userId: null } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }

  const A = await makeSchool("H1 Ecole A", SLUG, "H1A");
  const B = await makeSchool("H1 Ecole B", SLUG2, "H1B");

  const s1 = await A.mkStudent("H1A-001", "Awa");
  const s2 = await A.mkStudent("H1A-002", "Karim");
  const s3 = await A.mkStudent("H1A-003", "Léa");   // enfant du parent solo
  const s4 = await A.mkStudent("H1A-004", "Noa");   // non rattaché
  const sb = await B.mkStudent("H1B-001", "Zoe");   // école B

  // Guardians + comptes
  const u2 = await makeUser("h1-parent2@test.local");
  const u1 = await makeUser("h1-parent1@test.local");
  const u0 = await makeUser("h1-parent0@test.local");
  const uNoG = await makeUser("h1-noguardian@test.local");
  const uAdmin = await makeUser("h1-admin@test.local");
  const uNoPerm = await makeUser("h1-noperm@test.local");
  const uB = await makeUser("h1-parentb@test.local");

  const mkGuardian = async (userId: string, schoolId: string, ln: string) =>
    prisma.guardian.create({
      data: { schoolId, userId, firstName: "P", lastName: ln, phone: "+22670000000" },
    });
  const g2 = await mkGuardian(u2.id, A.school.id, "ParentDeux");
  const g1 = await mkGuardian(u1.id, A.school.id, "ParentUn");
  await mkGuardian(u0.id, A.school.id, "ParentZero"); // aucun enfant lié
  const gB = await mkGuardian(uB.id, B.school.id, "ParentB");

  const link = (guardianId: string, studentId: string, schoolId: string) =>
    prisma.studentGuardian.create({
      data: { schoolId, guardianId, studentId, relation: "MOTHER" },
    });
  await link(g2.id, s1.id, A.school.id);
  await link(g2.id, s2.id, A.school.id);
  await link(g1.id, s3.id, A.school.id);
  await link(gB.id, sb.id, B.school.id);

  await makeMember(uAdmin.id, A.school.id, ["administrative-requests.manage"]);
  await makeMember(uNoPerm.id, A.school.id, ["student.read"]);

  const ctx2 = { userId: u2.id, schoolId: A.school.id };
  const ctx1 = { userId: u1.id, schoolId: A.school.id };
  const ctx0 = { userId: u0.id, schoolId: A.school.id };
  const ctxNoG = { userId: uNoG.id, schoolId: A.school.id };
  const ctxAdmin = { userId: uAdmin.id, schoolId: A.school.id };
  const ctxNoPerm = { userId: uNoPerm.id, schoolId: A.school.id };
  const ctxB = { userId: uB.id, schoolId: B.school.id };
  const ctxBCross = { userId: uAdmin.id, schoolId: B.school.id }; // même user, autre école (sans membership B)

  // ---------- Rattachement ----------
  console.log("\n== Rattachement parent↔enfant ==");
  check("parent 2 enfants → 2", (await listChildren(ctx2)).length === 2);
  check("parent 1 enfant → 1", (await listChildren(ctx1)).length === 1);
  check("parent sans enfant → 0", (await listChildren(ctx0)).length === 0);
  check("parent B → son enfant seul", (await listChildren(ctxB)).length === 1);
  check("accès g2↔s1 autorisé", !!(await verifyChildAccess(ctx2, s1.id)));
  check("accès g2↔s3 refusé", !(await verifyChildAccess(ctx2, s3.id)));
  check("accès inter-écoles refusé", !(await verifyChildAccess(ctxB, s1.id)));

  // ---------- Visibilité publié / non publié ----------
  console.log("\n== Publication ==");
  const assessPub = await prisma.assessment.create({
    data: {
      schoolId: A.school.id, academicYearId: A.year.id, academicPeriodId: A.period.id,
      classroomId: A.classroom.id, subjectId: A.subject.id, typeId: A.assessType.id,
      title: "Devoir 1", date: new Date("2026-10-10"), maxScore: 20, status: "PUBLISHED",
    },
  });
  const assessDraft = await prisma.assessment.create({
    data: {
      schoolId: A.school.id, academicYearId: A.year.id, academicPeriodId: A.period.id,
      classroomId: A.classroom.id, subjectId: A.subject.id, typeId: A.assessType.id,
      title: "Devoir 2 (non publié)", date: new Date("2026-10-20"), maxScore: 20, status: "DRAFT",
    },
  });
  await prisma.grade.createMany({
    data: [
      { schoolId: A.school.id, assessmentId: assessPub.id, studentId: s1.id, value: 15, status: "ENTERED" },
      { schoolId: A.school.id, assessmentId: assessDraft.id, studentId: s1.id, value: 18, status: "ENTERED" },
    ],
  });
  const grades = await getChildGrades(ctx2, s1.id);
  check("note publiée visible", !!grades?.some((g) => g.assessmentId === assessPub.id));
  check("note non publiée invisible", !grades?.some((g) => g.assessmentId === assessDraft.id));

  await prisma.studentPeriodResult.create({
    data: {
      schoolId: A.school.id, academicPeriodId: A.period.id,
      classroomId: A.classroom.id, studentId: s1.id,
      generalAverage: 14.5, status: "PUBLISHED",
    },
  });
  const period2 = await prisma.academicPeriod.create({
    data: {
      schoolId: A.school.id, academicYearId: A.year.id, name: "T2", number: 2,
      startDate: new Date("2027-01-01"), endDate: new Date("2027-03-31"), type: "TRIMESTER",
    },
  });
  await prisma.studentPeriodResult.create({
    data: {
      schoolId: A.school.id, academicPeriodId: period2.id,
      classroomId: A.classroom.id, studentId: s1.id,
      generalAverage: 15.5, status: "DRAFT",
    },
  });
  const results = await getChildResults(ctx2, s1.id);
  check("résultat publié visible", !!results?.results.some((r) => r.academicPeriodId === A.period.id));
  check("résultat brouillon invisible", !results?.results.some((r) => r.academicPeriodId === period2.id));

  await prisma.reportCard.create({
    data: {
      schoolId: A.school.id, identifier: "BUL-H1A-001", academicPeriodId: A.period.id,
      classroomId: A.classroom.id, studentId: s1.id, status: "PUBLISHED", publishedAt: new Date(),
    },
  });
  await prisma.reportCard.create({
    data: {
      schoolId: A.school.id, identifier: "BUL-H1A-002", academicPeriodId: period2.id,
      classroomId: A.classroom.id, studentId: s1.id, status: "DRAFT",
    },
  });
  const cards = await getChildReportCards(ctx2, s1.id);
  check("bulletin publié visible", !!cards?.some((c) => c.identifier === "BUL-H1A-001"));
  check("bulletin brouillon invisible", !cards?.some((c) => c.identifier === "BUL-H1A-002"));

  // ---------- Demandes administratives ----------
  console.log("\n== Demandes administratives ==");
  const r1 = await createParentRequest(ctx2, {
    type: "DOCUMENT", subject: "Attestation pour la mairie",
    body: "Merci d'établir une attestation d'inscription.", studentId: s1.id,
  });
  check("demande liée à un enfant → créée", r1.ok);
  const r2 = await createParentRequest(ctx2, {
    type: "ACCOUNT_INFO", subject: "Question de compte", body: "Quel est mon solde ?",
  });
  check("demande sans enfant → créée", r2.ok);
  const rForeign = await createParentRequest(ctx2, {
    type: "DOCUMENT", subject: "x", body: "y", studentId: s3.id,
  });
  check("demande sur enfant non rattaché → NOT_FOUND", !rForeign.ok && rForeign.error === "NOT_FOUND");
  const rCross = await createParentRequest(ctx2, {
    type: "DOCUMENT", subject: "x", body: "y", studentId: sb.id,
  });
  check("demande sur enfant autre école → NOT_FOUND", !rCross.ok && rCross.error === "NOT_FOUND");
  const rBad = await createParentRequest(ctx2, { type: "DOCUMENT", subject: "  ", body: "y" });
  check("sujet vide → INVALID_INPUT", !rBad.ok && rBad.error === "INVALID_INPUT");
  const rNoGuardian = await createParentRequest(ctxNoG, {
    type: "OTHER", subject: "x", body: "y",
  });
  check("compte sans dossier parent → FORBIDDEN", !rNoGuardian.ok && rNoGuardian.error === "FORBIDDEN");
  const r0 = await createParentRequest(ctx0, {
    type: "ACCOUNT_INFO", subject: "Rattacher mon enfant", body: "Mon enfant n'apparaît pas.",
  });
  check("parent sans enfant → demande autorisée", r0.ok);

  const mine = await listParentRequests(ctx2);
  check("parent voit ses demandes seulement",
    mine.length === 2 && mine.every((r) => r.guardianId === g2.id));

  // ---------- Justificatif d'absence ----------
  console.log("\n== Justificatifs ==");
  const absence = await prisma.attendanceRecord.create({
    data: {
      schoolId: A.school.id, studentId: s1.id, date: new Date("2026-11-02"),
      status: "ABSENT",
    },
  });
  const lateJustified = await prisma.attendanceRecord.create({
    data: {
      schoolId: A.school.id, studentId: s2.id, date: new Date("2026-11-03"),
      status: "LATE", justifiedAt: new Date(), reason: "Médecin",
    },
  });
  const absB = await prisma.attendanceRecord.create({
    data: {
      schoolId: B.school.id, studentId: sb.id, date: new Date("2026-11-02"),
      status: "ABSENT",
    },
  });
  const just = await submitAbsenceJustification(ctx2, {
    attendanceRecordId: absence.id, body: "Certificat médical joint au dossier papier.",
  });
  check("justificatif transmis → demande créée", just.ok);
  if (just.ok) {
    const j = await prisma.administrativeRequest.findUnique({ where: { id: just.result.id } });
    check("type ABSENCE_JUSTIFICATION", j?.type === "ABSENCE_JUSTIFICATION");
    check("contextRef = relevé", j?.contextRef === absence.id);
    check("élève rattaché à la demande", j?.studentId === s1.id);
  }
  const justCross = await submitAbsenceJustification(ctx2, {
    attendanceRecordId: absB.id, body: "tentative",
  });
  check("justificatif autre école → NOT_FOUND", !justCross.ok && justCross.error === "NOT_FOUND");
  const justDone = await submitAbsenceJustification(ctx2, {
    attendanceRecordId: lateJustified.id, body: "déjà justifié",
  });
  check("relevé déjà justifié → NOT_FOUND", !justDone.ok && justDone.error === "NOT_FOUND");
  const absS4 = await prisma.attendanceRecord.create({
    data: {
      schoolId: A.school.id, studentId: s4.id, date: new Date("2026-11-04"),
      status: "ABSENT",
    },
  });
  const justUnlinked = await submitAbsenceJustification(ctx2, {
    attendanceRecordId: absS4.id, body: "pas mon enfant",
  });
  check("justificatif enfant non rattaché → NOT_FOUND",
    !justUnlinked.ok && justUnlinked.error === "NOT_FOUND");

  // Anti-doublon : un seul justificatif ouvert par relevé.
  const justDup = await submitAbsenceJustification(ctx2, {
    attendanceRecordId: absence.id, body: "deuxième envoi",
  });
  check("justificatif en double → ALREADY_EXISTS",
    !justDup.ok && justDup.error === "ALREADY_EXISTS");
  // Course concurrente sur un autre relevé : l'index unique n'en garde qu'un.
  const absence2 = await prisma.attendanceRecord.create({
    data: {
      schoolId: A.school.id, studentId: s1.id, date: new Date("2026-11-05"),
      status: "ABSENT",
    },
  });
  const [race1, race2] = await Promise.all([
    submitAbsenceJustification(ctx2, { attendanceRecordId: absence2.id, body: "course 1" }),
    submitAbsenceJustification(ctx2, { attendanceRecordId: absence2.id, body: "course 2" }),
  ]);
  const raceOk = [race1, race2].filter((r) => r.ok).length;
  check("course concurrente → un seul justificatif créé", raceOk === 1);
  check("perdant de la course → ALREADY_EXISTS",
    [race1, race2].some((r) => !r.ok && r.error === "ALREADY_EXISTS"));
  // Le parent retire son justificatif → nouvelle soumission autorisée.
  const cancelJust = just.ok ? await cancelParentRequest(ctx2, just.result.id) : null;
  check("retrait du justificatif → OK", !!cancelJust?.ok);
  const justAgain = await submitAbsenceJustification(ctx2, {
    attendanceRecordId: absence.id, body: "Justificatif définitif.",
  });
  check("ressoumission après retrait → OK", justAgain.ok);

  // ---------- Annulation ----------
  console.log("\n== Annulation parent ==");
  const cancelOk = r2.ok ? await cancelParentRequest(ctx2, r2.result.id) : null;
  check("annulation SUBMITTED → OK", !!cancelOk?.ok);
  const cancelAgain = r2.ok ? await cancelParentRequest(ctx2, r2.result.id) : null;
  check("double annulation → NOT_OPEN", !cancelAgain?.ok && cancelAgain?.error === "NOT_OPEN");
  const cancelOther = r1.ok ? await cancelParentRequest(ctx1, r1.result.id) : null;
  check("annulation par un autre parent → NOT_OPEN",
    !cancelOther?.ok && cancelOther?.error === "NOT_OPEN");

  // ---------- Traitement établissement ----------
  console.log("\n== Traitement établissement ==");
  const respNoPerm = r1.ok
    ? await respondSchoolRequest(ctxNoPerm, { id: r1.result.id, status: "RESOLVED" }) : null;
  check("traitement sans permission → FORBIDDEN",
    !respNoPerm?.ok && respNoPerm?.error === "FORBIDDEN");
  const queue = await listSchoolRequests(ctxAdmin);
  // r1 + r2 (annulée) + r0 + justificatif (annulé) + justificatif course
  // + justificatif ressoumis = 6
  check("admin voit les demandes de son école",
    queue.length === 6 && queue.every((r) => r.schoolId === A.school.id));
  const queueOpen = await listSchoolRequests(ctxAdmin, { status: "SUBMITTED" });
  // r1 + r0 + justificatif course + justificatif ressoumis = 4 déposées
  check("filtre statut SUBMITTED → seules les déposées",
    queueOpen.length === 4 && queueOpen.every((r) => r.status === "SUBMITTED"));
  const crossDetail = r1.ok ? await getSchoolRequest(ctxBCross, r1.result.id) : null;
  check("détail inter-écoles → null", crossDetail === null);
  const rejNoReason = r1.ok
    ? await respondSchoolRequest(ctxAdmin, { id: r1.result.id, status: "REJECTED" }) : null;
  check("refus sans motif → INVALID_INPUT",
    !rejNoReason?.ok && rejNoReason?.error === "INVALID_INPUT");
  const wip = r1.ok
    ? await respondSchoolRequest(ctxAdmin, { id: r1.result.id, status: "IN_PROGRESS", response: "Prise en compte." }) : null;
  check("passage en traitement → OK", !!wip?.ok);
  const done = r1.ok
    ? await respondSchoolRequest(ctxAdmin, { id: r1.result.id, status: "RESOLVED", response: "Document disponible au secrétariat." }) : null;
  check("clôture traitée → OK", !!done?.ok);
  const respondClosed = r1.ok
    ? await respondSchoolRequest(ctxAdmin, { id: r1.result.id, status: "REJECTED", response: "x" }) : null;
  check("réponse sur demande close → NOT_OPEN",
    !respondClosed?.ok && respondClosed?.error === "NOT_OPEN");

  const rejReq = await createParentRequest(ctx2, {
    type: "MEETING", subject: "RDV", body: "Je souhaite un rendez-vous.",
  });
  const rej = rejReq.ok
    ? await respondSchoolRequest(ctxAdmin, { id: rejReq.result.id, status: "REJECTED", response: "Agenda complet — reprogrammer." }) : null;
  check("refus motivé → OK", !!rej?.ok);
  const cancelAfter = rejReq.ok ? await cancelParentRequest(ctx2, rejReq.result.id) : null;
  check("annulation après traitement → NOT_OPEN",
    !cancelAfter?.ok && cancelAfter?.error === "NOT_OPEN");

  // ---------- Notifications ----------
  console.log("\n== Notifications ==");
  const notifs = await listNotifications(u2.id, { take: 50 });
  const reqNotifs = notifs.filter((n) => n.type === "ADMIN_MESSAGE");
  check("parent notifié à chaque réponse (3 traitements)",
    reqNotifs.length === 3);
  check("notification pointe vers le suivi",
    reqNotifs.every((n) => n.link === "/parent?tab=demandes"));
  const unread = await unreadCount(u2.id);
  check("compteur non lues > 0", unread >= 3);
  if (reqNotifs[0]) {
    await markNotificationRead(u2.id, reqNotifs[0].id);
    check("marquer lue → -1", (await unreadCount(u2.id)) === unread - 1);
  }
  await markAllRead(u2.id);
  check("tout marquer lu → 0", (await unreadCount(u2.id)) === 0);

  // ---------- Profil ----------
  console.log("\n== Profil ==");
  const prof = await getParentProfile(ctx2);
  check("profil : dossier parent + compte", !!prof.guardian && !!prof.user);
  const upd = await updateParentContact(ctx2, {
    phone: "+22671112222", email: "p2@famille.test", address: "Secteur 9",
  });
  check("coordonnées mises à jour", upd.ok);
  const profAfter = await getParentProfile(ctx2);
  check("téléphone enregistré", profAfter.guardian?.phone === "+22671112222");
  const updBad = await updateParentContact(ctx2, { email: "pas-un-email" });
  check("email invalide → INVALID_INPUT", !updBad.ok && updBad.error === "INVALID_INPUT");
  const updNoG = await updateParentContact(ctxNoG, { phone: "+22670000000" });
  check("sans dossier parent → FORBIDDEN", !updNoG.ok && updNoG.error === "FORBIDDEN");

  // ---------- Audit ----------
  console.log("\n== Audit ==");
  const audits = await prisma.auditLog.findMany({
    where: { schoolId: A.school.id },
    select: { action: true, metadata: true },
  });
  const actions = new Set(audits.map((a) => a.action));
  check("audit dépôt", actions.has("parent_request.create"));
  check("audit justificatif", actions.has("parent_request.absence_justification"));
  check("audit annulation", actions.has("parent_request.cancel"));
  check("audit traitement", actions.has("parent_request.respond"));
  check("audit coordonnées", actions.has("parent.contact_update"));
  check("aucun secret dans l'audit",
    !JSON.stringify(audits).match(/pin|otp|password|secret/i));

  // ---------- Nettoyage ----------
  if (process.env.H1_KEEP !== "1") {
    await cleanupSchool(A.school.id);
    await cleanupSchool(B.school.id);
    const ids = (await prisma.user.findMany({
      where: { email: { in: EMAILS } }, select: { id: true },
    })).map((u) => u.id);
    if (ids.length) {
      await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
      await prisma.schoolMembership.deleteMany({ where: { userId: { in: ids } } });
      await prisma.guardian.updateMany({ where: { userId: { in: ids } }, data: { userId: null } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    console.log("\n  fixtures nettoyées");
  }

  console.log(`\n==== H1 PORTAIL PARENT : ${pass} PASS / ${fail} FAIL ====`);
  if (fail) process.exit(1);
})()
  .catch((e) => { console.error("H1_RECETTE_FAILED", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
