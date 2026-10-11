import "dotenv/config";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth/password";
import { createYear } from "@/lib/services/academic";
import { createLevel, createClassroom } from "@/lib/services/classes";
import { createTeacher } from "@/lib/services/teachers";
import { createSubject, setClassroomSubject } from "@/lib/services/subjects";
import { createStudent } from "@/lib/services/students";
import { enrollStudent } from "@/lib/services/enrollments";
import {
  upsertPolicy,
  resolveRules,
  annualWeightsFor,
} from "@/lib/services/grading/policy";
import {
  ensureDefaultAssessmentTypes,
  createAssessment,
  setAssessmentStatus,
  listAssessments,
} from "@/lib/services/grading/assessments";
import {
  getGradeGrid,
  saveGrades,
  parseGradesCsv,
} from "@/lib/services/grading/grades";
import {
  subjectAverage,
  generalAverage,
  computeRanks,
  roundScore,
  DEFAULT_RULES,
} from "@/lib/services/grading/calculation";
import {
  calculateClassPeriod,
  computeAndStore,
  setValidationStatus,
  computeAnnualResults,
} from "@/lib/services/grading/results";
import {
  generateReportCard,
  generateClassReportCards,
  getReportCard,
  rectifyReportCard,
  ensureDefaultTemplates,
} from "@/lib/services/grading/reportcards";
import { teacherIdForUser } from "@/lib/services/attendance";
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

const S = Date.now() % 100000; // suffixe unique

