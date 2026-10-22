/**
 * Recette G2-C — instruction administrative et décisions d'admission :
 * notes internes isolées, compléments + réponses, affectation instructeur,
 * entretiens (convocation publique / résultats internes), décisions
 * (permissions, motifs, capacité indicative vs contraignante, concurrence,
 * réexamen, protection CONVERTED), tableau de bord, notifications internes,
 * interface G2-D (getConversionReadiness), aucun secret dans l'audit.
 *
 * Usage : npx tsx scripts/g2/admissions-g2c-recette.ts
 */
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "g2c-docs-"));
process.env.DOCUMENTS_ROOT = TEST_ROOT;
process.env.ADMISSIONS_TICKET_SECRET = "g2c-recette-secret";

import { prisma } from "../../src/lib/db/prisma";
import {
  addApplicantMessage,
  addInternalNote,
  admissionDashboardStats,
  assignInstructor,
  campaignCapacityStats,
  createCampaign,
  decideApplication,
  getApplicationDetail,
  getConversionReadiness,
  getTrackingView,
  listAssignableMembers,
  reopenDecision,
  requestComplement,
  rescheduleInterview,
  scheduleInterview,
  setCampaignStatus,
  submitApplication,
  transitionApplication,
  updateInterviewOutcome,
} from "../../src/lib/services/admissions";

let pass = 0, fail = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};

const PDF = Buffer.concat([
  Buffer.from("%PDF-1.4\n"),
  Buffer.from("1 0 obj <<>> endobj\n%%EOF\n"),
]);

const FX = "G2C-FX";
const SLUG = "g2c-fix";
const EMAILS = [
  "g2c-admin@test.local",
  "g2c-rev@test.local",
  "g2c-read@test.local",
  "g2c-dec@test.local",
];

async function cleanup(schoolId: string) {
  const docs = await prisma.document.findMany({
    where: { schoolId }, select: { storagePath: true },
  });
  for (const d of docs) {
    try { fs.rmSync(path.join(TEST_ROOT, d.storagePath), { force: true }); } catch { /* ok */ }
  }
  await prisma.notification.deleteMany({ where: { schoolId } });
  await prisma.document.deleteMany({ where: { schoolId } });
  await prisma.admissionInterview.deleteMany({ where: { schoolId } });
  await prisma.admissionEvent.deleteMany({ where: { schoolId } });
  await prisma.admissionMessage.deleteMany({ where: { schoolId } });
  await prisma.admissionApplication.deleteMany({ where: { schoolId } });
  await prisma.admissionCampaign.deleteMany({ where: { schoolId } });
  await prisma.academicYear.deleteMany({ where: { schoolId } });
  await prisma.level.deleteMany({ where: { schoolId } });
  await prisma.auditLog.deleteMany({ where: { schoolId } });
  await prisma.schoolMembership.deleteMany({ where: { schoolId } });
  const roles = await prisma.role.findMany({ where: { schoolId }, select: { id: true } });
  if (roles.length) {
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: roles.map((r) => r.id) } } });
    await prisma.role.deleteMany({ where: { id: { in: roles.map((r) => r.id) } } });
  }
  await prisma.school.deleteMany({ where: { id: schoolId } });
}

