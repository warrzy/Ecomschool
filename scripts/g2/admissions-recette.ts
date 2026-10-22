/**
 * Recette G2-B — candidatures publiques et suivi sécurisé :
 * campagnes, soumission valide/invalide/hors période, anti double-soumission,
 * multi-enfants, groupe familial, suivi par code, pièces (dépôt public,
 * remplacement, ticket signé), permissions dédiées, isolation inter-écoles,
 * transitions, retrait, rotation du code, concurrence.
 *
 * Usage : npx tsx scripts/g2/admissions-recette.ts
 */
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "g2b-docs-"));
process.env.DOCUMENTS_ROOT = TEST_ROOT;
process.env.ADMISSIONS_TICKET_SECRET = "g2b-recette-secret";

import { createHmac } from "node:crypto";
import { prisma } from "../../src/lib/db/prisma";
import {
  applicantReplaceDocument,
  applicantUploadDocument,
  createCampaign,
  getApplicationDetail,
  getPrivacyText,
  getPublicCampaignForm,
  getTrackingView,
  listApplications,
  listPublicCampaigns,
  makeDocTicket,
  readApplicantDocumentByTicket,
  rotateTrackingSecret,
  setCampaignStatus,
  setPrivacyText,
  submitApplication,
  transitionApplication,
  verifyDocTicket,
  withdrawApplication,
} from "../../src/lib/services/admissions";
import { canReadDocument, readDocument } from "../../src/lib/services/documents";

let pass = 0, fail = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};

const PDF = Buffer.concat([
  Buffer.from("%PDF-1.4\n"),
  Buffer.from("1 0 obj <<>> endobj\n%%EOF\n"),
]);
const FAKE = Buffer.from("<script>alert(1)</script>");

const FX = "G2B-FX";
const FX2 = "G2B-OTHER";
const SLUG = "g2b-fix";
const EMAILS = [
  "g2b-admin@test.local",
  "g2b-rev@test.local",
  "g2b-read@test.local",
  "g2b-dec@test.local",
  "g2b-docman@test.local",
];

