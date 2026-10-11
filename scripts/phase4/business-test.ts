import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { createYear } from "@/lib/services/academic";
import { createLevel, createClassroom } from "@/lib/services/classes";
import { createTeacher } from "@/lib/services/teachers";
import { createSubject } from "@/lib/services/subjects";
import { createStudent } from "@/lib/services/students";
import { enrollStudent } from "@/lib/services/enrollments";
import { createRoom } from "@/lib/services/rooms";
import {
  createSchedule,
  createSession,
  ensureSessionFromSchedule,
  moveSession,
  setSessionStatus,
  replaceSessionTeacher,
  upsertSessionContent,
  getWeekTimetable,
  weekStart,
} from "@/lib/services/schedules";
import {
  getSessionRoster,
  saveSessionAttendance,
  addAttendanceRecord,
  justifyAttendance,
  listAttendance,
  studentAttendanceSummary,
  classroomStats,
  teacherIdForUser,
} from "@/lib/services/attendance";
import { getPedagogyDashboard } from "@/lib/services/dashboard";
import PDFDocument from "pdfkit";

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];
const record = (name: string, ok: boolean, detail?: string) => {
  checks.push({ name, ok, detail });
};

async function ensureSchool(code: string, name: string) {
  return prisma.school.upsert({
    where: { code },
    update: { status: "ACTIVE" },
    create: { name, code, slug: code.toLowerCase(), status: "ACTIVE" },
    select: { id: true },
  });
}