async function makeMember(email: string, schoolId: string, permKeys: string[]) {
  const user = await prisma.user.create({
    data: { email, passwordHash: "x", firstName: "G2C", lastName: email },
  });
  const role = await prisma.role.create({
    data: { name: `G2C_${email}`, scope: "SCHOOL", schoolId },
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

const baseGuardian = {
  guardianFirstName: "Parent",
  guardianLastName: "G2C",
  guardianRelation: "Père",
  guardianPhone: "+22670000001",
};

let seq = 0;
async function submit(campaignId: string, levelId: string, phone?: string) {
  seq += 1;
  const res = await submitApplication({
    campaignId, selfApplicant: false,
    ...baseGuardian,
    guardianPhone: phone ?? `+22670001${String(seq).padStart(3, "0")}`,
    children: [{
      firstName: `Candidat${seq}`,
      lastName: "G2C",
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
  const old = await prisma.school.findFirst({ where: { OR: [{ name: FX }, { slug: SLUG }] }, select: { id: true } });
  if (old) await cleanup(old.id);
  const stale = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
  if (stale.length) {
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: stale.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: stale.map((u) => u.id) } } });
  }

  const school = await prisma.school.create({ data: { name: FX, code: FX, slug: SLUG } });
  const year = await prisma.academicYear.create({
    data: { schoolId: school.id, name: "2026-2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30"), status: "ACTIVE", isCurrent: true },
  });
  const level = await prisma.level.create({ data: { schoolId: school.id, name: "6e", order: 1 } });

  const admin = await makeMember("g2c-admin@test.local", school.id, [
    "admissions.read", "admissions.review", "admissions.decide", "admissions.manage",
  ]);
  const reviewer = await makeMember("g2c-rev@test.local", school.id, ["admissions.read", "admissions.review"]);
  const reader = await makeMember("g2c-read@test.local", school.id, ["admissions.read"]);
  const decider = await makeMember("g2c-dec@test.local", school.id, ["admissions.read", "admissions.decide"]);
  const ctxA = { userId: admin.id, schoolId: school.id };
  const ctxRev = { userId: reviewer.id, schoolId: school.id };
  const ctxRead = { userId: reader.id, schoolId: school.id };
  const ctxDec = { userId: decider.id, schoolId: school.id };

  const baseCampaign = {
    name: "Campagne G2C",
    academicYearId: year.id,
    opensAt: "2020-01-01",
    closesAt: "2099-12-31",
    targetLevelIds: [level.id],
    trainingOptions: [] as string[],
    requiredDocs: [{ key: "naissance", label: "Extrait de naissance", category: "IDENTITE", required: true }],
  };
  // Capacité contraignante de 2 places.
  const c1 = await createCampaign(ctxA, { ...baseCampaign, capacity: 2, capacityEnforced: true });
  check("campagne à capacité contraignante créée", c1.ok);
  const cap1 = c1.ok ? c1.result.id : "";
  await setCampaignStatus(ctxA, cap1, "OPEN");
  // Capacité indicative de 1 place.
  const c2 = await createCampaign(ctxA, { ...baseCampaign, name: "Indicative", capacity: 1, capacityEnforced: false });
  const capIndic = c2.ok ? c2.result.id : "";
  await setCampaignStatus(ctxA, capIndic, "OPEN");

  // ---------- Instruction : notes, compléments, affectation ----------
  console.log("\n== Instruction : notes, compléments, affectation ==");
  const s1 = await submit(cap1, level.id);
  check("candidature créée", !!s1);
  const app1 = s1!.app;

  const noteDeny = await addInternalNote(ctxRead, app1.id, "note");
  check("note interne sans review → FORBIDDEN", !noteDeny.ok && noteDeny.error === "FORBIDDEN");
  const noteEmpty = await addInternalNote(ctxRev, app1.id, "   ");
  check("note interne vide → INVALID_INPUT", !noteEmpty.ok && noteEmpty.error === "INVALID_INPUT");
  const noteOk = await addInternalNote(ctxRev, app1.id, "Dossier sensible — vérifier la fratrie");
  check("note interne par review → OK", noteOk.ok);
  const viewNote = await getTrackingView({ fileNumber: s1!.fileNumber, secret: s1!.secret });
  check("note interne invisible dans le suivi public",
    !!viewNote && !JSON.stringify(viewNote).includes("vérifier la fratrie"));
  const detRead = await getApplicationDetail(ctxRead, app1.id);
  check("note interne invisible pour admissions.read seul",
    !!detRead && !detRead.application.messages.some((m) => m.kind === "INTERNAL_NOTE"));

  const compDeny = await requestComplement(ctxRead, app1.id, "DOC_MISSING", "x");
  check("complément sans review → FORBIDDEN", !compDeny.ok && compDeny.error === "FORBIDDEN");
  const compBad = await requestComplement(ctxRev, app1.id, "BAD_KIND" as never, "x");
  check("kind inconnu → INVALID_INPUT", !compBad.ok && compBad.error === "INVALID_INPUT");
  const compOk = await requestComplement(ctxRev, app1.id, "DOC_MISSING", "Bulletin de 5e manquant");
  check("demande de complément → statut + message", compOk.ok);
  const viewComp = await getTrackingView({ fileNumber: s1!.fileNumber, secret: s1!.secret });
  check("candidat voit la demande",
    viewComp!.applications[0]!.status === "ADDITIONAL_INFO_REQUIRED" &&
    viewComp!.applications[0]!.messages.some((m) => m.body.includes("Bulletin de 5e")));

  const repBad = await addApplicantMessage({ fileNumber: s1!.fileNumber, secret: "faux", applicationId: app1.id, body: "x" });
  check("réponse avec mauvais code → FORBIDDEN", !repBad.ok && repBad.error === "FORBIDDEN");
  const repOk = await addApplicantMessage({ fileNumber: s1!.fileNumber, secret: s1!.secret, applicationId: app1.id, body: "Voici le bulletin demandé" });
  check("réponse du candidat → OK", repOk.ok);
  const detRep = await getApplicationDetail(ctxA, app1.id);
  check("réponse visible dans la fiche agent",
    !!detRep && detRep.application.messages.some((m) => m.kind === "APPLICANT_REPLY" && m.body.includes("bulletin demandé")));
  const notif = await prisma.notification.findFirst({
    where: { schoolId: school.id, userId: reviewer.id },
    orderBy: { createdAt: "desc" },
  });
  check("notification interne aux instructeurs (sans corps du message)",
    !!notif && !JSON.stringify(notif).includes("bulletin demandé") &&
    !JSON.stringify(notif).includes(s1!.secret));

  const asDeny = await assignInstructor(ctxRead, app1.id, reviewer.id);
  check("affectation sans review → FORBIDDEN", !asDeny.ok && asDeny.error === "FORBIDDEN");
  const asBadUser = await assignInstructor(ctxRev, app1.id, "user-inexistant");
  check("affectation à un non-membre → INVALID_INPUT", !asBadUser.ok && asBadUser.error === "INVALID_INPUT");
  const asOk = await assignInstructor(ctxRev, app1.id, reviewer.id);
  check("affectation à un instructeur → OK", asOk.ok);
  const detAs = await getApplicationDetail(ctxA, app1.id);
  check("affectation visible sur la fiche", detAs?.application.assignedToId === reviewer.id);
  const assignables = await listAssignableMembers(ctxA);
  check("liste des affectables = membres avec review",
    assignables.some((m) => m.id === reviewer.id) &&
    assignables.some((m) => m.id === admin.id) &&
    !assignables.some((m) => m.id === reader.id));

  // ---------- Entretiens ----------
  console.log("\n== Entretiens et tests ==");
  const ivDeny = await scheduleInterview(ctxRead, {
    applicationId: app1.id, type: "INTERVIEW", scheduledAt: "2099-01-10T09:00",
  });
  check("convocation sans review → FORBIDDEN", !ivDeny.ok && ivDeny.error === "FORBIDDEN");
  const ivBadType = await scheduleInterview(ctxRev, {
    applicationId: app1.id, type: "POTION" as never, scheduledAt: "2099-01-10T09:00",
  });
  check("type inconnu → INVALID_INPUT", !ivBadType.ok && ivBadType.error === "INVALID_INPUT");
  const ivOk = await scheduleInterview(ctxRev, {
    applicationId: app1.id, type: "INTERVIEW",
    scheduledAt: "2099-01-10T09:00", location: "Salle 12",
    evaluatorName: "M. Évaluateur", instructions: "Apporter le dossier papier",
  });
  check("convocation planifiée", ivOk.ok);
  const viewIv = await getTrackingView({ fileNumber: s1!.fileNumber, secret: s1!.secret });
  check("convocation visible dans le suivi (lieu + consignes)",
    viewIv!.applications[0]!.interviews.length === 1 &&
    viewIv!.applications[0]!.interviews[0]!.location === "Salle 12" &&
    JSON.stringify(viewIv).includes("dossier papier"));

  const ivId = ivOk.ok ? ivOk.result.id : "";
  const resched = await rescheduleInterview(ctxRev, ivId, "2099-01-12T14:00");
  check("reprogrammation → OK", resched.ok);
  const viewIv2 = await getTrackingView({ fileNumber: s1!.fileNumber, secret: s1!.secret });
  check("ancienne date conservée (previousScheduledAt)",
    viewIv2!.applications[0]!.interviews[0]!.previousScheduledAt !== null &&
    new Date(viewIv2!.applications[0]!.interviews[0]!.scheduledAt).toISOString().startsWith("2099-01-12"));

  const outOk = await updateInterviewOutcome(ctxRev, ivId, {
    status: "COMPLETED", result: "16/20", internalNote: "Bon niveau en maths",
  });
  check("clôture avec résultat + appréciation interne", outOk.ok);
  const viewIv3 = await getTrackingView({ fileNumber: s1!.fileNumber, secret: s1!.secret });
  check("résultat/appréciation internes exclus du suivi public",
    !JSON.stringify(viewIv3).includes("16/20") &&
    !JSON.stringify(viewIv3).includes("Bon niveau en maths"));
  const outAgain = await updateInterviewOutcome(ctxRev, ivId, { status: "CANCELLED" });
  check("entretien clôturé non modifiable", !outAgain.ok && outAgain.error === "NOT_FOUND");

  // ---------- Décisions ----------
  console.log("\n== Décisions d'admission ==");
  const decDeny = await decideApplication(ctxRev, app1.id, "ACCEPTED");
  check("décision sans admissions.decide → FORBIDDEN", !decDeny.ok && decDeny.error === "FORBIDDEN");
  const rejNoReason = await decideApplication(ctxDec, app1.id, "REJECTED");
  check("refus sans motif → INVALID_INPUT", !rejNoReason.ok && rejNoReason.error === "INVALID_INPUT");
  const condNoCond = await decideApplication(ctxDec, app1.id, "CONDITIONALLY_ACCEPTED");
  check("conditionnel sans conditions → INVALID_INPUT", !condNoCond.ok && condNoCond.error === "INVALID_INPUT");
  const legacyDec = await transitionApplication(ctxA, app1.id, "ACCEPTED");
  check("décision via transitionApplication → bloquée", !legacyDec.ok && legacyDec.error === "INVALID_STATE");

  const cond = await decideApplication(ctxDec, app1.id, "CONDITIONALLY_ACCEPTED", {
    conditions: "Fournir le bulletin final avant le 30/06",
  });
  check("admission conditionnelle → OK", cond.ok);
  const detCond = await getApplicationDetail(ctxA, app1.id);
  check("auteur et date de la décision enregistrés",
    detCond?.application.decidedById === decider.id && !!detCond.application.decidedAt &&
    !!detCond.application.decisionConditions?.includes("bulletin final"));
  const viewCond = await getTrackingView({ fileNumber: s1!.fileNumber, secret: s1!.secret });
  check("conditions visibles par la famille",
    viewCond!.applications[0]!.status === "CONDITIONALLY_ACCEPTED" &&
    !!viewCond!.applications[0]!.decisionConditions?.includes("bulletin final"));

  // Capacité : 1 conditionnel réservé + 1 accepté = campagne pleine (cap 2).
  const s2 = await submit(cap1, level.id);
  const s3 = await submit(cap1, level.id);
  const s4 = await submit(cap1, level.id);
  check("3 dossiers supplémentaires", !!s2 && !!s3 && !!s4);
  const acc2 = await decideApplication(ctxDec, s2!.app.id, "ACCEPTED");
  check("2e place réservée → OK", acc2.ok);
  const stats1 = await campaignCapacityStats(ctxA, cap1);
  check("capacité pleine (admis + conditionnels comptent)",
    !!stats1 && stats1.reserved === 2 && stats1.seatsLeft === 0);
  const acc3 = await decideApplication(ctxDec, s3!.app.id, "ACCEPTED");
  check("admission au-delà du plafond contraignant → CAPACITY_FULL",
    !acc3.ok && acc3.error === "CAPACITY_FULL");
  const wl = await decideApplication(ctxDec, s3!.app.id, "WAITLISTED", { waitlistRank: 1 });
  check("liste d'attente possible malgré le plafond", wl.ok);
  const rej4 = await decideApplication(ctxDec, s4!.app.id, "REJECTED", { reason: "Dossier insuffisant" });
  check("refus possible malgré le plafond", rej4.ok);
  const stats2 = await campaignCapacityStats(ctxA, cap1);
  check("stats campagne : total/admis/cond/attente/refusés",
    !!stats2 && stats2.total === 4 && stats2.accepted === 1 &&
    stats2.conditional === 1 && stats2.waitlisted === 1 && stats2.rejected === 1);

  // Réexamen borné : REJECTED → UNDER_REVIEW (motif), puis nouvelle décision.
  const reopenDeny = await reopenDecision(ctxRev, s4!.app.id, "motif");
  check("réexamen sans decide → FORBIDDEN", !reopenDeny.ok && reopenDeny.error === "FORBIDDEN");
  const directAcc = await decideApplication(ctxDec, s4!.app.id, "ACCEPTED");
  check("REJECTED → ACCEPTED direct refusé (réexamen requis)",
    !directAcc.ok && directAcc.error === "INVALID_STATE");
  const reopenNoNote = await reopenDecision(ctxDec, s4!.app.id, "  ");
  check("réexamen sans motif → INVALID_INPUT", !reopenNoNote.ok && reopenNoNote.error === "INVALID_INPUT");
  const reopenOk = await reopenDecision(ctxDec, s4!.app.id, "Pièces complétées en mains propres");
  check("réexamen motivé → retour en instruction", reopenOk.ok);
  const evReopen = await prisma.admissionEvent.findFirst({
    where: { applicationId: s4!.app.id, actorLabel: "réexamen" },
  });
  check("réexamen tracé", !!evReopen);

  // Concurrence : deux décisions identiques simultanées → une seule passe
  // (updateMany borné par la matrice : WAITLISTED n'est pas source de WAITLISTED).
  const [cA, cB] = await Promise.all([
    decideApplication(ctxDec, s4!.app.id, "WAITLISTED", { waitlistRank: 2 }),
    decideApplication(ctxDec, s4!.app.id, "WAITLISTED", { waitlistRank: 3 }),
  ]);
  check("décisions concurrentes → une seule l'emporte",
    [cA.ok, cB.ok].filter(Boolean).length === 1);
  const s4State = await prisma.admissionApplication.findUniqueOrThrow({
    where: { id: s4!.app.id }, select: { status: true },
  });
  check("état final cohérent (WAITLISTED)", s4State.status === "WAITLISTED");

  // Concurrence sur la capacité : libérer une place puis 2 admis simultanés.
  await decideApplication(ctxDec, app1.id, "REJECTED", { reason: "Conditions non remplies" });
  const s5 = await submit(cap1, level.id);
  const [p1, p2] = await Promise.all([
    decideApplication(ctxDec, s4!.app.id, "ACCEPTED"),
    decideApplication(ctxDec, s5!.app.id, "ACCEPTED"),
  ]);
  check("2 admis concurrents pour 1 place → 1 succès, 1 CAPACITY_FULL",
    [p1.ok, p2.ok].filter(Boolean).length === 1 &&
    [p1, p2].some((r) => !r.ok && r.error === "CAPACITY_FULL"));

  // Capacité indicative : dépassement autorisé, seatsLeft = 0 (alerte seule).
  const i1 = await submit(capIndic, level.id);
  const i2 = await submit(capIndic, level.id);
  const iAcc1 = await decideApplication(ctxDec, i1!.app.id, "ACCEPTED");
  const iAcc2 = await decideApplication(ctxDec, i2!.app.id, "ACCEPTED");
  check("capacité indicative : dépassement autorisé", iAcc1.ok && iAcc2.ok);
  const statsInd = await campaignCapacityStats(ctxA, capIndic);
  check("alerte indicative : places 0 sans blocage",
    !!statsInd && statsInd.seatsLeft === 0 && statsInd.reserved === 2);

  // Protection CONVERTED.
  await prisma.admissionApplication.update({
    where: { id: s4!.app.id }, data: { status: "CONVERTED" },
  });
  const decConv = await decideApplication(ctxDec, s4!.app.id, "REJECTED", { reason: "x" });
  check("dossier CONVERTED : décision verrouillée",
    !decConv.ok && decConv.error === "INVALID_STATE");
  const reopenConv = await reopenDecision(ctxDec, s4!.app.id, "motif");
  check("dossier CONVERTED : réexamen verrouillé", !reopenConv.ok);

  // ---------- Tableau de bord ----------
  console.log("\n== Tableau de bord ==");
  const dash = await admissionDashboardStats(ctxA);
  check("compteurs du tableau de bord cohérents",
    dash.total === 7 && dash.rejected >= 1 && dash.waitlisted >= 1 &&
    dash.accepted >= 1 && dash.converted === 1 &&
    dash.byCampaign.some((c) => c.name === "Campagne G2C") &&
    dash.byLevel.some((l) => l.name === "6e"));

  // ---------- Interface G2-D ----------
  console.log("\n== Préparation G2-D ==");
  const acceptedApp = await prisma.admissionApplication.findFirst({
    where: { schoolId: school.id, status: "ACCEPTED" },
  });
  const ready = acceptedApp ? await getConversionReadiness(ctxA, acceptedApp.id) : null;
  check("dossier admis → éligible à la conversion (rapport complet)",
    !!ready && ready.eligible && ready.schoolId === school.id &&
    !!ready.guardian && ready.documents.required.length === 1 &&
    !!ready.capacity && !!ready.campaign.academicYear);
  const notReady = await getConversionReadiness(ctxA, s3!.app.id);
  check("dossier en attente → non éligible, bloqueur signalé",
    !!notReady && !notReady.eligible && notReady.blockers.includes("statut_non_admis"));
  const readinessNothing = await prisma.admissionApplication.count({
    where: { schoolId: school.id, status: "CONVERTED" },
  });
  const studentCount = await prisma.student.count({ where: { schoolId: school.id } });
  check("G2-C ne crée ni élève ni conversion automatique",
    readinessNothing === 1 && studentCount === 0); // 1 = forçage de test

  // ---------- Audit et secrets ----------
  console.log("\n== Audit et secrets ==");
  const audits = await prisma.auditLog.findMany({
    where: { schoolId: school.id, action: { startsWith: "admissions." } },
    select: { action: true, metadata: true },
  });
  const actions = new Set(audits.map((a) => a.action));
  check("audit : décision + réexamen + affectation + entretien + complément",
    audits.some((a) => a.action === "admissions.decision.accepted") &&
    actions.has("admissions.decision.reopen") &&
    actions.has("admissions.assign") &&
    actions.has("admissions.interview.schedule") &&
    actions.has("admissions.complement.request"));
  const serialized = JSON.stringify(audits.map((a) => a.metadata));
  check("aucun code de suivi dans l'audit",
    !serialized.includes(s1!.secret) && !serialized.includes(s5!.secret));

  // Isolation : la fiche d'un autre établissement reste inaccessible.
  const schoolB = await prisma.school.create({ data: { name: "G2C-B", code: "G2C-B", slug: "g2c-b" } });
  const ctxB = { userId: admin.id, schoolId: schoolB.id };
  const detCross = await getApplicationDetail(ctxB, app1.id);
  check("fiche d'un autre établissement inaccessible", detCross === null);
  const decCross = await decideApplication(ctxB, app1.id, "REJECTED", { reason: "x" });
  check("décision sur dossier d'un autre établissement → refusée",
    !decCross.ok && ["FORBIDDEN", "NOT_FOUND"].includes(decCross.error));
  await prisma.school.delete({ where: { id: schoolB.id } });

  console.log(`\n=== Recette G2-C : ${pass} PASS / ${fail} FAIL ===`);
  if (process.env.G2C_CLEANUP === "1") {
    await cleanup(school.id);
    // Comptes fixture créés sans schoolId → orphelins à supprimer par email.
    const users = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
    await prisma.accountInvite.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    console.log("fixtures supprimées");
  }
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
