/**
 * Recette H6 — passage / redoublement / orientation :
 * progression structurée synchronisée par les délibérations annuelles
 * H5 vers StudentAnnualResult.progression, reprise par les
 * réinscriptions G2 (suggestion jamais automatique), cas particuliers,
 * niveau terminal, réconciliation explicite après dépublication ou
 * correction, conflits, permissions, isolation — sans création
 * automatique d'inscription ni modification des décisions d'origine.
 *
 * Usage : npx tsx scripts/h6/progressions-recette.ts
 */
import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";
import {
  adjustDecision,
  depublishSession,
  prepareSession,
  publishSession,
  unlockSession,
  upsertRule,
  validateSession,
} from "../../src/lib/services/deliberations";
import {
  createReenrollmentCampaign,
  decideReenrollmentRequest,
  listEligibleStudents,
  listReenrollmentCampaigns,
  updateReenrollmentCampaign,
} from "../../src/lib/services/reenrollment";

let pass = 0, fail = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};
const err = <T,>(r: { ok: true; result: T } | { ok: false; error: string }) =>
  (r.ok ? null : r.error);

const SLUG = "h6-fix";
const SLUG2 = "h6-fix-bis";
const EMAILS = [
  "h6-admin@test.local",
  "h6-read@test.local",
  "h6-noperm@test.local",
];

async function makeUser(email: string) {
  return prisma.user.create({
    data: { email, passwordHash: "x", firstName: "H6", lastName: email, status: "ACTIVE" },
  });
}

