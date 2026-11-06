/**
 * Recette H5 — délibérations scolaires :
 * règles configurables, propositions calculées vs décisions du
 * conseil, ajustement motivé, validation/verrouillage, publication
 * et dépublication contrôlées, déverrouillage motivé, concurrence,
 * permissions, isolation inter-écoles, audit — sans jamais toucher
 * aux moyennes d'origine.
 *
 * Usage : npx tsx scripts/h5/deliberations-recette.ts
 */
import "dotenv/config";
import { prisma } from "../../src/lib/db/prisma";
import {
  adjustDecision,
  archiveRule,
  depublishSession,
  getSession,
  listRules,
  listSessions,
  prepareSession,
  publishSession,
  reprepareSession,
  unlockSession,
  upsertRule,
  validateSession,
} from "../../src/lib/services/deliberations";

let pass = 0, fail = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};
const err = <T,>(r: { ok: true; result: T } | { ok: false; error: string }) =>
  (r.ok ? null : r.error);

const SLUG = "h5-fix";
const SLUG2 = "h5-fix-bis";
const EMAILS = [
  "h5-read@test.local",
  "h5-manage@test.local",
  "h5-valid@test.local",
  "h5-pub@test.local",
  "h5-noperm@test.local",
  "h5-b@test.local",
];

async function makeUser(email: string) {
  return prisma.user.create({
    data: { email, passwordHash: "x", firstName: "H5", lastName: email, status: "ACTIVE" },
  });
}