async function ensureAdmin(schoolId: string, email: string) {
  const passwordHash = await hashPassword(process.env.SEED_TEST_PASSWORD!);
  const role = await prisma.role.findFirstOrThrow({
    where: { name: "ADMIN_SCHOOL", scope: "SCHOOL", schoolId: null },
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
      firstName: "Admin",
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

function nextWeekday(offset: number): Date {
  const ws = weekStart(new Date());
  const d = new Date(ws);
  d.setDate(d.getDate() + offset);
  return d;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const schoolA = await ensureSchool("TEST-P4-A", "Ecole Test Phase4 A");
  const schoolB = await ensureSchool("TEST-P4-B", "Ecole Test Phase4 B");
  const adminA = await ensureAdmin(schoolA.id, "phase4-admin-a@ecom-test.local");
  const adminB = await ensureAdmin(schoolB.id, "phase4-admin-b@ecom-test.local");
  const ctxA = { userId: adminA, schoolId: schoolA.id };
  const ctxB = { userId: adminB, schoolId: schoolB.id };

  // ---- Référentiels A ----
  const yearA = await createYear(ctxA, {
    name: `P4-${Date.now() % 100000}`,
    startDate: "2026-01-01",
    endDate: "2027-12-31",
    periodType: "TRIMESTER",
    isCurrent: true,
  });
  record("année A créée", yearA.ok);
  if (!yearA.ok) throw new Error("createYear failed");
  const yearAId = yearA.result.id;

  const yearB = await createYear(ctxB, {
    name: `P4B-${Date.now() % 100000}`,
    startDate: "2026-01-01",
    endDate: "2027-12-31",
    periodType: "TRIMESTER",
    isCurrent: true,
  });
  record("année B créée", yearB.ok);
  if (!yearB.ok) throw new Error("createYear B failed");

  const level = await createLevel(ctxA, { name: `6e-P4-${Date.now() % 10000}`, order: 10 });
  record("niveau créé", level.ok);
  if (!level.ok) throw new Error("createLevel failed");

  const classA = await createClassroom(ctxA, {
    name: `6eA-P4-${Date.now() % 10000}`,
    levelId: level.result.id,
    academicYearId: yearAId,
    capacity: 30,
  });
  record("classe A créée", classA.ok);
  if (!classA.ok) throw new Error("createClassroom failed");
  const classAId = classA.result.id;

  const subject = await createSubject(ctxA, {
    name: `Maths-P4-${Date.now() % 10000}`,
    code: "MTH",
  });
  record("matière créée", subject.ok);
  if (!subject.ok) throw new Error("createSubject failed");
  const subjectId = subject.result.id;

  const teacher = await createTeacher(ctxA, {
    firstName: "Prof",
    lastName: `Test-P4-${Date.now() % 10000}`,
  });
  record("enseignant créé", teacher.ok);
  if (!teacher.ok) throw new Error("createTeacher failed");
  const teacherId = teacher.result.id;

  const teacher2 = await createTeacher(ctxA, {
    firstName: "Prof2",
    lastName: `Bis-P4-${Date.now() % 10000}`,
  });
  if (!teacher2.ok) throw new Error("createTeacher2 failed");
  const teacher2Id = teacher2.result.id;

  // ---- Salles ----
  const room = await createRoom(ctxA, {
    code: `S-${Date.now() % 10000}`,
    name: "Salle 101",
    capacity: 32,
    building: "A",
    floor: "1",
    type: "CLASSROOM",
  });
  record("salle créée", room.ok);
  if (!room.ok) throw new Error("createRoom failed");
  const roomId = room.result.id;

  const roomDup = await createRoom(ctxA, {
    code: (await prisma.room.findUniqueOrThrow({ where: { id: roomId } })).code,
    name: "Doublon",
  });
  record("code salle dupliqué refusé", !roomDup.ok && roomDup.error === "CODE_TAKEN");

  // ---- Élèves + inscriptions ----
  const st1 = await createStudent(ctxA, {
    matricule: `P4-${Date.now() % 100000}-1`,
    firstName: "Alice",
    lastName: "Eleve",
    sex: "FEMALE",
  });
  const st2 = await createStudent(ctxA, {
    matricule: `P4-${Date.now() % 100000}-2`,
    firstName: "Bob",
    lastName: "Eleve",
    sex: "MALE",
  });
  record("élèves créés", st1.ok && st2.ok);
  if (!st1.ok || !st2.ok) throw new Error("createStudent failed");

  const en1 = await enrollStudent(ctxA, {
    studentId: st1.result.id,
    classroomId: classAId,
    academicYearId: yearAId,
  });
  const en2 = await enrollStudent(ctxA, {
    studentId: st2.result.id,
    classroomId: classAId,
    academicYearId: yearAId,
  });
  const classB = await createClassroom(ctxA, {
    name: `6eB-P4-${Date.now() % 10000}`,
    levelId: level.result.id,
    academicYearId: yearAId,
  });
  if (!classB.ok) throw new Error("createClassroom B failed");
  const classBId = classB.result.id;

  record("élèves inscrits", en1.ok && en2.ok);
  // Recale enrolledAt au début d'année pour que les élèves soient "inscrits"
  // à la date de la séance de test (semaine courante du calendrier).
  if (en1.ok && en2.ok) {
    await prisma.enrollment.updateMany({
      where: { id: { in: [en1.result.id, en2.result.id] } },
      data: { enrolledAt: new Date("2026-01-01T00:00:00.000Z") },
    });
  }

  // ---- Créneau récurrent (SAMEDI inclus) ----
  const monday = nextWeekday(0);
  const saturday = nextWeekday(5);
  const sched = await createSchedule(ctxA, {
    academicYearId: yearAId,
    classroomId: classAId,
    teacherId,
    subjectId,
    roomId,
    weekday: "MONDAY",
    startMin: 8 * 60,
    endMin: 9 * 60,
    validFrom: iso(monday),
    validUntil: "2027-06-30",
  });
  record("créneau lundi créé", sched.ok, sched.ok ? "" : String(sched.error));
  if (!sched.ok) throw new Error("createSchedule failed");
  const schedId = sched.result.id;

  const schedSat = await createSchedule(ctxA, {
    academicYearId: yearAId,
    classroomId: classAId,
    teacherId,
    subjectId,
    weekday: "SATURDAY",
    startMin: 10 * 60,
    endMin: 11 * 60,
    validFrom: iso(saturday),
  });
  record("créneau SAMEDI créé", schedSat.ok);
  if (!schedSat.ok) throw new Error("createSchedule SAT failed");

  // ---- Conflits ----
  const conflictRoom = await createSchedule(ctxA, {
    academicYearId: yearAId,
    classroomId: classBId, // autre classe → isole le conflit salle
    teacherId: teacher2Id,
    subjectId,
    roomId,
    weekday: "MONDAY",
    startMin: 8 * 60 + 30,
    endMin: 9 * 60 + 30,
    validFrom: iso(monday),
  });
  record(
    "chevauchement salle refusé",
    !conflictRoom.ok && conflictRoom.error === "CONFLICT_ROOM",
    conflictRoom.ok ? "accepté" : conflictRoom.error,
  );

  const conflictTeacher = await createSchedule(ctxA, {
    academicYearId: yearAId,
    classroomId: classBId, // autre classe, sans salle → isole le conflit enseignant
    teacherId,
    weekday: "MONDAY",
    startMin: 8 * 60 + 30,
    endMin: 9 * 60 + 30,
    validFrom: iso(monday),
  });
  record(
    "chevauchement enseignant refusé",
    !conflictTeacher.ok && conflictTeacher.error === "CONFLICT_TEACHER",
    conflictTeacher.ok ? "accepté" : conflictTeacher.error,
  );

  const conflictClass = await createSchedule(ctxA, {
    academicYearId: yearAId,
    classroomId: classAId,
    teacherId: teacher2Id,
    weekday: "MONDAY",
    startMin: 8 * 60 + 15,
    endMin: 8 * 60 + 45,
    validFrom: iso(monday),
  });
  record(
    "chevauchement classe refusé",
    !conflictClass.ok && conflictClass.error === "CONFLICT_CLASSROOM",
  );

  const noConflict = await createSchedule(ctxA, {
    academicYearId: yearAId,
    classroomId: classAId,
    teacherId: teacher2Id,
    roomId,
    weekday: "MONDAY",
    startMin: 9 * 60,
    endMin: 10 * 60,
    validFrom: iso(monday),
  });
  record("créneau adjacent accepté (pas de chevauchement)", noConflict.ok);

  // ---- Concurrence ----
  const [c1, c2] = await Promise.all([
    createSchedule(ctxA, {
      academicYearId: yearAId,
      classroomId: classAId,
      teacherId: teacher2Id,
      weekday: "TUESDAY",
      startMin: 14 * 60,
      endMin: 15 * 60,
      validFrom: iso(nextWeekday(1)),
    }),
    createSchedule(ctxA, {
      academicYearId: yearAId,
      classroomId: classAId,
      teacherId,
      weekday: "TUESDAY",
      startMin: 14 * 60,
      endMin: 15 * 60,
      validFrom: iso(nextWeekday(1)),
    }),
  ]);
  record(
    "double réservation concurrente : au moins une refusée",
    !(c1.ok && c2.ok),
    `c1=${c1.ok ? "ok" : c1.error} c2=${c2.ok ? "ok" : c2.error}`,
  );

  // ---- Emploi du temps de la semaine ----
  const tt = await getWeekTimetable(
    { schoolId: schoolA.id },
    { weekStart: weekStart(new Date()), classroomId: classAId },
  );
  const ttMon = tt.filter(
    (s) => s.weekday === "MONDAY" && s.startMin === 480,
  );
  const ttSat = tt.filter((s) => s.weekday === "SATURDAY");
  record(
    "EDT semaine : créneau lundi visible",
    ttMon.length === 1,
    `${ttMon.length}`,
  );
  record("EDT semaine : créneau SAMEDI visible", ttSat.length === 1);

  // ---- Séance matérialisée + appel ----
  const session = await ensureSessionFromSchedule(ctxA, schedId, iso(monday));
  record("séance matérialisée depuis créneau", session.ok);
  if (!session.ok) throw new Error("ensureSession failed");
  const sessionId = session.result.id;

  const sessionAgain = await ensureSessionFromSchedule(ctxA, schedId, iso(monday));
  record(
    "matérialisation idempotente (pas de doublon)",
    sessionAgain.ok && sessionAgain.result.id === sessionId,
  );

  const roster = await getSessionRoster(ctxA, sessionId);
  record("appel : effectif chargé (2 élèves)", roster?.students.length === 2);

  const call = await saveSessionAttendance(ctxA, sessionId, [
    { studentId: st1.result.id, status: "PRESENT" },
    { studentId: st2.result.id, status: "LATE", arrivalMin: 8 * 60 + 20 },
  ]);
  record("appel enregistré", call.ok);

  const roster2 = await getSessionRoster(ctxA, sessionId);
  const rec2 = roster2?.records.get(st2.result.id);
  const rec2Row = rec2
    ? await prisma.attendanceRecord.findUniqueOrThrow({
        where: { id: rec2.id },
      })
    : null;
  record(
    "retard calculé (20 min, 08h00→08h20)",
    rec2?.status === "LATE" && rec2Row?.durationMin === 20,
    `durée=${rec2Row?.durationMin}`,
  );

  // ---- Absence + justification ----
  const abs = await addAttendanceRecord(ctxA, {
    studentId: st1.result.id,
    date: iso(monday),
    status: "ABSENT",
    sessionId,
    reason: "Maladie",
  });
  record("absence enregistrée", abs.ok);
  if (!abs.ok) throw new Error("absence failed");

  const late = await addAttendanceRecord(ctxA, {
    studentId: st1.result.id,
    date: iso(monday),
    status: "LATE",
    expectedMin: 480,
    arrivalMin: 510,
    reason: "Transport",
  });
  record("retard enregistré", late.ok);
  const lateRec = late.ok
    ? await prisma.attendanceRecord.findUniqueOrThrow({
        where: { id: late.result.id },
      })
    : null;
  record("durée retard calculée (30 min)", lateRec?.durationMin === 30);

  const just = await justifyAttendance(ctxA, abs.result.id, "Certificat médical");
  record("absence justifiée", just.ok);
  const absAfter = await prisma.attendanceRecord.findUniqueOrThrow({
    where: { id: abs.result.id },
  });
  record(
    "justification persistée (statut EXCUSED)",
    absAfter.status === "EXCUSED" && absAfter.justifiedAt !== null,
  );

  // ---- Fiches élève / classe ----
  const stSum = await studentAttendanceSummary(ctxA, st1.result.id);
  record(
    "fiche élève : compteurs présence",
    stSum.lates === 1 && stSum.justified === 1,
    JSON.stringify(stSum),
  );

  const stats = await classroomStats(ctxA, classAId);
  record(
    "fiche classe : statistiques",
    stats.planned + stats.done >= 1 && stats.lates >= 2,
    JSON.stringify(stats),
  );

  // ---- Déplacement / annulation / remplacement ----
  const moved = await moveSession(ctxA, sessionId, {
    date: iso(nextWeekday(2)),
    startMin: 15 * 60,
    endMin: 16 * 60,
  });
  record("séance déplacée (mercredi 15h)", moved.ok, moved.ok ? "" : String(moved.error));

  const movedBack = await moveSession(ctxA, sessionId, {
    date: iso(monday),
    startMin: 8 * 60,
    endMin: 9 * 60,
  });
  record("séance replacée", movedBack.ok);

  const replaced = await replaceSessionTeacher(ctxA, sessionId, teacher2Id);
  record("enseignant remplacé", replaced.ok, replaced.ok ? "" : JSON.stringify(replaced));

  const cancelled = await setSessionStatus(ctxA, sessionId, "CANCELLED", "Grève");
  record("séance annulée", cancelled.ok);

  const replanned = await setSessionStatus(ctxA, sessionId, "PLANNED");
  record("séance rétablie", replanned.ok);

  const content = await upsertSessionContent(ctxA, sessionId, {
    theme: "Fractions",
    chapter: "Ch. 3",
    objective: "Additionner deux fractions",
    content: "Cours magistral + exercices",
    homework: "Ex. 12 p. 45",
  });
  record("cahier de textes renseigné", content.ok);
  const contentRow = await prisma.courseContent.findUnique({
    where: { sessionId },
  });
  record("contenu persisté", contentRow?.theme === "Fractions");

  // ---- Séance ponctuelle ----
  const once = await createSession(ctxA, {
    classroomId: classAId,
    teacherId,
    subjectId,
    date: iso(nextWeekday(3)),
    startMin: 11 * 60,
    endMin: 12 * 60,
  });
  record("séance ponctuelle créée", once.ok, once.ok ? "" : String(once.error));

  // ---- Cross-tenant ----
  const crossSchedule = await createSchedule(ctxB, {
    academicYearId: yearAId, // année de A !
    classroomId: classAId,
    teacherId,
    subjectId,
    roomId,
    weekday: "WEDNESDAY",
    startMin: 9 * 60,
    endMin: 10 * 60,
    validFrom: iso(nextWeekday(2)),
  });
  record(
    "créneau cross-tenant refusé (références A depuis B)",
    !crossSchedule.ok && crossSchedule.error === "NOT_FOUND",
  );

  const crossSession = await ensureSessionFromSchedule(ctxB, schedId, iso(monday));
  record(
    "séance cross-tenant refusée",
    !crossSession.ok && crossSession.error === "NOT_FOUND",
  );

  const crossRoster = await getSessionRoster(ctxB, sessionId);
  record("roster cross-tenant invisible", crossRoster === null);

  const crossAtt = await listAttendance(ctxB, { studentId: st1.result.id });
  record("absences A invisibles depuis B", crossAtt.total === 0);

  // ---- Enseignant : restriction ----
  const teacherUser = await prisma.user.upsert({
    where: { email: "phase4-teacher@ecom-test.local" },
    update: { schoolId: schoolA.id, status: "ACTIVE" },
    create: {
      email: "phase4-teacher@ecom-test.local",
      passwordHash: await hashPassword(process.env.SEED_TEST_PASSWORD!),
      schoolId: schoolA.id,
      status: "ACTIVE",
      firstName: "Prof",
      lastName: "User",
    },
  });
  await prisma.teacher.update({
    where: { id: teacherId },
    data: { userId: teacherUser.id },
  });
  const tid = await teacherIdForUser({
    userId: teacherUser.id,
    schoolId: schoolA.id,
  });
  record("résolution enseignant par userId", tid === teacherId);

  // enseignant non assigné à cette séance (remplacée par teacher2)
  const forbidden = await saveSessionAttendance(
    { userId: teacherUser.id, schoolId: schoolA.id },
    sessionId,
    [{ studentId: st1.result.id, status: "PRESENT" }],
    teacherId, // session.teacherId = teacher2Id maintenant
  );
  record(
    "enseignant non affecté ne peut pas faire l'appel",
    !forbidden.ok && forbidden.error === "FORBIDDEN",
  );

  // ---- PDF ----
  const pdfOk = await new Promise<boolean>((resolve) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(chunks.length > 0 && Buffer.concat(chunks).length > 500));
    doc.fontSize(14).text("Emploi du temps — test");
    doc.end();
  });
  record("génération PDF (pdfkit) fonctionnelle", pdfOk);

  // ---- Dashboard pédagogique ----
  const pd = await getPedagogyDashboard({ schoolId: schoolA.id });
  record(
    "dashboard école : indicateurs calculés",
    typeof pd.plannedToday === "number" &&
      typeof pd.absencesToday === "number",
    JSON.stringify(pd),
  );

  // ---- Rapport ----
  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n=== PHASE 4 BUSINESS TEST ===`);
  for (const c of checks) {
    console.log(`${c.ok ? "OK  " : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  console.log(`\n${passed}/${checks.length} checks OK`);
  if (failed.length > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("PHASE4_TEST_FAILED");
    console.error(e);
    const passed = checks.filter((c) => c.ok).length;
    console.log(`\n${passed}/${checks.length} checks OK (arrêté en cours)`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