async function main() {
  const schoolA = await ensureSchool("TEST-P5-A", "Ecole Test Phase5 A");
  const schoolB = await ensureSchool("TEST-P5-B", "Ecole Test Phase5 B");
  const adminA = await ensureUser(schoolA.id, "phase5-admin-a@ecom-test.local", "ADMIN_SCHOOL");
  const adminB = await ensureUser(schoolB.id, "phase5-admin-b@ecom-test.local", "ADMIN_SCHOOL");
  const ctxA = { userId: adminA, schoolId: schoolA.id };
  const ctxB = { userId: adminB, schoolId: schoolB.id };

  // ---- Référentiels ----
  const year = await createYear(ctxA, {
    name: `P5-${S}`,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    periodType: "TRIMESTER",
    isCurrent: true,
  });
  record("année scolaire A", year.ok);
  if (!year.ok) throw new Error("createYear failed");
  const yearId = year.result.id;
  const periods = await prisma.academicPeriod.findMany({
    where: { schoolId: schoolA.id, academicYearId: yearId },
    orderBy: { number: "asc" },
  });
  const period = periods.find((p) => p.number === 1)!;
  const period2 = periods.find((p) => p.number === 2)!;

  const level = await createLevel(ctxA, { name: `6e-P5-${S}`, order: 1 });
  if (!level.ok) throw new Error("createLevel failed");
  const classroom = await createClassroom(ctxA, {
    name: `6eA-P5-${S}`,
    levelId: level.result.id,
    academicYearId: yearId,
  });
  if (!classroom.ok) throw new Error("createClassroom failed");
  const classroomId = classroom.result.id;

  const maths = await createSubject(ctxA, { name: `Maths-P5-${S}`, code: "MTH" });
  const franc = await createSubject(ctxA, { name: `Français-P5-${S}`, code: "FRA" });
  if (!maths.ok || !franc.ok) throw new Error("createSubject failed");

  const teacher = await createTeacher(ctxA, { firstName: "Awa", lastName: `P5-${S}` });
  if (!teacher.ok) throw new Error("createTeacher failed");
  const teacherId = teacher.result.id;

  const otherTeacher = await createTeacher(ctxA, { firstName: "Omar", lastName: `P5-${S}` });
  if (!otherTeacher.ok) throw new Error("otherTeacher failed");

  // Coefficients matière : Maths coef 3 via ClassroomSubject, Français via rien (défaut 1)
  const cs = await setClassroomSubject(ctxA, {
    classroomId,
    subjectId: maths.result.id,
    coefficient: 3,
    teacherId,
  });
  record("coefficient matière classe (Maths=3)", cs.ok);

  // ---- Élèves ----
  const students: { id: string; matricule: string }[] = [];
  for (const [i, name] of ["Alice", "Bob", "Chloe"].entries()) {
    const st = await createStudent(ctxA, {
      matricule: `P5-${S}-${i}`,
      firstName: name,
      lastName: "Eleve",
      sex: i === 1 ? "MALE" : "FEMALE",
    });
    if (!st.ok) throw new Error("createStudent failed");
    students.push({ id: st.result.id, matricule: `P5-${S}-${i}` });
    const en = await enrollStudent(ctxA, {
      studentId: st.result.id,
      classroomId,
      academicYearId: yearId,
    });
    if (!en.ok) throw new Error("enrollStudent failed");
    // Recale la date d'inscription avant la période T1 (roster/appel)
    await prisma.enrollment.update({
      where: { id: en.result.id },
      data: { enrolledAt: new Date("2026-01-05T00:00:00.000Z") },
    });
  }
  record("3 élèves inscrits", students.length === 3);

  // ---- Politique de notation ----
  const pol = await upsertPolicy(ctxA, {
    academicYearId: yearId,
    maxScore: 20,
    precision: 2,
    rounding: "HALF_UP",
    passMark: 10,
    missingGradePolicy: "EXCLUDE",
    absentPolicy: "EXCLUDE",
    tieRule: "SHARED_RANK",
    annualWeights: { [period.id]: 1, [period2.id]: 2 },
  });
  record("politique de notation enregistrée", pol.ok);
  const rules = await resolveRules(ctxA, yearId, level.result.id);
  record("résolution règles (max=20, seuil=10)", rules.maxScore === 20 && rules.passMark === 10);
  const weights = await annualWeightsFor(ctxA, yearId);
  record("pondérations annuelles lues", weights[period2.id] === 2);

  // ---- Types d'évaluation ----
  const types = await ensureDefaultAssessmentTypes(ctxA);
  record("types d'évaluation par défaut", types.length >= 4);
  const devoir = types.find((t) => t.code === "DEVOIR")!;
  const compo = types.find((t) => t.code === "COMPOSITION")!;

  // ---- Création d'évaluations ----
  const evals: string[] = [];
  for (const [title, type, coef] of [
    ["Devoir 1", devoir.id, 1],
    ["Devoir 2", devoir.id, 1],
    ["Composition", compo.id, 2],
  ] as const) {
    const a = await createAssessment(ctxA, {
      academicYearId: yearId,
      academicPeriodId: period.id,
      classroomId,
      subjectId: maths.result.id,
      teacherId,
      typeId: type,
      title,
      date: new Date("2026-02-15T00:00:00.000Z"),
      maxScore: 20,
      coefficient: coef,
    });
    if (!a.ok) throw new Error(`createAssessment ${title} failed`);
    evals.push(a.result.id);
  }
  record("3 évaluations Maths créées", evals.length === 3);

  // Évaluation sur 40 (test normalisation)
  const eval40 = await createAssessment(ctxA, {
    academicYearId: yearId,
    academicPeriodId: period.id,
    classroomId,
    subjectId: franc.result.id,
    teacherId,
    typeId: devoir.id,
    title: "Devoir Français /40",
    date: new Date("2026-02-16T00:00:00.000Z"),
    maxScore: 40,
    coefficient: 1,
  });
  if (!eval40.ok) throw new Error("eval40 failed");

  // ---- Compte enseignant lié ----
  const teacherUser = await ensureUser(schoolA.id, "phase5-teacher@ecom-test.local", "TEACHER");
  await prisma.teacher.update({ where: { id: teacherId }, data: { userId: teacherUser } });
  // Affectation enseignant → classe/matière (sinon FORBIDDEN attendu plus bas)
  await prisma.teachingAssignment.create({
    data: {
      schoolId: schoolA.id,
      teacherId,
      classroomId,
      subjectId: maths.result.id,
      academicYearId: yearId,
    },
  });
  const tid = await teacherIdForUser({ userId: teacherUser, schoolId: schoolA.id });
  record("compte enseignant lié", tid === teacherId);
  const ctxT = { userId: teacherUser, schoolId: schoolA.id };

  // Enseignant : création dans son périmètre OK
  const tEval = await createAssessment(
    ctxT,
    {
      academicYearId: yearId,
      academicPeriodId: period.id,
      classroomId,
      subjectId: maths.result.id,
      typeId: devoir.id,
      title: "Devoir enseignant",
      date: new Date("2026-02-20T00:00:00.000Z"),
      maxScore: 20,
      coefficient: 1,
    },
    { asTeacher: true },
  );
  record("enseignant crée une évaluation (affecté)", tEval.ok);

  // Enseignant : création hors périmètre refusée (autre matière non affectée)
  const tForbidden = await createAssessment(
    ctxT,
    {
      academicYearId: yearId,
      academicPeriodId: period.id,
      classroomId,
      subjectId: franc.result.id,
      typeId: devoir.id,
      title: "Hors périmètre",
      date: new Date("2026-02-20T00:00:00.000Z"),
      maxScore: 20,
    },
    { asTeacher: true },
  );
  record("enseignant hors périmètre refusé", !tForbidden.ok && tForbidden.error === "FORBIDDEN");

  // ---- Saisie des notes ----
  // Alice : 12, 14, 16 → moyenne attendue (12+14+16*2)/4 = 14.5
  // Bob : 10, 10, 10 → 10 ; Chloe : 14, 14, 14 → 14 (ex æquo potentiel ailleurs)
  const g1 = await saveGrades(ctxA, evals[0], [
    { studentId: students[0].id, value: 12, status: "ENTERED" },
    { studentId: students[1].id, value: 10, status: "ENTERED" },
    { studentId: students[2].id, value: 14, status: "ENTERED" },
  ]);
  record("saisie devoir 1", g1.ok && g1.result.saved === 3);
  await saveGrades(ctxA, evals[1], [
    { studentId: students[0].id, value: 14, status: "ENTERED" },
    { studentId: students[1].id, value: 10, status: "ENTERED" },
    { studentId: students[2].id, value: 14, status: "ENTERED" },
  ]);
  await saveGrades(ctxA, evals[2], [
    { studentId: students[0].id, value: 16, status: "ENTERED" },
    { studentId: students[1].id, value: 10, status: "ENTERED" },
    { studentId: students[2].id, value: 14, status: "ENTERED" },
  ]);

  // Note hors barème rejetée
  const oor = await saveGrades(ctxA, evals[0], [
    { studentId: students[0].id, value: 25, status: "ENTERED" },
  ]);
  record("note hors barème rejetée", !oor.ok && oor.error === "OUT_OF_RANGE");

  // Absence (pas un zéro automatique) — évaluation enseignant : Chloe absente
  if (tEval.ok) {
    await saveGrades(ctxA, tEval.result.id, [
      { studentId: students[0].id, value: 18, status: "ENTERED" },
      { studentId: students[1].id, status: "ABSENT" },
      { studentId: students[2].id, status: "MISSING" },
    ]);
  }

  // Révision : modification d'une note → GradeRevision
  await saveGrades(ctxA, evals[0], [
    { studentId: students[0].id, value: 13, status: "ENTERED", observation: "correction" },
  ]);
  const rev = await prisma.gradeRevision.count({
    where: { grade: { assessmentId: evals[0], studentId: students[0].id } },
  });
  record("révision de note historisée", rev >= 1);
  // Alice devient 13 : nouvelle moyenne (13+14+32)/4 = 14.75

  // Français /40 : Alice 30/40 → 15/20 normalisé ; Bob 16/40 → 8/20
  await saveGrades(ctxA, eval40.result.id, [
    { studentId: students[0].id, value: 30, status: "ENTERED" },
    { studentId: students[1].id, value: 16, status: "ENTERED" },
    { studentId: students[2].id, value: 28, status: "ENTERED" },
  ]);

  // ---- Vérifications du moteur pur ----
  const subj = subjectAverage(
    [
      { value: 12, status: "ENTERED" },
      { value: 14, status: "ENTERED" },
      { value: 16, status: "ENTERED" },
    ],
    [{ maxScore: 20, coefficient: 1 }, { maxScore: 20, coefficient: 1 }, { maxScore: 20, coefficient: 2 }],
    DEFAULT_RULES,
  );
  record("moyenne matière pondérée (référence 14,50)", subj.average === 14.5);

  const norm = subjectAverage(
    [{ value: 30, status: "ENTERED" }],
    [{ maxScore: 40, coefficient: 1 }],
    DEFAULT_RULES,
  );
  record("normalisation /40 → /20 (30/40 = 15)", norm.average === 15);

  const absCalc = subjectAverage(
    [{ value: null, status: "ABSENT" }],
    [{ maxScore: 20, coefficient: 1 }],
    { ...DEFAULT_RULES, absentPolicy: "EXCLUDE" },
  );
  record("absence exclue (pas de zéro)", absCalc.average === null);
  const absZero = subjectAverage(
    [{ value: null, status: "ABSENT" }],
    [{ maxScore: 20, coefficient: 1 }],
    { ...DEFAULT_RULES, absentPolicy: "ZERO" },
  );
  record("absence=zéro si politique ZERO", absZero.average === 0);

  const ranks = computeRanks(
    [
      { id: "a", average: 15 },
      { id: "b", average: 15 },
      { id: "c", average: 10 },
    ],
    "SHARED_RANK",
  );
  record("ex æquo partagés (1,1,3)", ranks.get("a") === 1 && ranks.get("b") === 1 && ranks.get("c") === 3);

  // ---- Calcul collectif ----
  const calc = await calculateClassPeriod(ctxA, {
    classroomId,
    academicPeriodId: period.id,
  });
  record("calcul de classe exécuté", calc.ok);
  if (calc.ok) {
    const alice = calc.result.students.find((s) => s.studentId === students[0].id)!;
    const bob = calc.result.students.find((s) => s.studentId === students[1].id)!;
    // Alice maths : (13+14+32)/4=14.75 + devoir ens. 18 → (13+14+32+18)/5 = 15.4 ; /!\ tEval coef 1 → (59+18)/5? recalc: (13*1+14*1+16*2+18*1)/5 = 77/5 = 15.4
    const aliceMaths = alice.subjects.find((s) => s.subjectId === maths.result.id);
    record(
      "moyenne Maths Alice = 15,40 (référence)",
      aliceMaths?.average === 15.4,
      `obtenu=${aliceMaths?.average}`,
    );
    // Alice générale : (15.4*3 + 15*1)/4 = 61.2/4 = 15.3
    record(
      "moyenne générale Alice = 15,30 (coef Maths=3, Fra=1)",
      alice.generalAverage === 15.3,
      `obtenu=${alice.generalAverage}`,
    );
    // Bob maths : (10+10+20+ABSENT exclu)/4 → (10+10+20)/4=10 ; français 8 → générale (10*3+8)/4 = 9.5
    record(
      "moyenne générale Bob = 9,50",
      bob.generalAverage === 9.5,
      `obtenu=${bob.generalAverage}`,
    );
    record("rangs calculés", alice.rank === 1);
    record("statistiques classe", calc.result.stats.ranked === 3);
  }

  // ---- Persistance + workflow ----
  const stored = await computeAndStore(ctxA, { classroomId, academicPeriodId: period.id });
  record("résultats persistés", stored.ok && stored.result.students === 3);

  const invalidTransition = await setValidationStatus(ctxA, {
    classroomId, academicPeriodId: period.id, status: "PUBLISHED",
  });
  record("publication directe refusée", !invalidTransition.ok && invalidTransition.error === "INVALID_STATUS");

  const validated = await setValidationStatus(ctxA, {
    classroomId, academicPeriodId: period.id, status: "VALIDATED",
  });
  record("résultats validés", validated.ok);

  const published = await setValidationStatus(ctxA, {
    classroomId, academicPeriodId: period.id, status: "PUBLISHED",
  });
  record("résultats publiés", published.ok);

  // ---- Bulletins ----
  const card = await generateReportCard(ctxA, {
    studentId: students[0].id,
    academicPeriodId: period.id,
  });
  record("bulletin généré (v1)", card.ok && card.result.version === 1);

  const all = await generateClassReportCards(ctxA, { classroomId, academicPeriodId: period.id });
  record("génération collective", all.ok && all.result.generated === 3);

  const cardDetail = card.ok ? await getReportCard(ctxA, card.result.id) : null;
  record("snapshot bulletin conservé", (cardDetail?.versions.length ?? 0) >= 2);

  const rectified = card.ok
    ? await rectifyReportCard(ctxA, card.result.id, "Correction composition")
    : { ok: false as const };
  record("rectification → nouvelle version", rectified.ok && rectified.result.version === 3);
  const afterRectify = card.ok ? await getReportCard(ctxA, card.result.id) : null;
  record(
    "versions historisées (v1..v3 conservées)",
    (afterRectify?.versions.length ?? 0) === 3 && afterRectify?.versions[2]?.payload != null,
  );

  // ---- PDF ----
  const payload = cardDetail?.versions[0]?.payload;
  const pdfOk = await new Promise<boolean>((resolve) => {
    const doc = new PDFDocument({ size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks).length > 500));
    doc.fontSize(14).text(`Bulletin test — ${JSON.stringify(payload ? "payload" : "vide").slice(0, 20)}`);
    doc.end();
  });
  record("PDF bulletin générable (pdfkit)", pdfOk && payload != null);

  // ---- Résultats annuels ----
  // Ajoute une note T2 pour Alice puis calcule résultats annuels
  const evalT2 = await createAssessment(ctxA, {
    academicYearId: yearId,
    academicPeriodId: period2.id,
    classroomId,
    subjectId: maths.result.id,
    teacherId,
    typeId: devoir.id,
    title: "Devoir T2",
    date: new Date("2026-05-10T00:00:00.000Z"),
    maxScore: 20,
    coefficient: 1,
  });
  if (evalT2.ok) {
    await saveGrades(ctxA, evalT2.result.id, [
      { studentId: students[0].id, value: 16, status: "ENTERED" },
      { studentId: students[1].id, value: 12, status: "ENTERED" },
      { studentId: students[2].id, value: 12, status: "ENTERED" },
    ]);
    await computeAndStore(ctxA, { classroomId, academicPeriodId: period2.id });
  }
  const annual = await computeAnnualResults(ctxA, yearId);
  record("résultats annuels calculés", annual.ok && annual.result.students === 3);
  if (annual.ok) {
    const aliceAnnual = await prisma.studentAnnualResult.findFirst({
      where: { schoolId: schoolA.id, academicYearId: yearId, studentId: students[0].id },
    });
    // Alice : T1 moy=15.3 (coef1) ; T2 maths=16, français sans note T2 → moy=16 (coef2)
    // attendu : (15.3*1 + 16*2)/3 ≈ 15.7667 → 15.77
    const expected = roundScore((15.3 * 1 + 16 * 2) / 3, 2, "HALF_UP");
    record(
      `moyenne annuelle Alice = ${expected} (pondérée)`,
      aliceAnnual?.annualAverage === expected,
      `obtenu=${aliceAnnual?.annualAverage}`,
    );
  }

  // ---- Grille & fiches ----
  const grid = await getGradeGrid(ctxA, evals[0]);
  record("grille de saisie (3 élèves)", grid.ok && grid.result.rows.length === 3);

  // ---- Cross-tenant ----
  const crossAssess = await listAssessments(ctxB, { classroomId });
  record("évaluations A invisibles depuis B", crossAssess.total === 0);
  const crossCalc = await calculateClassPeriod(ctxB, {
    classroomId,
    academicPeriodId: period.id,
  });
  record("calcul cross-tenant refusé", !crossCalc.ok);
  const crossGrid = await getGradeGrid(ctxB, evals[0]);
  record("grille cross-tenant refusée", !crossGrid.ok);
  const crossCard = card.ok ? await getReportCard(ctxB, card.result.id) : null;
  record("bulletin A invisible depuis B", crossCard === null);

  // ---- Enseignant non affecté : saisie refusée ----
  const otherUser = await ensureUser(schoolA.id, "phase5-teacher2@ecom-test.local", "TEACHER");
  await prisma.teacher.update({ where: { id: otherTeacher.result.id }, data: { userId: otherUser } });
  const denyGrades = await saveGrades(
    { userId: otherUser, schoolId: schoolA.id },
    evals[0],
    [{ studentId: students[0].id, value: 5, status: "ENTERED" }],
    { asTeacher: true },
  );
  record("saisie hors périmètre refusée", !denyGrades.ok && denyGrades.error === "FORBIDDEN");

  // CSV parse
  const parsed = parseGradesCsv("matricule;note\nP5-x-0;14,5;OK\nP5-x-1;;\n");
  record("parse CSV notes", parsed.length === 2 && parsed[0].value === 14.5 && parsed[1].value === null);

  // ---- Rapport ----
  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    console.log(`${c.ok ? "OK  " : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  console.log(`\n${checks.length - failed.length}/${checks.length} checks OK`);
  if (failed.length > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("PHASE5_TEST_FAILED");
    console.error(e);
    const failed = checks.filter((c) => !c.ok);
    console.log(`\n${checks.length - failed.length}/${checks.length} checks OK`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