async function makeMember(userId: string, schoolId: string, permKeys: string[]) {
  const role = await prisma.role.create({
    data: { name: `H5_${userId.slice(-4)}_${schoolId.slice(-4)}`, scope: "SCHOOL", schoolId },
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
  const period2 = await prisma.academicPeriod.create({
    data: {
      schoolId: school.id, academicYearId: year.id, name: "T2", number: 2,
      startDate: new Date("2027-01-01"), endDate: new Date("2027-03-31"),
      type: "TRIMESTER",
    },
  });
  const level = await prisma.level.create({ data: { schoolId: school.id, name: "6e", order: 1 } });
  const classroom = await prisma.classroom.create({
    data: { schoolId: school.id, academicYearId: year.id, levelId: level.id, name: "6e A" },
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
  return { school, year, period, period2, level, classroom, mkStudent };
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

  const A = await makeSchool("H5 Ecole A", SLUG, "H5A");
  const B = await makeSchool("H5 Ecole B", SLUG2, "H5B");

  const s1 = await A.mkStudent("H5A-001", "Awa");   // 16 complet → règle ordre 10
  const s2 = await A.mkStudent("H5A-002", "Karim"); // 8 complet → catch-all
  const s3 = await A.mkStudent("H5A-003", "Léa");   // 12 incomplet → règle requiresComplete ignorée
  const s4 = await A.mkStudent("H5A-004", "Noa");   // pas de résultat → sans proposition
  const sb1 = await B.mkStudent("H5B-001", "Zoe");

  // Résultats de période persistés (statuts calculés)
  const spr = (studentId: string, avg: number | null, rank: number | null, complete: boolean) =>
    prisma.studentPeriodResult.create({
      data: {
        schoolId: A.school.id, academicPeriodId: A.period.id,
        classroomId: A.classroom.id, studentId,
        generalAverage: avg, rank, mention: "Bien",
        isComplete: complete, status: "CALCULATED",
      },
    });
  const spr1 = await spr(s1.id, 16, 1, true);
  const spr2 = await spr(s2.id, 8, 3, true);
  const spr3 = await spr(s3.id, 12, 2, false);
  await prisma.studentPeriodResult.createMany({
    data: [
      { schoolId: A.school.id, academicPeriodId: A.period2.id, classroomId: A.classroom.id, studentId: s1.id, generalAverage: 15, rank: 1, isComplete: true, status: "CALCULATED" },
      { schoolId: A.school.id, academicPeriodId: A.period2.id, classroomId: A.classroom.id, studentId: s2.id, generalAverage: 9, rank: 3, isComplete: true, status: "CALCULATED" },
      { schoolId: A.school.id, academicPeriodId: A.period2.id, classroomId: A.classroom.id, studentId: s3.id, generalAverage: 13, rank: 2, isComplete: true, status: "CALCULATED" },
      { schoolId: A.school.id, academicPeriodId: A.period2.id, classroomId: A.classroom.id, studentId: s4.id, generalAverage: 10, rank: 4, isComplete: true, status: "CALCULATED" },
    ],
  });
  // Résultats annuels
  const sar = (studentId: string, avg: number | null, rank: number | null) =>
    prisma.studentAnnualResult.create({
      data: {
        schoolId: A.school.id, academicYearId: A.year.id, studentId,
        annualAverage: avg, rank, status: "CALCULATED",
      },
    });
  const sar1 = await sar(s1.id, 15.5, 1);
  const sar2 = await sar(s2.id, 7.8, 3);
  await sar(s3.id, 12.2, 2);
  // École B : un résultat pour préparer sa propre session
  await prisma.studentPeriodResult.create({
    data: {
      schoolId: B.school.id, academicPeriodId: B.period.id,
      classroomId: B.classroom.id, studentId: sb1.id,
      generalAverage: 14, rank: 1, isComplete: true, status: "CALCULATED",
    },
  });

  // Utilisateurs
  const uRead = await makeUser("h5-read@test.local");
  const uManage = await makeUser("h5-manage@test.local");
  const uValid = await makeUser("h5-valid@test.local");
  const uPub = await makeUser("h5-pub@test.local");
  const uNoPerm = await makeUser("h5-noperm@test.local");
  const uB = await makeUser("h5-b@test.local");

  await makeMember(uRead.id, A.school.id, ["deliberations.read"]);
  await makeMember(uManage.id, A.school.id, ["deliberations.read", "deliberations.manage"]);
  await makeMember(uValid.id, A.school.id, ["deliberations.read", "deliberations.validate"]);
  await makeMember(uPub.id, A.school.id, ["deliberations.read", "deliberations.publish"]);
  await makeMember(uNoPerm.id, A.school.id, ["student.read"]);
  await makeMember(uB.id, B.school.id, ["deliberations.read", "deliberations.manage", "deliberations.validate", "deliberations.publish"]);

  const cRead = { userId: uRead.id, schoolId: A.school.id };
  const cMan = { userId: uManage.id, schoolId: A.school.id };
  const cVal = { userId: uValid.id, schoolId: A.school.id };
  const cPub = { userId: uPub.id, schoolId: A.school.id };
  const cNoPerm = { userId: uNoPerm.id, schoolId: A.school.id };
  const cB = { userId: uB.id, schoolId: B.school.id };

  // ---------- Règles ----------
  console.log("\n== Règles de décision ==");
  check("upsert refusé sans permission", !(await upsertRule(cNoPerm, { scope: "PERIOD", label: "X" })).ok);
  check("upsert refusé en lecture seule", !(await upsertRule(cRead, { scope: "PERIOD", label: "X" })).ok);
  check("borne min>max refusée", err(await upsertRule(cMan, { scope: "PERIOD", label: "X", minAverage: 12, maxAverage: 10 })) === "INVALID_INPUT");
  check("année d'une autre école refusée", err(await upsertRule(cMan, { scope: "PERIOD", label: "X", academicYearId: B.year.id })) === "NOT_FOUND");

  const rFel = (await upsertRule(cMan, { scope: "PERIOD", label: "Félicitations du conseil", minAverage: 16, order: 10 })) as { ok: true; result: { id: string } };
  await upsertRule(cMan, { scope: "PERIOD", label: "Admis", minAverage: 10, requiresComplete: true, order: 20 });
  await upsertRule(cMan, { scope: "PERIOD", label: "Rattrapage", minAverage: 10, order: 25 });
  const rAj = (await upsertRule(cMan, { scope: "PERIOD", label: "Ajournement", order: 30 })) as { ok: true; result: { id: string } };
  await upsertRule(cMan, { scope: "ANNUAL", label: "Passe en classe supérieure", minAverage: 10, progression: "PROMOTION", order: 10 });
  await upsertRule(cMan, { scope: "ANNUAL", label: "Redouble", progression: "REPETITION", order: 20 });
  // Règle à archiver : ne doit plus faire de propositions
  const rOld = (await upsertRule(cMan, { scope: "PERIOD", label: "Mention spéciale (archivée)", order: 5 })) as { ok: true; result: { id: string } };
  check("archivage règle", (await archiveRule(cMan, rOld.result.id)).ok);
  check("règles actives listées", (await listRules(cMan)).filter((r) => r.status === "ACTIVE").length === 6);

  // ---------- Préparation ----------
  console.log("\n== Préparation ==");
  check("préparation refusée sans permission", !(await prepareSession(cNoPerm, { scope: "PERIOD", classroomId: A.classroom.id, academicPeriodId: A.period.id })).ok);
  check("préparation refusée en lecture seule", !(await prepareSession(cRead, { scope: "PERIOD", classroomId: A.classroom.id, academicPeriodId: A.period.id })).ok);
  check("période requise pour un conseil", err(await prepareSession(cMan, { scope: "PERIOD", classroomId: A.classroom.id })) === "INVALID_INPUT");
  check("période refusée pour l'annuel", err(await prepareSession(cMan, { scope: "ANNUAL", classroomId: A.classroom.id, academicPeriodId: A.period.id })) === "INVALID_INPUT");
  check("période d'une autre école refusée", err(await prepareSession(cMan, { scope: "PERIOD", classroomId: A.classroom.id, academicPeriodId: B.period.id })) === "NOT_FOUND");
  check("classe de B sans résultats T2 → NO_RESULTS", err(await prepareSession(cB, { scope: "PERIOD", classroomId: B.classroom.id, academicPeriodId: B.period2.id })) === "NO_RESULTS");

  const prep = await prepareSession(cMan, { scope: "PERIOD", classroomId: A.classroom.id, academicPeriodId: A.period.id, note: "Conseil T1" });
  check("session créée", prep.ok);
  if (!prep.ok) throw new Error("préparation échouée");
  const sid = prep.result.id;
  check("numéro PV attribué", /^PV-\d{4}-\d{5}$/.test(prep.result.number));
  check("4 élèves chargés", prep.result.students === 4);
  check("doublon classe×période refusé", err(await prepareSession(cMan, { scope: "PERIOD", classroomId: A.classroom.id, academicPeriodId: A.period.id })) === "ALREADY_EXISTS");

  const det0 = await getSession(cMan, sid);
  const dOf = (sid2: string) => det0!.decisions.find((d) => d.studentId === sid2)!;
  check("proposition s1 (16) = Félicitations", dOf(s1.id).proposedLabel === "Félicitations du conseil");
  check("proposition s2 (8) = Ajournement", dOf(s2.id).proposedLabel === "Ajournement");
  check("s3 incomplet → règle « Admis » ignorée, Rattrapage", dOf(s3.id).proposedLabel === "Rattrapage");
  check("s4 sans résultat → aucune proposition", dOf(s4.id).proposedLabel == null && dOf(s4.id).averageSnapshot == null);
  check("snapshot moyenne s1 figé à 16", dOf(s1.id).averageSnapshot === 16);
  check("règle archivée sans effet", !det0!.decisions.some((d) => d.proposedLabel === "Mention spéciale (archivée)"));

  // ---------- Ajustement motivé ----------
  console.log("\n== Ajustement ==");
  check("ajustement refusé en lecture seule", !(await adjustDecision(cRead, { decisionId: dOf(s1.id).id, ruleId: rAj.result.id, reason: "x" })).ok);
  check("écart sans motif → REASON_REQUIRED", err(await adjustDecision(cMan, { decisionId: dOf(s1.id).id, ruleId: rAj.result.id })) === "REASON_REQUIRED");
  check("règle d'un autre conseil refusée", err(await adjustDecision(cMan, { decisionId: dOf(s1.id).id, ruleId: "inexistant", reason: "x" })) === "NOT_FOUND");

  const adj1 = await adjustDecision(cMan, { decisionId: dOf(s1.id).id, ruleId: rAj.result.id, reason: "Comportement sanctionné par le conseil" });
  check("ajustement motivé enregistré", adj1.ok);
  let det = await getSession(cMan, sid);
  let d1 = det!.decisions.find((d) => d.studentId === s1.id)!;
  check("s1 ADJUSTED avec motif", d1.status === "ADJUSTED" && d1.adjustmentReason === "Comportement sanctionné par le conseil" && d1.finalLabel === "Ajournement");

  // Ajustement identique à la proposition : pas de motif exigé
  const d2 = det!.decisions.find((d) => d.studentId === s2.id)!;
  const adj2 = await adjustDecision(cMan, { decisionId: d2.id, ruleId: rAj.result.id });
  check("décision = proposition sans motif", adj2.ok);
  det = await getSession(cMan, sid);
  check("s2 reste PROPOSED", det!.decisions.find((d) => d.studentId === s2.id)!.status === "PROPOSED");

  // Validation impossible tant qu'un élève n'a pas de décision
  check("validation refusée sans permission validate", !(await validateSession(cMan, sid)).ok);
  check("validation → MISSING_DECISIONS (s4)", err(await validateSession(cVal, sid)) === "MISSING_DECISIONS");

  // s4 : décision libre motivée (pas de proposition)
  const d4 = det!.decisions.find((d) => d.studentId === s4.id)!;
  check("s4 : décision libre sans motif refusée", err(await adjustDecision(cMan, { decisionId: d4.id, customLabel: "Redoublement exceptionnel" })) === "REASON_REQUIRED");
  check("s4 : décision libre motivée", (await adjustDecision(cMan, { decisionId: d4.id, customLabel: "Redoublement exceptionnel", reason: "Arrivé en cours d'année" })).ok);

  // ---------- Recalcul des propositions ----------
  console.log("\n== Recalcul ==");
  await prisma.studentPeriodResult.update({
    where: { id: spr2.id },
    data: { generalAverage: 11 },
  });
  check("stale détecté avant recalcul", (await getSession(cMan, sid))!.staleDecisionIds.size === 1);
  check("reprepare refusé en lecture seule", !(await reprepareSession(cRead, sid)).ok);
  check("reprepare OPEN", (await reprepareSession(cMan, sid)).ok);
  det = await getSession(cMan, sid);
  const d2b = det!.decisions.find((d) => d.studentId === s2.id)!;
  check("s2 proposition rafraîchie (11 → Admis)", d2b.proposedLabel === "Admis" && d2b.finalLabel === "Admis" && d2b.averageSnapshot === 11);
  d1 = det!.decisions.find((d) => d.studentId === s1.id)!;
  check("ajustement s1 préservé au recalcul", d1.status === "ADJUSTED" && d1.finalLabel === "Ajournement");
  check("moyenne d'origine s2 bien modifiée (11) non réécrite", (await prisma.studentPeriodResult.findUniqueOrThrow({ where: { id: spr2.id } })).generalAverage === 11);

  // ---------- Validation / verrouillage ----------
  console.log("\n== Validation ==");
  check("validation par habilité", (await validateSession(cVal, sid)).ok);
  check("session VALIDATED", (await getSession(cMan, sid))!.status === "VALIDATED");
  check("décisions verrouillées VALIDATED", (await getSession(cMan, sid))!.decisions.every((d) => d.status === "VALIDATED"));
  check("ajustement verrouillé", err(await adjustDecision(cMan, { decisionId: d1.id, ruleId: rFel.result.id, reason: "x" })) === "INVALID_STATUS");
  check("double validation refusée", err(await validateSession(cVal, sid)) === "INVALID_STATUS");
  check("recalcul interdit une fois validé", err(await reprepareSession(cMan, sid)) === "INVALID_STATUS");

  // ---------- Déverrouillage motivé ----------
  console.log("\n== Déverrouillage ==");
  check("déverrouillage sans motif → REASON_REQUIRED", err(await unlockSession(cVal, sid, "  ")) === "REASON_REQUIRED");
  check("déverrouillage refusé sans permission validate", !(await unlockSession(cMan, sid, "motif")).ok);
  check("déverrouillage motivé", (await unlockSession(cVal, sid, "Erreur de transcription signalée par le professeur principal")).ok);
  det = await getSession(cMan, sid);
  check("session rouverte OPEN", det!.status === "OPEN");
  check("s1 redevenue ADJUSTED", det!.decisions.find((d) => d.studentId === s1.id)!.status === "ADJUSTED");
  check("revalidation", (await validateSession(cVal, sid)).ok);

  // ---------- Publication ----------
  console.log("\n== Publication ==");
  check("publication refusée sans permission publish", !(await publishSession(cVal, sid)).ok);
  check("publication refusée par manage", !(await publishSession(cMan, sid)).ok);
  check("publication par habilité", (await publishSession(cPub, sid)).ok);
  check("session PUBLISHED", (await getSession(cMan, sid))!.status === "PUBLISHED");
  const sprAfter = async (id: string) =>
    (await prisma.studentPeriodResult.findUniqueOrThrow({ where: { id } })).councilDecision;
  check("councilDecision s1 = Ajournement (ajusté)", (await sprAfter(spr1.id)) === "Ajournement");
  check("councilDecision s2 = Admis", (await sprAfter(spr2.id)) === "Admis");
  check("councilDecision s3 = Rattrapage", (await sprAfter(spr3.id)) === "Rattrapage");
  check("double publication refusée", err(await publishSession(cPub, sid)) === "INVALID_STATUS");

  // ---------- Dépublication ----------
  console.log("\n== Dépublication ==");
  // Correction manuelle sur s1 : la dépublication ne doit pas l'écraser
  await prisma.studentPeriodResult.update({
    where: { id: spr1.id },
    data: { councilDecision: "Correction manuelle direction" },
  });
  check("dépublication sans motif → REASON_REQUIRED", err(await depublishSession(cPub, sid, " ")) === "REASON_REQUIRED");
  check("dépublication refusée sans permission publish", !(await depublishSession(cVal, sid, "motif")).ok);
  check("dépublication motivée", (await depublishSession(cPub, sid, "PV annulé : erreur matérielle")).ok);
  check("session redevenue VALIDATED", (await getSession(cMan, sid))!.status === "VALIDATED");
  check("correction manuelle s1 préservée", (await sprAfter(spr1.id)) === "Correction manuelle direction");
  check("libellé s2 retiré", (await sprAfter(spr2.id)) == null);
  check("republication", (await publishSession(cPub, sid)).ok);
  check("councilDecision s1 resynchronisé à la republication", (await sprAfter(spr1.id)) === "Ajournement");

  // ---------- Concurrence ----------
  console.log("\n== Concurrence ==");
  const prep2 = await prepareSession(cMan, { scope: "PERIOD", classroomId: A.classroom.id, academicPeriodId: A.period2.id });
  check("session T2 préparée", prep2.ok);
  if (!prep2.ok) throw new Error("prep2 échoué");
  const [v1, v2] = await Promise.all([
    validateSession(cVal, prep2.result.id),
    validateSession(cVal, prep2.result.id),
  ]);
  check("une seule validation gagne", [v1.ok, v2.ok].filter(Boolean).length === 1);
  check("perdante = INVALID_STATUS", (!v1.ok ? v1.error : !v2.ok ? v2.error : "") === "INVALID_STATUS");

  // ---------- Délibération annuelle ----------
  console.log("\n== Annuelle ==");
  const prepA = await prepareSession(cMan, { scope: "ANNUAL", classroomId: A.classroom.id });
  check("session annuelle créée", prepA.ok);
  if (!prepA.ok) throw new Error("prep annuelle échouée");
  const detA = await getSession(cMan, prepA.result.id);
  const dA = (sid2: string) => detA!.decisions.find((d) => d.studentId === sid2)!;
  check("annuel s1 → Passe", dA(s1.id).proposedLabel === "Passe en classe supérieure");
  check("annuel s2 → Redouble", dA(s2.id).proposedLabel === "Redouble");
  check("annuel s4 → sans proposition", dA(s4.id).proposedLabel == null);
  check("doublon annuel refusé", err(await prepareSession(cMan, { scope: "ANNUAL", classroomId: A.classroom.id })) === "ALREADY_EXISTS");
  // s4 annuelle : décision libre
  await adjustDecision(cMan, { decisionId: dA(s4.id).id, customLabel: "Orientation vers autre établissement", reason: "Départ de la famille" });
  check("validation annuelle", (await validateSession(cVal, prepA.result.id)).ok);
  check("publication annuelle", (await publishSession(cPub, prepA.result.id)).ok);
  check("decision annuelle s1 synchronisée", (await prisma.studentAnnualResult.findUniqueOrThrow({ where: { id: sar1.id } })).decision === "Passe en classe supérieure");
  check("decision annuelle s2 = Redouble", (await prisma.studentAnnualResult.findUniqueOrThrow({ where: { id: sar2.id } })).decision === "Redouble");

  // ---------- Isolation inter-écoles ----------
  console.log("\n== Isolation ==");
  check("liste B ne voit que ses sessions", (await listSessions(cB)).length === 0);
  check("session A invisible depuis B", (await getSession(cB, sid)) == null);
  check("ajustement inter-écoles → NOT_FOUND", err(await adjustDecision(cB, { decisionId: d1.id, customLabel: "X", reason: "x" })) === "NOT_FOUND");
  check("validation inter-écoles → NOT_FOUND", err(await validateSession(cB, sid)) === "NOT_FOUND");
  check("publication inter-écoles → NOT_FOUND", err(await publishSession(cB, sid)) === "NOT_FOUND");
  const prepB = await prepareSession(cB, { scope: "PERIOD", classroomId: B.classroom.id, academicPeriodId: B.period.id });
  check("B prépare sa propre session (séquence PV propre à l'école)", prepB.ok);

  // ---------- Audit ----------
  console.log("\n== Audit ==");
  const audits = await prisma.auditLog.findMany({
    where: { schoolId: A.school.id, entity: { in: ["DeliberationSession", "DeliberationDecision", "DeliberationRule"] } },
    select: { action: true, actorId: true },
  });
  const actions = new Set(audits.map((a) => a.action));
  for (const act of [
    "deliberation.rule.create",
    "deliberation.prepare",
    "deliberation.decision.adjust",
    "deliberation.reprepare",
    "deliberation.validate",
    "deliberation.unlock",
    "deliberation.publish",
    "deliberation.depublish",
  ]) {
    check(`audit ${act}`, actions.has(act));
  }
  check("événements d'audit présents", audits.length > 0);

  // ---------- Intégrité des résultats ----------
  console.log("\n== Intégrité ==");
  check("moyenne s1 jamais modifiée", (await prisma.studentPeriodResult.findUniqueOrThrow({ where: { id: spr1.id } })).generalAverage === 16);
  check("moyenne s3 jamais modifiée", (await prisma.studentPeriodResult.findUniqueOrThrow({ where: { id: spr3.id } })).generalAverage === 12);
  check("statut du résultat inchangé (CALCULATED)", (await prisma.studentPeriodResult.findUniqueOrThrow({ where: { id: spr1.id } })).status === "CALCULATED");

  console.log(`\n=== H5 recette : ${pass} PASS, ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error("H5_RECETTE_FAILED", e);
  process.exit(1);
});