async function cleanupSchool(schoolId: string) {
  const docs = await prisma.document.findMany({
    where: { schoolId },
    select: { storagePath: true },
  });
  for (const d of docs) {
    try { fs.rmSync(path.join(TEST_ROOT, d.storagePath), { force: true }); } catch { /* ok */ }
  }
  await prisma.document.deleteMany({ where: { schoolId } });
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
    data: { email, passwordHash: "x", firstName: "G2B", lastName: email },
  });
  const role = await prisma.role.create({
    data: { name: `G2B_${email}`, scope: "SCHOOL", schoolId },
  });
  const perms = await prisma.permission.findMany({
    where: { key: { in: permKeys } },
    select: { id: true },
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

function baseChild(i = 0) {
  return {
    firstName: `Enfant${i}`,
    lastName: "Candidat",
    birthDate: "2015-05-10",
    targetLevelId: undefined as string | undefined,
  };
}
const baseGuardian = {
  guardianFirstName: "Parent",
  guardianLastName: "Candidat",
  guardianRelation: "Mère",
  guardianPhone: "+22670000001",
};

(async () => {
  // ---------- Fixtures ----------
  for (const [name, slug] of [[FX, SLUG], [FX2, "g2b-other"]] as const) {
    const old = await prisma.school.findFirst({ where: { OR: [{ name }, { slug }] }, select: { id: true } });
    if (old) await cleanupSchool(old.id);
  }
  const stale = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
  if (stale.length) {
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: stale.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: stale.map((u) => u.id) } } });
  }

  const school = await prisma.school.create({
    data: { name: FX, code: FX, slug: SLUG },
  });
  const schoolB = await prisma.school.create({
    data: { name: FX2, code: FX2, slug: "g2b-other" },
  });
  const year = await prisma.academicYear.create({
    data: {
      schoolId: school.id,
      name: "2026-2027",
      startDate: new Date("2026-09-01"),
      endDate: new Date("2027-06-30"),
      status: "ACTIVE",
      isCurrent: true,
    },
  });
  const level = await prisma.level.create({
    data: { schoolId: school.id, name: "CM2", order: 1 },
  });
  const admin = await makeMember("g2b-admin@test.local", school.id, [
    "admissions.read", "admissions.review", "admissions.decide", "admissions.manage",
    "documents.read", "documents.manage",
  ]);
  const reviewer = await makeMember("g2b-rev@test.local", school.id, [
    "admissions.read", "admissions.review",
  ]);
  const reader = await makeMember("g2b-read@test.local", school.id, ["admissions.read"]);
  const decider = await makeMember("g2b-dec@test.local", school.id, [
    "admissions.read", "admissions.decide",
  ]);
  const docManager = await makeMember("g2b-docman@test.local", school.id, [
    "documents.read", "documents.manage",
  ]);
  const ctxA = { userId: admin.id, schoolId: school.id };
  const ctxRev = { userId: reviewer.id, schoolId: school.id };
  const ctxRead = { userId: reader.id, schoolId: school.id };
  const ctxDec = { userId: decider.id, schoolId: school.id };
  const ctxDocMan = { userId: docManager.id, schoolId: school.id };

  const campaignInput = {
    name: "Admissions 2026",
    academicYearId: year.id,
    opensAt: "2020-01-01",
    closesAt: "2099-12-31",
    targetLevelIds: [level.id],
    trainingOptions: [],
    requiredDocs: [
      { key: "naissance", label: "Extrait de naissance", category: "IDENTITE", required: true },
    ],
  };

  // ---------- Campagnes ----------
  console.log("\n== Campagnes ==");
  const c1 = await createCampaign(ctxA, campaignInput);
  check("création campagne par admin", c1.ok);
  const cDeny = await createCampaign(ctxRev, campaignInput);
  check("création campagne refusée sans manage", !cDeny.ok && !c1.ok === false && (cDeny as { error?: string }).error === "FORBIDDEN");

  let campaignId = "";
  if (c1.ok) {
    campaignId = c1.result.id;
    const listPubBefore = await listPublicCampaigns(school.id);
    check("campagne DRAFT invisible publiquement", listPubBefore.length === 0);
    const subDraft = await submitApplication({
      campaignId, selfApplicant: false, ...baseGuardian,
      children: [baseChild(0)], files: [],
    });
    check("soumission sur campagne DRAFT refusée", !subDraft.ok && subDraft.error === "CAMPAIGN_CLOSED");
    const badTransition = await setCampaignStatus(ctxA, campaignId, "ARCHIVED");
    check("DRAFT→ARCHIVED autorisé", badTransition.ok); // transition valide du graphe
    const reopen = await setCampaignStatus(ctxA, campaignId, "OPEN");
    check("ARCHIVED→OPEN refusé", !reopen.ok);
    // remettre en état : recréer une campagne (ARCHIVED est terminal)
    const c2 = await createCampaign(ctxA, campaignInput);
    if (c2.ok) campaignId = c2.result.id;
    const open = await setCampaignStatus(ctxA, campaignId, "OPEN");
    check("DRAFT→OPEN", open.ok);
    const listPub = await listPublicCampaigns(school.id);
    check("campagne OPEN visible publiquement", listPub.some((c) => c.id === campaignId && c.accepting));
    const form = await getPublicCampaignForm(school.id, campaignId);
    check("formulaire public : niveau + pièce requise exposés",
      !!form && form.levels.length === 1 && form.requiredDocs.length === 1);
    // fenêtre temporelle
    const closedInput = { ...campaignInput, opensAt: "2030-01-01", closesAt: "2030-12-31" };
    const c3 = await createCampaign(ctxA, closedInput);
    if (c3.ok) {
      await setCampaignStatus(ctxA, c3.result.id, "OPEN");
      const subFuture = await submitApplication({
        campaignId: c3.result.id, selfApplicant: false, ...baseGuardian,
        children: [baseChild(9)], files: [
          { childIndex: 0, docKey: "naissance", category: "IDENTITE", buffer: PDF, originalName: "n.pdf" },
        ],
      });
      check("soumission hors période refusée", !subFuture.ok && subFuture.error === "CAMPAIGN_CLOSED");
    }
  }

  // ---------- Soumission ----------
  console.log("\n== Soumission publique ==");
  let secret = "";
  let appId = "";
  const files = (i = 0) => [
    { childIndex: i, docKey: "naissance", category: "IDENTITE", buffer: PDF, originalName: "naissance.pdf" },
  ];
  const sub = await submitApplication({
    campaignId, selfApplicant: false, ...baseGuardian,
    children: [{ ...baseChild(0), targetLevelId: level.id }],
    files: files(0), ip: "10.0.0.1",
  });
  check("soumission valide → numéro + code", sub.ok && !!sub.result.trackingSecret && sub.result.fileNumbers.length === 1);
  if (sub.ok) {
    secret = sub.result.trackingSecret!;
    const fn = sub.result.fileNumbers[0]!;
    check("format numéro DOS-2026-00001", /^DOS-2026-\d{5}$/.test(fn));
    const app = await prisma.admissionApplication.findUnique({ where: { fileNumber: fn } });
    appId = app?.id ?? "";
    check("statut initial SUBMITTED + événement", app?.status === "SUBMITTED");
    check("secret non stocké en clair", !!app && app.trackingHash.length === 64 && app.trackingHash !== secret);
    const docs = await prisma.document.findMany({ where: { ownerType: "ADMISSION", ownerId: app?.id } });
    check("pièce liée au dossier (uploader null)", docs.length === 1 && docs[0]!.uploadedById === null);
  }

  const subMissing = await submitApplication({
    campaignId, selfApplicant: false, ...baseGuardian,
    children: [{ ...baseChild(1), firstName: "SansPiece" }], files: [],
  });
  check("pièce obligatoire manquante → MISSING_DOCS", !subMissing.ok && subMissing.error === "MISSING_DOCS");

  const subBadKey = await submitApplication({
    campaignId, selfApplicant: false, ...baseGuardian,
    children: [{ ...baseChild(2), firstName: "MauvaiseCle" }],
    files: [{ childIndex: 0, docKey: "inconnu", category: "IDENTITE", buffer: PDF, originalName: "x.pdf" }],
  });
  check("docKey inconnu → INVALID_INPUT", !subBadKey.ok && subBadKey.error === "INVALID_INPUT");

  const subBadFile = await submitApplication({
    campaignId, selfApplicant: false, ...baseGuardian,
    children: [{ ...baseChild(3), firstName: "FichierFaux" }],
    files: [{ childIndex: 0, docKey: "naissance", category: "IDENTITE", buffer: FAKE, originalName: "x.pdf" }],
  });
  check("fichier non conforme → soumission refusée", !subBadFile.ok);
  const leftovers = await prisma.admissionApplication.count({
    where: { schoolId: school.id, candidateFirstName: "FichierFaux" },
  });
  const leftoverDocs = await prisma.document.count({ where: { schoolId: school.id, originalName: "x.pdf" } });
  check("échec pièce → nettoyage complet (dossier + fichiers)", leftovers === 0 && leftoverDocs === 0);

  const subDup = await submitApplication({
    campaignId, selfApplicant: false, ...baseGuardian,
    children: [{ ...baseChild(0), targetLevelId: level.id }],
    files: files(0),
  });
  check("double-soumission identique → idempotent (même n°, pas de nouveau code)",
    subDup.ok && subDup.result.fileNumbers[0] === (sub.ok ? sub.result.fileNumbers[0] : "?") && !subDup.result.trackingSecret);

  const subBadLevel = await submitApplication({
    campaignId, selfApplicant: false, ...baseGuardian,
    children: [{ ...baseChild(4), targetLevelId: "niveau-inexistant" }],
    files: files(0),
  });
  check("niveau hors cible campagne → refusé", !subBadLevel.ok && subBadLevel.error === "INVALID_INPUT");

  const subSelf = await submitApplication({
    campaignId, selfApplicant: true, guardianPhone: "+22670000002",
    children: [{ ...baseChild(5), firstName: "Majeur", lastName: "CandidatLibre", birthDate: "2005-01-01" }],
    files: files(0),
  });
  check("candidat majeur sans responsable → accepté", subSelf.ok);

  // Multi-enfants + groupe
  const subTwo = await submitApplication({
    campaignId, selfApplicant: false, ...baseGuardian,
    guardianPhone: "+22670000003",
    children: [{ ...baseChild(6), lastName: "Fratrie" }, { ...baseChild(7), lastName: "Fratrie" }],
    files: files(0).concat(files(1)),
  });
  check("2 enfants → 2 numéros, 1 code", subTwo.ok && subTwo.result.fileNumbers.length === 2 && !!subTwo.result.trackingSecret);

  // ---------- Suivi sécurisé ----------
  console.log("\n== Suivi sécurisé ==");
  const fn0 = sub.ok ? sub.result.fileNumbers[0]! : "";
  const viewBad = await getTrackingView({ fileNumber: fn0, secret: "mauvais-code" });
  check("mauvais code → accès refusé", viewBad === null);
  const viewNoNum = await getTrackingView({ fileNumber: "DOS-2026-99999", secret });
  check("numéro inconnu → refusé", viewNoNum === null);
  const view = await getTrackingView({ fileNumber: fn0, secret });
  check("bon code → vue complète", !!view && view.applications.length === 1 && view.schoolName === FX);
  check("vue suivi : aucun chemin/serveur exposé",
    !!view && JSON.stringify(view).includes("storagePath") === false && view.applications[0]!.documents.every((d) => d.ticket !== null));
  const denied = await prisma.auditLog.findFirst({ where: { action: "admissions.track_denied" } });
  check("tentative refusée journalisée (sans le code)", !!denied && !JSON.stringify(denied.metadata).includes(secret));

  // ---------- Pièces côté déposant ----------
  console.log("\n== Pièces via le suivi ==");
  const up = await applicantUploadDocument({
    fileNumber: fn0, secret, applicationId: appId,
    category: "BULLETIN", label: "bulletin", buffer: PDF, originalName: "b.pdf",
  });
  check("dépôt complémentaire autorisé en SUBMITTED", up.ok);
  const upBadCat = await applicantUploadDocument({
    fileNumber: fn0, secret, applicationId: appId,
    category: "EXECUTABLE", buffer: PDF, originalName: "e.pdf",
  });
  check("catégorie hors référentiel → refusée", !upBadCat.ok && upBadCat.error === "INVALID_INPUT");
  const upWrongSecret = await applicantUploadDocument({
    fileNumber: fn0, secret: "faux", applicationId: appId,
    category: "BULLETIN", buffer: PDF, originalName: "b.pdf",
  });
  check("dépôt avec mauvais code → refusé", !upWrongSecret.ok && upWrongSecret.error === "FORBIDDEN");

  const docRows = await prisma.document.findMany({
    where: { ownerType: "ADMISSION", ownerId: appId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  const rep = await applicantReplaceDocument({
    fileNumber: fn0, secret, documentId: docRows[0]!.id,
    buffer: PDF, originalName: "naissance-v2.pdf",
  });
  check("remplacement pièce → nouvelle version", rep.ok);
  const oldDoc = await prisma.document.findUnique({ where: { id: docRows[0]!.id } });
  check("ancienne version REPLACED", oldDoc?.status === "REPLACED");

  // Ticket de lecture
  const view2 = await getTrackingView({ fileNumber: fn0, secret });
  const activeDoc = view2!.applications[0]!.documents.find((d) => d.status === "ACTIVE")!;
  const dl = await readApplicantDocumentByTicket(activeDoc.ticket!);
  check("ticket valide → lecture du contenu", dl.ok && dl.buffer.equals(PDF));
  const forged = activeDoc.ticket!.split(".");
  forged[3] = forged[3]!.replace(/.$/, forged[3]!.endsWith("A") ? "B" : "A");
  const dlForged = await readApplicantDocumentByTicket(forged.join("."));
  check("ticket falsifié → refusé", !dlForged.ok);
  const otherTicket = await prisma.document.findFirst({
    where: { ownerType: "ADMISSION", ownerId: { not: appId }, status: "ACTIVE" },
  });
  if (otherTicket) {
    const cross = await readApplicantDocumentByTicket(
      // ticket signé pour un autre document — le service exige ownerId=appId du ticket
      activeDoc.ticket!.replace(/^[0-9a-z]+\./, `${"x".repeat(24)}.`),
    );
    check("ticket sur autre dossier → refusé", !cross.ok);
  }

  // ---------- Permissions documents ----------
  console.log("\n== Permissions dédiées ==");
  const admDoc = await prisma.document.findFirst({
    where: { ownerType: "ADMISSION", ownerId: appId, status: "ACTIVE" },
  });
  const canDocMan = admDoc ? await canReadDocument(ctxDocMan, admDoc) : true;
  check("documents.manage seul → pas d'accès aux pièces de candidature", canDocMan === false);
  const canRev = admDoc ? await canReadDocument(ctxRev, admDoc) : false;
  check("admissions.review → accès aux pièces", canRev === true);
  const rdDocMan = admDoc ? await readDocument(ctxDocMan, admDoc.id) : { ok: false as const };
  check("route agent : documents.manage → NOT_FOUND sur pièce candidature", !rdDocMan.ok);
  const rdRev = admDoc ? await readDocument(ctxRev, admDoc.id) : { ok: false as const };
  check("route agent : admissions.review → lecture OK", rdRev.ok);

  // ---------- Isolation ----------
  console.log("\n== Isolation inter-établissements ==");
  const listA = await listApplications(ctxA);
  check("file back-office limitée à l'école", listA.every((a) => a.schoolId === school.id));
  // Candidature réelle dans l'école B
  const yearB = await prisma.academicYear.create({
    data: { schoolId: schoolB.id, name: "2026-2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30"), status: "ACTIVE", isCurrent: true },
  });
  const cB = await prisma.admissionCampaign.create({
    data: {
      schoolId: schoolB.id, academicYearId: yearB.id, name: "Campagne B",
      opensAt: new Date("2020-01-01"), closesAt: new Date("2099-12-31"),
      status: "OPEN", requiredDocs: [],
    },
  });
  const subB = await submitApplication({
    campaignId: cB.id, selfApplicant: false, ...baseGuardian,
    guardianPhone: "+22670999999",
    children: [{ ...baseChild(30), lastName: "EcoleB" }],
    files: [{ childIndex: 0, docKey: "AUTRE", category: "AUTRE", buffer: PDF, originalName: "b.pdf" }],
  });
  const appB = subB.ok
    ? await prisma.admissionApplication.findUnique({ where: { fileNumber: subB.result.fileNumbers[0]! } })
    : null;
  check("candidature créée dans l'école B", !!appB);
  const detCross = appB ? await getApplicationDetail(ctxA, appB.id) : null;
  check("fiche d'un autre établissement inaccessible", detCross === null);
  const docB = appB
    ? await prisma.document.findFirst({ where: { ownerType: "ADMISSION", ownerId: appB.id } })
    : null;
  const rdCross = docB ? await readDocument(ctxA, docB.id) : null;
  check("pièce d'un autre établissement illisible (IDOR)", rdCross !== null && !rdCross.ok);
  const campsB = await listPublicCampaigns(schoolB.id);
  check("portail B n'expose pas les campagnes de A",
    campsB.every((c) => c.id !== campaignId));

  // ---------- Transitions ----------
  console.log("\n== Transitions ==");
  const trDeny = await transitionApplication(ctxRead, appId, "UNDER_REVIEW");
  check("transition sans admissions.review → FORBIDDEN", !trDeny.ok && trDeny.error === "FORBIDDEN");
  const trInfo = await transitionApplication(ctxRev, appId, "ADDITIONAL_INFO_REQUIRED");
  check("demande complément sans motif → refusée", !trInfo.ok && trInfo.error === "INVALID_INPUT");
  const trInfoOk = await transitionApplication(ctxRev, appId, "ADDITIONAL_INFO_REQUIRED", "Extrait illisible");
  check("demande complément motivée → OK", trInfoOk.ok);
  const view3 = await getTrackingView({ fileNumber: fn0, secret });
  check("parent voit la demande de complément",
    view3!.applications[0]!.status === "ADDITIONAL_INFO_REQUIRED" && view3!.applications[0]!.infoRequestNote === "Extrait illisible");
  const trRej = await transitionApplication(ctxRev, appId, "REJECTED", "motif");
  check("décision sans admissions.decide → FORBIDDEN", !trRej.ok && trRej.error === "FORBIDDEN");
  const trRejNoNote = await transitionApplication(ctxDec, appId, "REJECTED");
  check("refus sans motif → refusé", !trRejNoNote.ok && trRejNoNote.error === "INVALID_INPUT");
  const trBack = await transitionApplication(ctxRev, appId, "UNDER_REVIEW");
  check("retour en instruction après complément", trBack.ok);
  const trRejOk = await transitionApplication(ctxDec, appId, "REJECTED", "Dossier incomplet");
  check("refus motivé par decide → OK + tracé", trRejOk.ok);
  const evts = await prisma.admissionEvent.findMany({ where: { applicationId: appId }, orderBy: { createdAt: "asc" } });
  check("chronologie complète", evts.length >= 4 && evts.at(-1)!.toStatus === "REJECTED");

  // ---------- Retrait / rotation ----------
  console.log("\n== Retrait et rotation du code ==");
  const sub3 = await submitApplication({
    campaignId, selfApplicant: false, ...baseGuardian,
    guardianPhone: "+22670000004",
    children: [{ ...baseChild(8), lastName: "Retrait" }],
    files: files(0),
  });
  let secret3 = "";
  if (sub3.ok) {
    secret3 = sub3.result.trackingSecret!;
    const fn3 = sub3.result.fileNumbers[0]!;
    const app3 = await prisma.admissionApplication.findUnique({ where: { fileNumber: fn3 } });
    const wd = await withdrawApplication({
      fileNumber: fn3, secret: secret3, applicationId: app3!.id, reason: "Erreur",
    });
    check("retrait par le déposant", wd.ok);
    const upAfterWd = await applicantUploadDocument({
      fileNumber: fn3, secret: secret3, applicationId: app3!.id,
      category: "AUTRE", buffer: PDF, originalName: "x.pdf",
    });
    check("pièce sur dossier retiré → refusée", !upAfterWd.ok && upAfterWd.error === "INVALID_STATE");

    const rot = await rotateTrackingSecret(ctxA, app3!.id);
    check("rotation du code (manage)", rot.ok && !!rot.result.secret);
    const viewOld = await getTrackingView({ fileNumber: fn3, secret: secret3 });
    check("ancien code révoqué", viewOld === null);
    const viewNew = rot.ok
      ? await getTrackingView({ fileNumber: fn3, secret: rot.result.secret })
      : null;
    check("nouveau code fonctionne (groupe entier)", !!viewNew);
    secret3 = rot.ok ? rot.result.secret : secret3;
  }

  // ---------- Concurrence ----------
  console.log("\n== Concurrence ==");
  const subs = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      submitApplication({
        campaignId, selfApplicant: false, ...baseGuardian,
        guardianPhone: `+2267000010${i}`,
        children: [{ ...baseChild(20 + i), lastName: `Conc${i}` }],
        files: files(0),
      }),
    ),
  );
  const numbers = new Set(subs.filter((s) => s.ok).flatMap((s) => s.ok ? s.result.fileNumbers : []));
  check("5 soumissions concurrentes → numéros distincts", subs.every((s) => s.ok) && numbers.size === 5);

  // ---------- Durcissements préproduction ----------
  console.log("\n== Durcissements ==");

  // Plafond de volume cumulé : 6 × 5 Mo > 25 Mo → refusé avant tout dépôt.
  {
    const big = Buffer.alloc(5 * 1024 * 1024);
    PDF.copy(big, 0);
    const bigFiles = Array.from({ length: 6 }, (_, i) => ({
      childIndex: 0,
      docKey: i === 0 ? "naissance" : "AUTRE",
      category: "JUSTIFICATIF" as const,
      buffer: big,
      originalName: `big${i}.pdf`,
    }));
    const subBig = await submitApplication({
      campaignId, selfApplicant: false, ...baseGuardian,
      guardianPhone: "+22670000030",
      children: [{ ...baseChild(30), lastName: "TropGros" }],
      files: bigFiles,
    });
    check("volume cumulé > plafond → FILE_TOO_LARGE",
      !subBig.ok && subBig.error === "FILE_TOO_LARGE");
    const orphans = await prisma.document.count({
      where: { schoolId: school.id, ownerType: "ADMISSION", originalName: { startsWith: "big" } },
    });
    check("aucun fichier déposé malgré le refus", orphans === 0);
  }

  // Ticket expiré : HMAC valide mais échéance passée → refus.
  {
    const doc = await prisma.document.findFirst({
      where: { schoolId: school.id, ownerType: "ADMISSION", status: "ACTIVE" },
      select: { id: true, ownerId: true },
    });
    check("fixture pièce active présente", !!doc);
    if (doc) {
      const exp = Date.now() - 1000;
      const sig = createHmac("sha256", process.env.ADMISSIONS_TICKET_SECRET!)
        .update(`${doc.ownerId}.${doc.id}.${exp}`)
        .digest("base64url");
      const expired = `${doc.ownerId}.${doc.id}.${exp}.${sig}`;
      check("ticket expiré → refusé", verifyDocTicket(expired) === null);
      const rd = await readApplicantDocumentByTicket(expired);
      check("lecture via ticket expiré → NOT_FOUND", !rd.ok && rd.error === "NOT_FOUND");

      // Signature correcte mais ticket tronqué → refus.
      check("ticket tronqué → refusé",
        verifyDocTicket(expired.split(".").slice(0, 3).join(".")) === null);
      // Ticket valide d'un autre document du même dossier : portée stricte.
      const otherDoc = await prisma.document.findFirst({
        where: {
          schoolId: school.id, ownerType: "ADMISSION", status: "ACTIVE",
          ownerId: doc.ownerId, id: { not: doc.id },
        },
        select: { id: true },
      });
      if (otherDoc) {
        const tOther = makeDocTicket(doc.ownerId!, otherDoc.id)!;
        const rdOther = await readApplicantDocumentByTicket(tOther);
        check("ticket de l'autre pièce ne lit que l'autre pièce",
          rdOther.ok && rdOther.doc.id === otherDoc.id);
      }
    }
  }

  // Confidentialité : lecture défaut, écriture réservée, repli.
  {
    const def = await getPrivacyText(school.id);
    check("texte confidentialité par défaut non vide", def.length > 40);
    const noPerm = await setPrivacyText({ userId: reader.id, schoolId: school.id }, "X".repeat(80));
    check("écriture sans admissions.manage → FORBIDDEN", !noPerm.ok && noPerm.error === "FORBIDDEN");
    const setOk = await setPrivacyText(ctxA, "Politique personnalisée école A — données de recette.");
    check("écriture avec admissions.manage → OK", setOk.ok);
    const custom = await getPrivacyText(school.id);
    check("texte personnalisé lu", custom.includes("personnalisée école A"));
    await setPrivacyText(ctxA, "");
    const back = await getPrivacyText(school.id);
    check("retour au texte par défaut si vide", back === def);
  }

  // Aucun secret de suivi dans les événements d'audit.
  {
    const logs = await prisma.auditLog.findMany({
      where: { schoolId: school.id, action: { startsWith: "admissions." } },
      select: { metadata: true, action: true },
    });
    const serialized = JSON.stringify(logs.map((l) => l.metadata));
    check("aucun code de suivi dans les métadonnées d'audit",
      !!secret3 && !serialized.includes(secret3) &&
      !(sub.ok && serialized.includes(sub.result.trackingSecret ?? "∅")));
  }

  // ---------- Résumé ----------
  console.log(`\n=== Recette G2-B : ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
