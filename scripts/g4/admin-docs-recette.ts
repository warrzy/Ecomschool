/**
 * Recette G4 — documents administratifs scolaires :
 * émission (attestation, certificat, carte), numérotation atomique
 * concurrente, permissions admin/parent, isolation inter-écoles,
 * vérification publique (valide/révoqué/inconnu), révocation et
 * réémission, mauvaise année, absence de photo, audit log.
 *
 * Usage : npx tsx scripts/g4/admin-docs-recette.ts
 * Nettoyage automatique ; G4_KEEP=1 pour conserver les fixtures.
 */
import "dotenv/config";

import { prisma } from "../../src/lib/db/prisma";
import {
  getAdminDocForDownload,
  getAdminDocForParent,
  issueAdministrativeDocument,
  listAdministrativeDocuments,
  listAdminDocsForParent,
  reissueAdministrativeDocument,
  revokeAdministrativeDocument,
  verifyPublicDocument,
} from "../../src/lib/services/administrative-docs";
import { buildAdminDocPdf } from "../../src/lib/pdf/build-admin-doc";

let pass = 0, fail = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};

const FX = "G4-FX";
const SLUG = "g4-fix";
const FX2 = "G4-FX-BIS";
const SLUG2 = "g4-fix-bis";
const EMAILS = [
  "g4-admin@test.local",
  "g4-read@test.local",
  "g4-issue-only@test.local",
  "g4-noperm@test.local",
  "g4b-admin@test.local",
  "g4-parent@test.local",
  "g4-stranger@test.local",
];