async function makeMember(userId: string, schoolId: string, permKeys: string[]) {
  const role = await prisma.role.create({
    data: { name: `H6_${userId.slice(-4)}_${schoolId.slice(-4)}`, scope: "SCHOOL", schoolId },
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
  await prisma.reenrollmentMessage.deleteMany({ where: { schoolId } });
  await prisma.reenrollmentRequest.deleteMany({ where: { schoolId } });
  await prisma.reenrollmentCampaign.deleteMany({ where: { schoolId } });
  await prisma.deliberationDecision.deleteMany({ where: { schoolId } });
  await prisma.deliberationSession.deleteMany({ where: { schoolId } });
  await prisma.deliberationRule.deleteMany({ where: { schoolId } });
  await prisma.studentAnnualResult.deleteMany({ where: { schoolId } });
  await prisma.studentPeriodResult.deleteMany({ where: { schoolId } });
  await prisma.academicPeriod.deleteMany({ where: { schoolId } });
  await prisma.enrollment.deleteMany({ where: { schoolId } });
  await prisma.student.deleteMany({ where: { schoolId } });
  await prisma.classroom.deleteMany({ where: { schoolId } });
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

(async () => {
  for (const slug of [SLUG, SLUG2]) {
    const old = await prisma.school.findFirst({ where: { slug }, select: { id: true } });
    if (old) await cleanupSchool(old.id);
  }
  const stale = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
  if (stale.length) {
    const ids = stale.map((u) => u.id);
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }

  // ---------- École A : années source/cible, niveaux, classes ----------
  const A = await prisma.school.create({ data: { name: "H6 Ecole A", code: "H6A", slug: SLUG } });
  const y0 = await prisma.academicYear.create({
    data: {
      schoolId: A.id, name: "2026-2027",
      startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30"),
      status: "ACTIVE", isCurrent: true,
    },
  });
  const y1 = await prisma.academicYear.create({
    data: {
      schoolId: A.id, name: "2027-2028",
      startDate: new Date("2027-09-01"), endDate: new Date("2028-06-30"),
      status: "ACTIVE", isCurrent: false,
    },
  });
  const l6 = await prisma.level.create({ data: { schoolId: A.id, name: "6e", order: 1 } });
  const l5 = await prisma.level.create({ data: { schoolId: A.id, name: "5e", order: 2 } });
  const lT = await prisma.level.create({ data: { schoolId: A.id, name: "Tle", order: 3 } });
  const c6 = await prisma.classroom.create({
    data: { schoolId: A.id, academicYearId: y0.id, levelId: l6.id, name: "6e A" },
  });
  const cT = await prisma.classroom.create({
    data: { schoolId: A.id, academicYearId: y0.id, levelId: lT.id, name: "Tle A" },
  });
  const c5y1 = await prisma.classroom.create({
    data: { schoolId: A.id, academicYearId: y1.id, levelId: l5.id, name: "5e A" },
  });

  const mkStudent = async (mat: string, first: string, classroomId: string, yearId: string) => {
    const student = await prisma.student.create({
      data: { schoolId: A.id, matricule: mat, firstName: first, lastName: "H6A", sex: "FEMALE" },
    });
    const enrollment = await prisma.enrollment.create({
      data: {
        schoolId: A.id, studentId: student.id,
        classroomId, academicYearId: yearId, status: "ENROLLED",
      },
    });
    return { student, enrollment };
  };
  const sar = (studentId: string, avg: number, rank: number) =>
    prisma.studentAnnualResult.create({
      data: {
        schoolId: A.id, academicYearId: y0.id, studentId,
        annualAverage: avg, rank, status: "PUBLISHED",
      },
    });

  const e1 = await mkStudent("H6A-01", "Awa", c6.id, y0.id);    // 16 → PROMOTION
  const e2 = await mkStudent("H6A-02", "Karim", c6.id, y0.id); // 8  → REPETITION
  const e3 = await mkStudent("H6A-03", "Léa", c6.id, y0.id);   // 11 → REMEDIAL
  const e4 = await mkStudent("H6A-04", "Noa", c6.id, y0.id);   // 4  → DEFERRED
  const e5 = await mkStudent("H6A-05", "Ines", c6.id, y0.id);  // 9.5→ ORIENTATION
  const e6 = await mkStudent("H6A-06", "Yanis", c6.id, y0.id); // 14 → libellé sans progression (ambigu)
  const e8 = await mkStudent("H6A-08", "Malo", c6.id, y0.id);  // 2  → EXIT
  const e7 = await mkStudent("H6A-07", "Sara", cT.id, y0.id);  // 15 → PROMOTION niveau terminal

  const sar1 = await sar(e1.student.id, 16, 1);
  const sar2 = await sar(e2.student.id, 8, 6);
  const sar3 = await sar(e3.student.id, 11, 4);
  const sar4 = await sar(e4.student.id, 4, 7);
  const sar5 = await sar(e5.student.id, 9.5, 5);
  const sar6 = await sar(e6.student.id, 14, 2);
  const sar8 = await sar(e8.student.id, 2, 8);
  const sar7 = await sar(e7.student.id, 15, 1);

  // ---------- École B : isolation ----------
  const B = await prisma.school.create({ data: { name: "H6 Ecole B", code: "H6B", slug: SLUG2 } });
  const bYear = await prisma.academicYear.create({
    data: {
      schoolId: B.id, name: "2026-2027",
      startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30"),
      status: "ACTIVE", isCurrent: true,
    },
  });
  const bLevel = await prisma.level.create({ data: { schoolId: B.id, name: "6e", order: 1 } });
  const bClass = await prisma.classroom.create({
    data: { schoolId: B.id, academicYearId: bYear.id, levelId: bLevel.id, name: "6e A" },
  });
  const bs = await prisma.student.create({
    data: { schoolId: B.id, matricule: "H6B-01", firstName: "Zoe", lastName: "H6B", sex: "FEMALE" },
  });
  await prisma.enrollment.create({
    data: {
      schoolId: B.id, studentId: bs.id, classroomId: bClass.id,
      academicYearId: bYear.id, status: "ENROLLED",
    },
  });

  // ---------- Utilisateurs ----------
  const admin = await makeUser(EMAILS[0]);
  await makeMember(admin.id, A.id, [
    "deliberations.read", "deliberations.manage", "deliberations.validate", "deliberations.publish",
    "reenrollments.read", "reenrollments.manage", "reenrollments.review",
    "reenrollments.decide", "enrollment.create",
  ]);
  const reader = await makeUser(EMAILS[1]);
  await makeMember(reader.id, A.id, ["reenrollments.read"]);
  const noperm = await makeUser(EMAILS[2]);
  await makeMember(noperm.id, A.id, ["students.read"]);

  const ctxA = { userId: admin.id, schoolId: A.id };
  const ctxR = { userId: reader.id, schoolId: A.id };
  const ctxN = { userId: noperm.id, schoolId: A.id };

  // ---------- Règles annuelles avec progression structurée ----------
  const rule = (
    label: string,
    min: number | null, max: number | null,
    progression: "PROMOTION" | "REPETITION" | "SAME_LEVEL" | "CLASS_CHANGE" |
      "CYCLE_CHANGE" | "RETURN" | "REMEDIAL" | "DEFERRED" | "ORIENTATION" | "EXIT" | null,
    order: number,
  ) =>
    upsertRule(ctxA, {
      scope: "ANNUAL", label, minAverage: min, maxAverage: max,
      progression, order,
    });

  console.log("\n== Règles annuelles H5 → progression ==");
  check("règle Admis→PROMOTION", err(await rule("Admis", 15, 21, "PROMOTION", 10)) == null);
  check("règle Rattrapage→REMEDIAL", err(await rule("Rattrapage", 10, 12, "REMEDIAL", 20)) == null);
  check("règle Orienté→ORIENTATION", err(await rule("Orienté", 9, 10, "ORIENTATION", 30)) == null);
  check("règle Redouble→REPETITION", err(await rule("Redouble", 6, 9, "REPETITION", 40)) == null);
  check("règle Ajourné→DEFERRED", err(await rule("Ajourné", 3, 6, "DEFERRED", 50)) == null);
  check("règle Sortie→EXIT", err(await rule("Sortie", 0, 3, "EXIT", 60)) == null);
  // Libellé sans progression : inférence impossible (« Mention bien »).
  check("règle sans progression", err(await rule("Mention bien", 13, 15, null, 15)) == null);

  // ---------- Délibérations annuelles ----------
  console.log("\n== Sessions annuelles ==");
  const sess6 = await prepareSession(ctxA, { scope: "ANNUAL", classroomId: c6.id });
  check("session 6e préparée", sess6.ok);
  const sessT = await prepareSession(ctxA, { scope: "ANNUAL", classroomId: cT.id });
  check("session Tle préparée", sessT.ok);
  const s6Id = sess6.ok ? sess6.result.id : "";

  const dAll = await prisma.deliberationDecision.findMany({ where: { sessionId: s6Id } });
  const byStudent = (sid: string) => dAll.find((d) => d.studentId === sid)!;
  check("s1 proposition PROMOTION", byStudent(e1.student.id).proposedProgression === "PROMOTION");
  check("s2 proposition REPETITION", byStudent(e2.student.id).proposedProgression === "REPETITION");
  check("s3 proposition REMEDIAL", byStudent(e3.student.id).proposedProgression === "REMEDIAL");
  check("s4 proposition DEFERRED", byStudent(e4.student.id).proposedProgression === "DEFERRED");
  check("s5 proposition ORIENTATION", byStudent(e5.student.id).proposedProgression === "ORIENTATION");
  check("s6 proposition sans progression (ambigu)", byStudent(e6.student.id).proposedProgression == null);
  check("s8 proposition EXIT", byStudent(e8.student.id).proposedProgression === "EXIT");

  // Ajustement de progression motivé : s2 libellé conservé, progression
  // explicitement changée → prouve que la décision structurée est
  // indépendante du libellé affiché.
  check(
    "progression ≠ proposition sans motif → REASON_REQUIRED",
    err(await adjustDecision(ctxA, {
      decisionId: byStudent(e2.student.id).id,
      customLabel: "Redouble",
      progression: "PROMOTION",
    })) === "REASON_REQUIRED",
  );
  check(
    "progression ajustée avec motif",
    err(await adjustDecision(ctxA, {
      decisionId: byStudent(e2.student.id).id,
      customLabel: "Redouble",
      progression: "PROMOTION",
      reason: "Cas social — redoublement assorti d'un passage conditionnel",
    })) == null,
  );
  check(
    "s2 ajustée : libellé « Redouble » mais progression PROMOTION",
    (await prisma.deliberationDecision.findUniqueOrThrow({
      where: { id: byStudent(e2.student.id).id },
    })).finalProgression === "PROMOTION",
  );

  check("validation 6e", err(await validateSession(ctxA, s6Id)) == null);
  check("validation Tle", err(await validateSession(ctxA, sessT.ok ? sessT.result.id : "")) == null);

  // Campagne G2 créée AVANT publication : la demande de s7 permet de
  // vérifier que la transition déverrouillage seule (sans dépublication)
  // lève aussi l'état de réconciliation.
  const camp = await createReenrollmentCampaign(ctxA, {
    name: "Réinscriptions 2027",
    sourceYearId: y0.id,
    targetYearId: y1.id,
    opensAt: new Date("2027-04-01"),
    closesAt: new Date("2027-09-30"),
  });
  check("campagne créée", camp.ok);
  const campId = camp.ok ? camp.result.id : "";
  const c5Id = c5y1.id;
  const reqS7 = await prisma.reenrollmentRequest.create({
    data: {
      schoolId: A.id, campaignId: campId, targetYearId: y1.id,
      studentId: e7.student.id, sourceEnrollmentId: e7.enrollment.id,
      kind: "REENROLL", status: "APPROVED",
      progression: "PROMOTION", targetClassroomId: c5Id,
      decidedAt: new Date(),
    },
  });
  const sessTId = sessT.ok ? sessT.result.id : "";
  check("déverrouillage Tle motivé", err(await unlockSession(ctxA, sessTId, "Revue conseil")) == null);
  check(
    "unlock seul → reconciliationNeeded levé (demande ouverte)",
    (await prisma.reenrollmentRequest.findUniqueOrThrow({ where: { id: reqS7.id } })).reconciliationNeeded === true,
  );
  check("revalidation Tle", err(await validateSession(ctxA, sessTId)) == null);
  check("publication 6e", err(await publishSession(ctxA, s6Id)) == null);
  check("publication Tle", err(await publishSession(ctxA, sessTId)) == null);

  console.log("\n== Synchronisation StudentAnnualResult ==");
  const prog = async (id: string) =>
    (await prisma.studentAnnualResult.findUniqueOrThrow({ where: { id } })).progression;
  check("s1 annual.progression = PROMOTION", (await prog(sar1.id)) === "PROMOTION");
  check("s2 annual.progression = PROMOTION (ajustée, libellé Redouble)", (await prog(sar2.id)) === "PROMOTION");
  check("s2 annual.decision = « Redouble » (libellé conservé)",
    (await prisma.studentAnnualResult.findUniqueOrThrow({ where: { id: sar2.id } })).decision === "Redouble");
  check("s3 annual.progression = REMEDIAL", (await prog(sar3.id)) === "REMEDIAL");
  check("s4 annual.progression = DEFERRED", (await prog(sar4.id)) === "DEFERRED");
  check("s5 annual.progression = ORIENTATION", (await prog(sar5.id)) === "ORIENTATION");
  check("s6 annual.progression = null (ambigu)", (await prog(sar6.id)) == null);
  check("s7 annual.progression = PROMOTION", (await prog(sar7.id)) === "PROMOTION");
  check("s8 annual.progression = EXIT", (await prog(sar8.id)) === "EXIT");
  check("statut annuel inchangé (PUBLISHED, gate G2)",
    (await prisma.studentAnnualResult.findUniqueOrThrow({ where: { id: sar1.id } })).status === "PUBLISHED");

  // ---------- Campagne G2 + suggestions ----------
  console.log("\n== Campagne G2 + suggestions structurées ==");

  const eligible = await listEligibleStudents(ctxA, campId);
  check("éligibles listés", eligible.ok && eligible.result.length === 8);
  const row = (sid: string) =>
    eligible.ok ? eligible.result.find((r) => r.studentId === sid)! : null;

  check("s1 : PROMOTION → 5e", row(e1.student.id)?.suggestion.progression === "PROMOTION"
    && row(e1.student.id)?.suggestion.targetLevelId === l5.id);
  check("s2 : PROMOTION structurée prime sur libellé « Redouble »",
    row(e2.student.id)?.suggestion.progression === "PROMOTION"
    && row(e2.student.id)?.suggestion.targetLevelId === l5.id);
  check("s2 : progression annuelle exposée", row(e2.student.id)?.annualProgression === "PROMOTION");
  check("s3 : REMEDIAL → cas particulier", row(e3.student.id)?.suggestion.manualCase === true
    && row(e3.student.id)?.blockers.includes("cas_particulier") === true);
  check("s4 : DEFERRED → pas de niveau cible", row(e4.student.id)?.suggestion.targetLevelId == null
    && row(e4.student.id)?.suggestion.manualCase === true);
  check("s5 : ORIENTATION sans surcharge → niveau cible nul",
    row(e5.student.id)?.suggestion.targetLevelId == null
    && row(e5.student.id)?.suggestion.manualCase === true);
  check("s6 : décision ambiguë → pas de progression structurée",
    row(e6.student.id)?.annualProgression == null);
  check("s6 : repli ordre des niveaux (suggestion seule)",
    row(e6.student.id)?.suggestion.targetLevelId === l5.id);
  check("s7 : niveau terminal → terminal + cas particulier",
    row(e7.student.id)?.suggestion.terminal === true
    && row(e7.student.id)?.suggestion.targetLevelId == null);
  check("s8 : EXIT → cas particulier, pas de niveau", row(e8.student.id)?.suggestion.progression === "EXIT"
    && row(e8.student.id)?.suggestion.targetLevelId == null);

  // Surcharge de campagne : ORIENTATION prend le niveau surchargé.
  check(
    "surcharge ORIENTATION ajoutée",
    err(await updateReenrollmentCampaign(ctxA, campId, {
      progressionOverrides: { [l6.id]: l5.id },
    })) == null,
  );
  const eligible2 = await listEligibleStudents(ctxA, campId);
  const row2 = (sid: string) =>
    eligible2.ok ? eligible2.result.find((r) => r.studentId === sid)! : null;
  check("s5 : ORIENTATION → niveau surchargé 5e", row2(e5.student.id)?.suggestion.targetLevelId === l5.id);
  check("s3 : REMEDIAL → niveau surchargé 5e", row2(e3.student.id)?.suggestion.targetLevelId === l5.id);
  check("s8 : EXIT ignoré des surcharges", row2(e8.student.id)?.suggestion.targetLevelId == null);

  // ---------- Décisions historiques en texte libre & terminaux ----------
  console.log("\n== Décisions libres historiques & niveaux terminaux ==");
  // Élèves inscrits après la délibération : libellés libres sans
  // progression structurée (héritage pré-H6) — compatibilité exigée.
  const sarFree = (studentId: string, avg: number, decision: string | null, status: "PUBLISHED" | "CALCULATED" = "PUBLISHED") =>
    prisma.studentAnnualResult.create({
      data: {
        schoolId: A.id, academicYearId: y0.id, studentId,
        annualAverage: avg, decision, status,
      },
    });
  const e9 = await mkStudent("H6A-09", "Rokia", c6.id, y0.id);
  const e10 = await mkStudent("H6A-10", "Ali", c6.id, y0.id);
  const e11 = await mkStudent("H6A-11", "Mia", c6.id, y0.id);
  const e12 = await mkStudent("H6A-12", "Tom", c6.id, y0.id);
  const e13 = await mkStudent("H6A-13", "Eve", c6.id, y0.id);
  const e15 = await mkStudent("H6A-15", "Ibo", cT.id, y0.id);
  const e16 = await mkStudent("H6A-16", "Ana", cT.id, y0.id);
  const sar9 = await sarFree(e9.student.id, 8, "Redouble");
  await sarFree(e10.student.id, 14, "Admis en classe supérieure");
  await sarFree(e11.student.id, 15, "Tableau d'honneur");
  await sarFree(e12.student.id, 7, "Ajourné aux examens");
  await sarFree(e13.student.id, 15, "Admis", "CALCULATED"); // non publié → gate
  await sarFree(e15.student.id, 7, "Redouble");
  await sarFree(e16.student.id, 9, "Transfert externe");

  const eligLeg = await listEligibleStudents(ctxA, campId);
  check("éligibles étendus (8 + 7 historiques)", eligLeg.ok && eligLeg.result.length === 15);
  const rowL = (sid: string) =>
    eligLeg.ok ? eligLeg.result.find((r) => r.studentId === sid)! : null;

  check("legacy « Redouble » → REPETITION inférée → même niveau",
    rowL(e9.student.id)?.suggestion.progression === "REPETITION"
    && rowL(e9.student.id)?.suggestion.targetLevelId === l6.id);
  check("legacy « Admis en classe supérieure » → PROMOTION → 5e",
    rowL(e10.student.id)?.suggestion.progression === "PROMOTION"
    && rowL(e10.student.id)?.suggestion.targetLevelId === l5.id);
  check("legacy ambigu « Tableau d'honneur » → pas de progression structurée",
    rowL(e11.student.id)?.annualProgression == null);
  check("legacy ambigu → repli ordre des niveaux (suggestion seule)",
    rowL(e11.student.id)?.suggestion.targetLevelId === l5.id);
  check("legacy ambigu « Ajourné » → pas d'inférence forcée",
    rowL(e12.student.id)?.annualProgression == null
    && rowL(e12.student.id)?.suggestion.progression === "PROMOTION"); // suggestion LEVEL_ORDER
  check("décision non publiée (CALCULATED) → gate ignorée",
    rowL(e13.student.id)?.annualDecision == null
    && rowL(e13.student.id)?.suggestion.progression === "PROMOTION");
  check("terminal + REPETITION → même niveau, pas de flag terminal",
    rowL(e15.student.id)?.suggestion.progression === "REPETITION"
    && rowL(e15.student.id)?.suggestion.targetLevelId === lT.id
    && rowL(e15.student.id)?.suggestion.terminal !== true);
  check("terminal + décision ambiguë → aucune cible",
    rowL(e16.student.id)?.suggestion.targetLevelId == null);

  // ---------- Réconciliation H5 → G2 ----------
  console.log("\n== Réconciliation H5 → G2 ==");
  // Demande décidée (ouverte) + demande finalisée (préservée).
  const reqOpen = await prisma.reenrollmentRequest.create({
    data: {
      schoolId: A.id, campaignId: campId, targetYearId: y1.id,
      studentId: e1.student.id, sourceEnrollmentId: e1.enrollment.id,
      kind: "REENROLL", status: "APPROVED",
      progression: "PROMOTION", targetClassroomId: c5y1.id,
      decidedAt: new Date(),
    },
  });
  // Demande finalisée avec inscription réelle sur l'année cible :
  // décision administrative à préserver, même en cas de conflit
  // d'affichage (ORIENTATION ≠ REMEDIAL publié).
  const enY1 = await prisma.enrollment.create({
    data: {
      schoolId: A.id, studentId: e3.student.id,
      classroomId: c5y1.id, academicYearId: y1.id, status: "ENROLLED",
    },
  });
  const reqDone = await prisma.reenrollmentRequest.create({
    data: {
      schoolId: A.id, campaignId: campId, targetYearId: y1.id,
      studentId: e3.student.id,
      kind: "REENROLL", status: "COMPLETED",
      progression: "ORIENTATION", decidedAt: new Date(),
      completedAt: new Date(), newEnrollmentId: enY1.id,
    },
  });
  const reqS4 = await prisma.reenrollmentRequest.create({
    data: {
      schoolId: A.id, campaignId: campId, targetYearId: y1.id,
      studentId: e4.student.id,
      kind: "REENROLL", status: "UNDER_REVIEW",
    },
  });
  check(
    "double demande même année cible → unicité",
    await prisma.reenrollmentRequest
      .create({
        data: {
          schoolId: A.id, campaignId: campId, targetYearId: y1.id,
          studentId: e1.student.id, kind: "REENROLL", status: "SUBMITTED",
        },
      })
      .then(() => false)
      .catch((e) => e.code === "P2002"),
  );

  // Progression administrative posée manuellement (hors H5) sur s5 :
  // la dépublication ne doit pas l'effacer silencieusement.
  await prisma.studentAnnualResult.update({
    where: { id: sar5.id }, data: { progression: "REPETITION" },
  });

  // Dépublication H5 → drapeau de réconciliation sur les demandes ouvertes.
  check("dépublication 6e motivée", err(await depublishSession(ctxA, s6Id, "Correction conseil")) == null);
  const flagged = await prisma.reenrollmentRequest.findUniqueOrThrow({ where: { id: reqOpen.id } });
  check("demande ouverte → reconciliationNeeded", flagged.reconciliationNeeded === true);
  check("demande finalisée préservée (pas de drapeau)",
    (await prisma.reenrollmentRequest.findUniqueOrThrow({ where: { id: reqDone.id } })).reconciliationNeeded === false);
  check("demande non décidée aussi marquée",
    (await prisma.reenrollmentRequest.findUniqueOrThrow({ where: { id: reqS4.id } })).reconciliationNeeded === true);
  check("progression annuelle retirée (s1)", (await prog(sar1.id)) == null);
  check("libellé annuel retiré (s1)",
    (await prisma.studentAnnualResult.findUniqueOrThrow({ where: { id: sar1.id } })).decision == null);
  check("progression administrative manuelle préservée (s5 = REPETITION)",
    (await prog(sar5.id)) === "REPETITION");
  check("libellé s5 retiré mais progression admin conservée",
    (await prisma.studentAnnualResult.findUniqueOrThrow({ where: { id: sar5.id } })).decision == null);

  const eligDepub = await listEligibleStudents(ctxA, campId);
  const rowD = (sid: string) =>
    eligDepub.ok ? eligDepub.result.find((r) => r.studentId === sid)! : null;
  check("conflit RETRACTED affiché (s1)", rowD(e1.student.id)?.conflict === "RETRACTED"
    && rowD(e1.student.id)?.blockers.includes("conflit_h5") === true);
  check("demande finalisée : aucun drapeau ni conflit à ce stade (s3)",
    rowD(e3.student.id)?.conflict == null);

  // Dépublication d'un conseil de PÉRIODE : aucun effet sur G2.
  const p1 = await prisma.academicPeriod.create({
    data: {
      schoolId: A.id, academicYearId: y0.id, name: "T1", number: 1,
      startDate: new Date("2026-09-01"), endDate: new Date("2026-12-31"),
      type: "TRIMESTER",
    },
  });
  await prisma.studentPeriodResult.createMany({
    data: [
      { schoolId: A.id, academicPeriodId: p1.id, classroomId: c6.id, studentId: e1.student.id, generalAverage: 16, rank: 1, isComplete: true, status: "CALCULATED" },
      { schoolId: A.id, academicPeriodId: p1.id, classroomId: c6.id, studentId: e5.student.id, generalAverage: 9.5, rank: 5, isComplete: true, status: "CALCULATED" },
    ],
  });
  const reqS5 = await prisma.reenrollmentRequest.create({
    data: {
      schoolId: A.id, campaignId: campId, targetYearId: y1.id,
      studentId: e5.student.id, sourceEnrollmentId: e5.enrollment.id,
      kind: "REENROLL", status: "UNDER_REVIEW",
    },
  });
  const sessP = await prepareSession(ctxA, { scope: "PERIOD", classroomId: c6.id, academicPeriodId: p1.id });
  check("session de période préparée", sessP.ok);
  const sessPId = sessP.ok ? sessP.result.id : "";
  await upsertRule(ctxA, { scope: "PERIOD", label: "Conseil T1", minAverage: 10, maxAverage: 21, order: 10 });
  await prisma.deliberationDecision.updateMany({
    where: { sessionId: sessPId, finalLabel: null },
    data: { finalLabel: "Vu" },
  });
  check("validation période", err(await validateSession(ctxA, sessPId)) == null);
  check("publication période", err(await publishSession(ctxA, sessPId)) == null);
  check("dépublication période",
    err(await depublishSession(ctxA, sessPId, "Correction T1")) == null);
  check("dépublication PERIOD → aucun drapeau G2",
    (await prisma.reenrollmentRequest.findUniqueOrThrow({ where: { id: reqS5.id } })).reconciliationNeeded === false);

  // Correction : déverrouillage → ajustement → revalidation → republication.
  check("déverrouillage motivé", err(await unlockSession(ctxA, s6Id, "Revue des cas particuliers")) == null);
  check(
    "correction : s2 repasse REPETITION",
    err(await adjustDecision(ctxA, {
      decisionId: byStudent(e2.student.id).id,
      ruleId: (await prisma.deliberationRule.findFirstOrThrow({
        where: { schoolId: A.id, scope: "ANNUAL", label: "Redouble" },
      })).id,
      reason: "Passage conditionnel annulé après réunion",
    })) == null,
  );
  check("revalidation 6e", err(await validateSession(ctxA, s6Id)) == null);

  // Conflits à la republication : progression administrative (s5) et
  // libellé manuel (s4) doivent chacun bloquer l'écrasement silencieux.
  check(
    "republication → DECISION_CONFLICT (progression admin s5)",
    err(await publishSession(ctxA, s6Id)) === "DECISION_CONFLICT",
  );
  await prisma.studentAnnualResult.update({
    where: { id: sar4.id }, data: { decision: "Décision direction" },
  });
  check(
    "republication → DECISION_CONFLICT (libellé manuel s4 aussi)",
    err(await publishSession(ctxA, s6Id)) === "DECISION_CONFLICT",
  );
  await prisma.studentAnnualResult.updateMany({
    where: { id: { in: [sar4.id, sar5.id] } },
    data: { decision: null, progression: null },
  });
  check("republication 6e après levée des conflits",
    err(await publishSession(ctxA, s6Id)) == null);
  check("s2 annual.progression corrigée = REPETITION", (await prog(sar2.id)) === "REPETITION");
  check("s1 annual.progression resynchronisée = PROMOTION", (await prog(sar1.id)) === "PROMOTION");
  check("décision hors session préservée (s9 « Redouble »)",
    (await prisma.studentAnnualResult.findUniqueOrThrow({ where: { id: sar9.id } })).decision === "Redouble");

  // Demande décidée PROMOTION entre-temps → conflit MODIFIED.
  await prisma.reenrollmentRequest.create({
    data: {
      schoolId: A.id, campaignId: campId, targetYearId: y1.id,
      studentId: e2.student.id, sourceEnrollmentId: e2.enrollment.id,
      kind: "REENROLL", status: "APPROVED",
      progression: "PROMOTION", targetClassroomId: c5y1.id,
      decidedAt: new Date(), reconciliationNeeded: false,
    },
  });
  const eligMod = await listEligibleStudents(ctxA, campId);
  const rowM = (sid: string) =>
    eligMod.ok ? eligMod.result.find((r) => r.studentId === sid)! : null;
  check("conflit MODIFIED (s2 : demande PROMOTION vs REPETITION publiée)",
    rowM(e2.student.id)?.conflict === "MODIFIED");
  check("conflit toujours RETRACTED pour s1 (drapeau non soldé)",
    rowM(e1.student.id)?.conflict === "RETRACTED");
  check("conflit MODIFIED sur demande COMPLETED (s3, informatif)",
    rowM(e3.student.id)?.conflict === "MODIFIED");
  check("demande finalisée : progression et statut préservés",
    (await prisma.reenrollmentRequest.findUniqueOrThrow({ where: { id: reqDone.id } })).progression === "ORIENTATION"
    && (await prisma.reenrollmentRequest.findUniqueOrThrow({ where: { id: reqDone.id } })).status === "COMPLETED");
  check("inscription finalisée intacte après correction H5",
    (await prisma.enrollment.findUniqueOrThrow({ where: { id: enY1.id } })).status === "ENROLLED"
    && (await prisma.enrollment.count({ where: { schoolId: A.id, academicYearId: y1.id } })) === 1);

  // Re-décision de la demande s7 (flaggée au déverrouillage Tle) avec
  // une nouvelle valeur de progression → drapeau soldé.
  await prisma.reenrollmentRequest.update({
    where: { id: reqS7.id }, data: { status: "UNDER_REVIEW" },
  });
  check(
    "re-décision s7 avec ORIENTATION explicite",
    err(await decideReenrollmentRequest(ctxA, reqS7.id, {
      decision: "APPROVED", targetClassroomId: c5y1.id, progression: "ORIENTATION",
    })) == null,
  );
  check("s7 : drapeau soldé + progression ORIENTATION enregistrée",
    (await prisma.reenrollmentRequest.findUniqueOrThrow({ where: { id: reqS7.id } })).reconciliationNeeded === false
    && (await prisma.reenrollmentRequest.findUniqueOrThrow({ where: { id: reqS7.id } })).progression === "ORIENTATION");

  // Re-décision → drapeau soldé.
  await prisma.reenrollmentRequest.update({
    where: { id: reqOpen.id }, data: { status: "UNDER_REVIEW" },
  });
  check(
    "re-décision de la demande s1",
    err(await decideReenrollmentRequest(ctxA, reqOpen.id, {
      decision: "APPROVED", targetClassroomId: c5y1.id,
    })) == null,
  );
  check("drapeau soldé après re-décision",
    (await prisma.reenrollmentRequest.findUniqueOrThrow({ where: { id: reqOpen.id } })).reconciliationNeeded === false);
  const eligFinal = await listEligibleStudents(ctxA, campId);
  const rowF = (sid: string) =>
    eligFinal.ok ? eligFinal.result.find((r) => r.studentId === sid)! : null;
  check("conflit s1 résolu après re-décision", rowF(e1.student.id)?.conflict == null);
  check("s7 : divergence affichée (ORIENTATION décidée ≠ PROMOTION publiée)",
    rowF(e7.student.id)?.conflict === "MODIFIED");
  check("aucune inscription automatique : y1 = la seule finalisée (fixture)",
    (await prisma.enrollment.count({ where: { schoolId: A.id, academicYearId: y1.id } })) === 1);
  check("aucune inscription source modifiée (y0 = 15 ENROLLED)",
    (await prisma.enrollment.count({
      where: { schoolId: A.id, academicYearId: y0.id, status: "ENROLLED" },
    })) === 15);

  // ---------- Permissions & isolation ----------
  console.log("\n== Permissions & isolation ==");
  const eligN = await listEligibleStudents(ctxN, campId);
  check("noperm → éligibles FORBIDDEN", eligN.ok === false && eligN.error === "FORBIDDEN");
  check("reader → éligibles OK", (await listEligibleStudents(ctxR, campId))?.ok === true);
  check("noperm → campagnes vides/visibles selon perm",
    (await listReenrollmentCampaigns(ctxN)).length === 0);

  const campsB = await listReenrollmentCampaigns({ userId: admin.id, schoolId: B.id });
  check("école B ne voit pas la campagne A",
    !campsB.some((c: { id: string }) => c.id === campId));
  const eligB = await listEligibleStudents({ userId: admin.id, schoolId: B.id }, campId);
  check("campagne A invisible depuis B", eligB.ok === false || eligB.result.length === 0);
  check("demande A invisible depuis B",
    (await prisma.reenrollmentRequest.findFirst({
      where: { id: reqOpen.id, schoolId: B.id },
    })) == null);

  // ---------- Audit ----------
  console.log("\n== Audit ==");
  const audits = await prisma.auditLog.findMany({
    where: { schoolId: A.id, action: { startsWith: "deliberation." } },
    select: { action: true },
  });
  check("audit deliberation.publish présent", audits.some((a) => a.action === "deliberation.publish"));
  check("audit deliberation.depublish présent", audits.some((a) => a.action === "deliberation.depublish"));
  check("audit deliberation.unlock présent", audits.some((a) => a.action === "deliberation.unlock"));

  // ---------- Intégrité ----------
  console.log("\n== Intégrité ==");
  check("moyenne annuelle s1 jamais modifiée",
    (await prisma.studentAnnualResult.findUniqueOrThrow({ where: { id: sar1.id } })).annualAverage === 16);
  check("statut annuel jamais modifié par H5/H6",
    (await prisma.studentAnnualResult.findUniqueOrThrow({ where: { id: sar2.id } })).status === "PUBLISHED");

  console.log(`\n=== H6 recette : ${pass} PASS, ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error("ERREUR RECETTE", e);
  await prisma.$disconnect();
  process.exit(1);
});