async function makeMember(email: string, schoolId: string, permKeys: string[]) {
  const user = await prisma.user.create({
    data: { email, passwordHash: "x", firstName: "G4", lastName: email },
  });
  const role = await prisma.role.create({
    data: { name: `G4_${email}_${schoolId.slice(-4)}`, scope: "SCHOOL", schoolId },
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

async function cleanupSchool(schoolId: string) {
  await prisma.administrativeDocument.deleteMany({ where: { schoolId } });
  await prisma.studentGuardian.deleteMany({ where: { schoolId } });
  await prisma.guardian.deleteMany({ where: { schoolId } });
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
  const school = await prisma.school.create({
    data: { name, code, slug, city: "Ouagadougou", phone: "+22625000000" },
  });
  const year = await prisma.academicYear.create({
    data: {
      schoolId: school.id, name: "2026-2027",
      startDate: new Date("2026-09-01"), endDate: new Date("2027-06-30"),
      status: "ACTIVE", isCurrent: true,
    },
  });
  const level = await prisma.level.create({ data: { schoolId: school.id, name: "6e", order: 1 } });
  const classroom = await prisma.classroom.create({
    data: { schoolId: school.id, academicYearId: year.id, levelId: level.id, name: "6e A" },
  });
  return { school, year, level, classroom };
}

(async () => {
  // ---------- Fixtures ----------
  for (const [name, slug] of [[FX, SLUG], [FX2, SLUG2]] as const) {
    const old = await prisma.school.findFirst({
      where: { OR: [{ name }, { slug }] }, select: { id: true },
    });
    if (old) await cleanupSchool(old.id);
  }
  const staleUsers = await prisma.user.findMany({
    where: { email: { in: EMAILS } }, select: { id: true },
  });
  if (staleUsers.length) {
    const ids = staleUsers.map((u) => u.id);
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: ids } } });
    await prisma.guardian.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }

  const A = await makeSchool(FX, SLUG, FX);
  const B = await makeSchool(FX2, SLUG2, FX2);

  const admin = await makeMember("g4-admin@test.local", A.school.id, [
    "administrative-docs.read", "administrative-docs.issue",
  ]);
  const reader = await makeMember("g4-read@test.local", A.school.id, [
    "administrative-docs.read",
  ]);
  const issuerOnly = await makeMember("g4-issue-only@test.local", A.school.id, [
    "administrative-docs.issue",
  ]);
  const noPerm = await makeMember("g4-noperm@test.local", A.school.id, []);
  const adminB = await makeMember("g4b-admin@test.local", B.school.id, [
    "administrative-docs.read", "administrative-docs.issue",
  ]);
  const ctxA = { userId: admin.id, schoolId: A.school.id };
  const ctxRead = { userId: reader.id, schoolId: A.school.id };
  const ctxIssuerOnly = { userId: issuerOnly.id, schoolId: A.school.id };
  const ctxNoPerm = { userId: noPerm.id, schoolId: A.school.id };
  const ctxB = { userId: adminB.id, schoolId: B.school.id };

  const student = await prisma.student.create({
    data: {
      schoolId: A.school.id, matricule: "G4-001",
      firstName: "Awa", lastName: "Zongo", sex: "FEMALE",
      birthDate: new Date("2014-05-10"), birthPlace: "Ouagadougou",
    },
  });
  await prisma.enrollment.create({
    data: {
      schoolId: A.school.id, studentId: student.id,
      classroomId: A.classroom.id, academicYearId: A.year.id,
      status: "ENROLLED",
    },
  });
  const otherStudent = await prisma.student.create({
    data: { schoolId: B.school.id, matricule: "G4B-001", firstName: "Issa", lastName: "B", sex: "MALE" },
  });

  // Parent rattaché + tiers sans lien.
  const parentUser = await prisma.user.create({
    data: { email: "g4-parent@test.local", passwordHash: "x", firstName: "Parent", lastName: "G4" },
  });
  const guardian = await prisma.guardian.create({
    data: { schoolId: A.school.id, firstName: "Parent", lastName: "G4", userId: parentUser.id },
  });
  await prisma.studentGuardian.create({
    data: {
      schoolId: A.school.id, studentId: student.id,
      guardianId: guardian.id, relation: "MOTHER",
    },
  });
  const stranger = await prisma.user.create({
    data: { email: "g4-stranger@test.local", passwordHash: "x", firstName: "X", lastName: "Y" },
  });
  const ctxParent = { userId: parentUser.id, schoolId: A.school.id };
  const ctxStranger = { userId: stranger.id, schoolId: A.school.id };

  // ---------- Émission des trois documents ----------
  console.log("\n== Émission ==");
  const att = await issueAdministrativeDocument(ctxA, {
    studentId: student.id, type: "ATTESTATION_INSCRIPTION",
  });
  check("attestation émise", att.ok);
  const cert = await issueAdministrativeDocument(ctxA, {
    studentId: student.id, type: "CERTIFICAT_SCOLAIRE",
  });
  check("certificat émis", cert.ok);
  const card = await issueAdministrativeDocument(ctxA, {
    studentId: student.id, type: "CARTE_SCOLAIRE",
  });
  check("carte émise (sans photo)", card.ok);
  check("numéros distincts",
    att.ok && cert.ok && card.ok && new Set([att.data.number, cert.data.number, card.data.number]).size === 3);
  check("numérotation préfixe année",
    att.ok && att.data.number.startsWith(`DOC-${new Date().getUTCFullYear()}-`));

  // ---------- Permissions ----------
  console.log("\n== Permissions ==");
  const denyIssue = await issueAdministrativeDocument(ctxRead, {
    studentId: student.id, type: "ATTESTATION_INSCRIPTION",
  });
  check("read sans issue → FORBIDDEN", !denyIssue.ok && denyIssue.error === "FORBIDDEN");
  const issueOk = await issueAdministrativeDocument(ctxIssuerOnly, {
    studentId: student.id, type: "ATTESTATION_INSCRIPTION",
  });
  check("issue sans read → émission OK", issueOk.ok);
  // `issue` implique la visibilité (nécessaire pour révoquer/réémettre) ;
  // un membre sans aucune des deux clés ne voit rien.
  const listIssuer = await listAdministrativeDocuments(ctxIssuerOnly);
  check("issue → visibilité historique (conception)", listIssuer.length === 4);
  const listNoPerm = await listAdministrativeDocuments(ctxNoPerm);
  check("aucune permission → liste vide", listNoPerm.length === 0);
  const listOk = await listAdministrativeDocuments(ctxRead);
  check("read → historique visible", listOk.length === 4);
  const docOk = att.ok ? await getAdminDocForDownload(ctxRead, att.data.id) : null;
  check("read → téléchargement doc", !!docOk && docOk!.type === "ATTESTATION_INSCRIPTION");
  const docNoPerm = att.ok ? await getAdminDocForDownload(ctxNoPerm, att.data.id) : null;
  check("aucune permission → téléchargement refusé", docNoPerm === null);

  // ---------- Isolation inter-écoles ----------
  console.log("\n== Isolation inter-écoles ==");
  const crossIssue = await issueAdministrativeDocument(ctxB, {
    studentId: student.id, type: "ATTESTATION_INSCRIPTION",
  });
  check("élève école A sous ctx école B → NOT_ENROLLED",
    !crossIssue.ok && crossIssue.error === "NOT_ENROLLED");
  const crossDoc = att.ok ? await getAdminDocForDownload(ctxB, att.data.id) : null;
  check("doc école A invisible depuis école B", crossDoc === null);
  const crossList = await listAdministrativeDocuments(ctxB);
  check("liste école B vide", crossList.length === 0);
  check("élève école B absent de la liste A",
    listOk.every((d) => d.studentId !== otherStudent.id));

  // ---------- Contenu PDF ----------
  console.log("\n== PDF ==");
  if (att.ok && cert.ok && card.ok) {
    const rowOf = (id: string) => prisma.administrativeDocument.findUnique({
      where: { id },
      select: { type: true, number: true, status: true, issuedAt: true, publicCode: true, payload: true },
    });
    const pdfAtt = await buildAdminDocPdf((await rowOf(att.data.id))!);
    check("PDF attestation généré", !!pdfAtt && pdfAtt.length > 500 && pdfAtt.subarray(0, 5).toString() === "%PDF-");
    const pdfCert = await buildAdminDocPdf((await rowOf(cert.data.id))!);
    check("PDF certificat généré (QR)", !!pdfCert && pdfCert.length > 500 && pdfCert.subarray(0, 5).toString() === "%PDF-");
    const pdfCard = await buildAdminDocPdf((await rowOf(card.data.id))!);
    check("PDF carte générée (sans photo)", !!pdfCard && pdfCard.length > 500 && pdfCard.subarray(0, 5).toString() === "%PDF-");
  }

  // ---------- Accès parent ----------
  console.log("\n== Portail parent ==");
  const parentDocs = await listAdminDocsForParent(ctxParent, student.id);
  check("parent : documents de son enfant visibles", parentDocs.length === 4);
  const parentDoc = att.ok ? await getAdminDocForParent(ctxParent, att.data.id) : null;
  check("parent : téléchargement son enfant", !!parentDoc);
  const strangerDocs = await listAdminDocsForParent(ctxStranger, student.id);
  check("tiers : aucun document", strangerDocs.length === 0);
  const strangerDoc = att.ok ? await getAdminDocForParent(ctxStranger, att.data.id) : null;
  check("tiers : téléchargement refusé", strangerDoc === null);
  const parentOther = await getAdminDocForParent(ctxParent, cert.ok ? cert.data.id : "x");
  check("parent : autre doc du même enfant OK", !!parentOther);

  // ---------- Vérification publique ----------
  console.log("\n== Vérification publique ==");
  const vOk = att.ok ? await verifyPublicDocument(att.ok ? (await prisma.administrativeDocument.findUnique({ where: { id: att.data.id }, select: { publicCode: true } }))!.publicCode : "x") : null;
  check("code valide → status VALID", vOk?.status === "VALID");
  check("réponse publique minimale",
    !!vOk && vOk.status === "VALID" && !("studentId" in vOk) && !("id" in vOk));
  const vUnknown = await verifyPublicDocument("code-qui-nexiste-pas");
  check("code inconnu → UNKNOWN", vUnknown.status === "UNKNOWN");
  check("code inconnu sans fuite d'info", !("number" in vUnknown));

  // ---------- Révocation / réémission ----------
  console.log("\n== Révocation ==");
  const revokeNoPerm = cert.ok
    ? await revokeAdministrativeDocument(ctxRead, cert.data.id, { reason: "motif" }) : null;
  check("révocation sans issue → FORBIDDEN", !revokeNoPerm?.ok && revokeNoPerm?.error === "FORBIDDEN");
  const revokeOk = cert.ok
    ? await revokeAdministrativeDocument(ctxA, cert.data.id, { reason: "Erreur de saisie" }) : null;
  check("révocation OK", !!revokeOk?.ok);
  if (cert.ok) {
    const vRevoked = await verifyPublicDocument(
      (await prisma.administrativeDocument.findUnique({ where: { id: cert.data.id }, select: { publicCode: true } }))!.publicCode);
    check("doc révoqué → status REVOKED", vRevoked.status === "REVOKED");
  }
  const parentRevoked = cert.ok ? await getAdminDocForParent(ctxParent, cert.data.id) : null;
  check("parent : doc révoqué masqué", parentRevoked === null);
  // L'admin conserve l'accès aux docs révoqués — le PDF est marqué
  // RÉVOQUÉ (traçabilité), le parent ne les voit plus jamais.
  const adminRevoked = cert.ok ? await getAdminDocForDownload(ctxRead, cert.data.id) : null;
  check("admin : doc révoqué encore consultable (marqué)", adminRevoked?.status === "REVOKED");
  const revokeAgain = cert.ok
    ? await revokeAdministrativeDocument(ctxA, cert.data.id, { reason: "bis" }) : null;
  check("double révocation → INVALID_STATE", !revokeAgain?.ok && revokeAgain?.error === "INVALID_STATE");
  // La réémission s'applique à un document VALIDE : l'ancien est révoqué
  // et pointe vers son remplaçant.
  const reissued = issueOk.ok
    ? await reissueAdministrativeDocument(ctxA, issueOk.data.id) : null;
  check("réémission d'un doc valide → nouveau document", !!reissued?.ok);
  if (reissued?.ok && issueOk.ok) {
    const oldDoc = await prisma.administrativeDocument.findUnique({
      where: { id: issueOk.data.id }, select: { replacedById: true, status: true },
    });
    check("réémission : ancien révoqué et lié au nouveau",
      oldDoc?.replacedById === reissued.data.id && oldDoc?.status === "REVOKED");
  }

  // ---------- Cas limites ----------
  console.log("\n== Cas limites ==");
  const ghost = await issueAdministrativeDocument(ctxA, {
    studentId: "inexistant", type: "ATTESTATION_INSCRIPTION",
  });
  check("élève inexistant → NOT_ENROLLED", !ghost.ok && ghost.error === "NOT_ENROLLED");
  const pastYear = await prisma.academicYear.create({
    data: {
      schoolId: A.school.id, name: "2025-2026",
      startDate: new Date("2025-09-01"), endDate: new Date("2026-06-30"),
      status: "CLOSED", isCurrent: false,
    },
  });
  const wrongYear = await issueAdministrativeDocument(ctxA, {
    studentId: student.id, type: "ATTESTATION_INSCRIPTION", academicYearId: pastYear.id,
  });
  check("année sans inscription → NOT_ENROLLED", !wrongYear.ok && wrongYear.error === "NOT_ENROLLED");
  const noDoc = await getAdminDocForDownload(ctxRead, "id-inexistant");
  check("doc inexistant → null", noDoc === null);

  // ---------- Concurrence ----------
  console.log("\n== Numérotation concurrente ==");
  const burst = await Promise.all(
    Array.from({ length: 8 }, () =>
      issueAdministrativeDocument(ctxA, { studentId: student.id, type: "CARTE_SCOLAIRE" })),
  );
  const numbers = burst.filter((r) => r.ok).map((r) => (r as { data: { number: string } }).data.number);
  check("8 émissions concurrentes réussies", numbers.length === 8);
  check("numéros uniques sous concurrence", new Set(numbers).size === numbers.length);

  // ---------- Audit ----------
  console.log("\n== Audit ==");
  const audits = await prisma.auditLog.findMany({
    where: { schoolId: A.school.id, entity: "AdministrativeDocument" },
    select: { action: true },
  });
  const actions = new Set(audits.map((a) => a.action));
  check("audit émission tracé", actions.has("admin_doc.issued"));
  check("audit révocation tracé", actions.has("admin_doc.revoked"));
  check("audit réémission tracé", actions.has("admin_doc.reissued"));
  check("audit téléchargement tracé", actions.has("admin_doc.download"));
  check("audit ne contient pas de secret",
    !JSON.stringify(audits).match(/password|secret|token/i));

  // ---------- Nettoyage ----------
  if (process.env.G4_KEEP !== "1") {
    await prisma.academicYear.deleteMany({ where: { id: pastYear.id } });
    await cleanupSchool(A.school.id);
    await cleanupSchool(B.school.id);
    const ids = (await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } })).map((u) => u.id);
    if (ids.length) {
      await prisma.schoolMembership.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    console.log("\n  fixtures nettoyées");
  }

  console.log(`\n==== G4 : ${pass} PASS / ${fail} FAIL ====`);
  if (fail) process.exit(1);
})()
  .catch((e) => { console.error("G4_RECETTE_FAILED", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
