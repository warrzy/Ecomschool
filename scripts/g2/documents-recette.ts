/**
 * Recette G2-A — brique documentaire transversale :
 * upload valide/invalide/volumineux, magic bytes, quotas, téléchargement
 * autorisé/refusé, isolation inter-écoles (IDOR), remplacement,
 * suppression logique + accès post-suppression, concurrence, intégrité
 * SHA-256, purge, anti-traversée du stockage.
 *
 * Usage : npx tsx scripts/g2/documents-recette.ts
 */
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Stockage isolé de la recette — posé avant tout appel getStorage().
const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "g2a-docs-"));
process.env.DOCUMENTS_ROOT = TEST_ROOT;

import { prisma } from "../../src/lib/db/prisma";
import {
  deleteDocument,
  getDocumentQuota,
  listDocuments,
  purgeDeletedDocuments,
  readDocument,
  replaceDocument,
  uploadDocument,
} from "../../src/lib/services/documents";
import { fsStorage } from "../../src/lib/storage/fs";

let pass = 0, fail = 0, skip = 0;
const check = (n: string, c: boolean) => {
  if (c) { pass++; console.log(`  PASS ${n}`); }
  else { fail++; console.log(`  FAIL ${n}`); }
};
const note = (n: string) => { skip++; console.log(`  SKIP ${n}`); };
void note;

const PDF = Buffer.concat([
  Buffer.from("%PDF-1.4\n"),
  Buffer.from("1 0 obj <<>> endobj\n%%EOF\n"),
]);
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const FAKE = Buffer.from("<script>alert(1)</script>");
const BIG = Buffer.alloc(5 * 1024 * 1024 + 1, 0x41); // 5 Mo + 1

const FX = "G2A-FX";
const FX2 = "G2A-OTHER";
const EMAILS = ["g2a-mgr@test.local", "g2a-rd@test.local", "g2a-other@test.local"];

async function cleanupSchool(schoolId: string) {
  const docs = await prisma.document.findMany({
    where: { schoolId },
    select: { storagePath: true },
  });
  for (const d of docs) {
    const p = path.join(TEST_ROOT, d.storagePath);
    try { fs.rmSync(p, { force: true }); } catch { /* ok */ }
  }
  await prisma.document.deleteMany({ where: { schoolId } });
  await prisma.auditLog.deleteMany({ where: { schoolId } });
  await prisma.schoolMembership.deleteMany({ where: { schoolId } });
  const roles = await prisma.role.findMany({
    where: { schoolId },
    select: { id: true },
  });
  if (roles.length) {
    await prisma.rolePermission.deleteMany({
      where: { roleId: { in: roles.map((r) => r.id) } },
    });
    await prisma.role.deleteMany({ where: { id: { in: roles.map((r) => r.id) } } });
  }
  await prisma.school.deleteMany({ where: { id: schoolId } });
}

async function makeMember(
  userEmail: string,
  schoolId: string,
  permKeys: string[],
) {
  const user = await prisma.user.create({
    data: { email: userEmail, passwordHash: "x", firstName: "G2A", lastName: userEmail },
  });
  const role = await prisma.role.create({
    data: {
      name: `G2A_${userEmail}`,
      scope: "SCHOOL",
      schoolId,
      description: "recette",
    },
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

(async () => {
  // ---------- Fixtures ----------
  for (const name of [FX, FX2]) {
    const old = await prisma.school.findFirst({ where: { name }, select: { id: true } });
    if (old) await cleanupSchool(old.id);
  }
  const stale = await prisma.user.findMany({
    where: { email: { in: EMAILS } },
    select: { id: true },
  });
  if (stale.length) {
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: stale.map((u) => u.id) } } });
    await prisma.rolePermission.deleteMany({
      where: { role: { name: { in: EMAILS.map((e) => `G2A_${e}`) } } },
    });
    await prisma.role.deleteMany({
      where: { name: { in: EMAILS.map((e) => `G2A_${e}`) } },
    });
    await prisma.user.deleteMany({ where: { id: { in: stale.map((u) => u.id) } } });
  }

  const schoolA = await prisma.school.create({ data: { name: FX, code: FX, slug: "g2a-fx" } });
  const schoolB = await prisma.school.create({ data: { name: FX2, code: FX2, slug: "g2a-other" } });

  const mgr = await makeMember(EMAILS[0], schoolA.id, [
    "documents.read", "documents.upload", "documents.manage",
  ]);
  const rd = await makeMember(EMAILS[1], schoolA.id, [
    "documents.read", "documents.upload",
  ]);
  const otherMgr = await makeMember(EMAILS[2], schoolB.id, [
    "documents.read", "documents.upload", "documents.manage",
  ]);

  const ctxMgr = { userId: mgr.id, schoolId: schoolA.id };
  const ctxRd = { userId: rd.id, schoolId: schoolA.id };
  const ctxOther = { userId: otherMgr.id, schoolId: schoolB.id };

  // ---------- Dépôt ----------
  console.log("— Dépôt et validation —");
  const up = await uploadDocument(ctxMgr, {
    buffer: PDF, originalName: "bulletin.pdf", category: "BULLETIN",
  }, "127.0.0.1");
  check("upload PDF valide", up.ok);
  const doc1 = up.ok
    ? await prisma.document.findUnique({ where: { id: up.result.id } })
    : null;
  check("fichier écrit hors racine web", !!doc1 &&
    fs.existsSync(path.join(TEST_ROOT, doc1.storagePath)) &&
    !doc1.storagePath.includes("public"));
  check("mime détecté application/pdf", doc1?.mimeType === "application/pdf");
  check("sha256 enregistré", !!doc1 && /^[0-9a-f]{64}$/.test(doc1.sha256));
  check("chemin interne non exposé dans le nom", doc1?.fileName !== doc1?.originalName);

  const bad = await uploadDocument(ctxMgr, {
    buffer: FAKE, originalName: "evil.pdf", category: "BULLETIN",
  });
  check("fichier déguisé refusé (magic bytes)", !bad.ok && bad.error === "UNSUPPORTED_TYPE");

  const big = await uploadDocument(ctxMgr, {
    buffer: BIG, originalName: "big.pdf", category: "AUTRE",
  });
  check("fichier > 5 Mo refusé", !big.ok && big.error === "FILE_TOO_LARGE");

  const badOwner = await uploadDocument(ctxMgr, {
    buffer: PDF, originalName: "x.pdf", category: "AUTRE",
    ownerType: "HACK", ownerId: "anything",
  });
  check("ownerType inconnu refusé", !badOwner.ok && badOwner.error === "INVALID_INPUT");

  // ---------- Quota ----------
  console.log("— Quotas —");
  await prisma.school.update({
    where: { id: schoolA.id },
    data: { settings: { documentsQuotaBytes: (doc1?.sizeBytes ?? 0) + 10 } },
  });
  const over = await uploadDocument(ctxMgr, {
    buffer: PDF, originalName: "quota.pdf", category: "AUTRE",
  });
  check("quota dépassé refusé", !over.ok && over.error === "QUOTA_EXCEEDED");
  await prisma.school.update({
    where: { id: schoolA.id },
    data: { settings: {} },
  });
  const quota = await getDocumentQuota(schoolA.id);
  check("quota par défaut après reset", quota.quotaBytes >= 500 * 1024 * 1024);

  // ---------- Lecture ----------
  console.log("— Téléchargement et accès —");
  const rdUp = await uploadDocument(ctxRd, {
    buffer: PNG, originalName: "photo.png", category: "IDENTITE",
  });
  check("upload PNG par lecteur", rdUp.ok);
  const rdDoc = rdUp.ok
    ? await prisma.document.findUnique({ where: { id: rdUp.result.id } })
    : null;

  const ownRead = await readDocument(ctxRd, rdDoc!.id);
  check("déposant télécharge son document", ownRead.ok);
  const mgrRead = await readDocument(ctxMgr, rdDoc!.id);
  check("documents.manage lit le doc d'un tiers", mgrRead.ok);

  // read sans manage ne lit pas le document d'un autre utilisateur
  const crossUser = await readDocument(ctxRd, doc1!.id);
  check("read seul ≠ accès aux docs d'autrui", !crossUser.ok);
  const crossUserList = await listDocuments(ctxRd);
  check("listDocuments restreint à ses dépôts",
    crossUserList.every((d) => d.uploadedById === rd.id));
  const mgrList = await listDocuments(ctxMgr);
  check("documents.manage liste tout l'établissement",
    mgrList.length >= 2);

  const otherRead = await readDocument(ctxOther, doc1!.id);
  check("isolation inter-écoles (IDOR)", !otherRead.ok);
  const otherList = await listDocuments(ctxOther);
  check("aucune ligne inter-écoles en liste", otherList.length === 0);

  // ---------- Intégrité ----------
  console.log("— Intégrité SHA-256 —");
  const filePath = path.join(TEST_ROOT, doc1!.storagePath);
  const backup = fs.readFileSync(filePath);
  fs.writeFileSync(filePath, Buffer.concat([backup, Buffer.from("TAMPERED")]));
  const tampered = await readDocument(ctxMgr, doc1!.id);
  check("fichier altéré refusé", !tampered.ok && tampered.error === "INTEGRITY_ERROR");
  fs.writeFileSync(filePath, backup); // restauration pour la suite

  // ---------- Remplacement ----------
  console.log("— Remplacement —");
  const rep = await replaceDocument(ctxMgr, doc1!.id, {
    buffer: PDF, originalName: "bulletin-v2.pdf", category: "BULLETIN",
  });
  check("remplacement accepté", rep.ok);
  const oldDoc = await prisma.document.findUnique({ where: { id: doc1!.id } });
  const newDoc = rep.ok
    ? await prisma.document.findUnique({ where: { id: rep.result.id } })
    : null;
  check("ancien passe REPLACED + lien", oldDoc?.status === "REPLACED" && oldDoc.replacedById === newDoc?.id);
  check("version incrémentée", newDoc?.version === 2);
  const oldRead = await readDocument(ctxMgr, doc1!.id);
  check("version remplacée non téléchargeable", !oldRead.ok);
  const newRead = await readDocument(ctxMgr, rep.ok ? rep.result.id : "");
  check("nouvelle version téléchargeable", newRead.ok);

  // ---------- Suppression logique ----------
  console.log("— Suppression logique —");
  const delNoReason = await deleteDocument(ctxMgr, newDoc!.id, { reason: " " });
  check("suppression sans motif refusée", !delNoReason.ok);
  const delByOther = await deleteDocument(ctxRd, newDoc!.id, { reason: "pas le mien" });
  check("suppression par non-propriétaire refusée", !delByOther.ok);
  const del = await deleteDocument(ctxMgr, newDoc!.id, { reason: "pièce obsolète" });
  check("suppression logique", del.ok);
  const afterDel = await readDocument(ctxMgr, newDoc!.id);
  check("accès refusé après suppression", !afterDel.ok);
  check("fichier conservé après suppression logique",
    fs.existsSync(path.join(TEST_ROOT, newDoc!.storagePath)));

  // ---------- Concurrence ----------
  console.log("— Concurrence —");
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      uploadDocument(ctxMgr, {
        buffer: PNG, originalName: `c${i}.png`, category: "AUTRE",
      })),
  );
  check("5 uploads parallèles réussis", results.every((r) => r.ok));
  const names = await prisma.document.findMany({
    where: { schoolId: schoolA.id },
    select: { fileName: true },
  });
  check("aucun nom de fichier en collision",
    new Set(names.map((n) => n.fileName)).size === names.length);

  // ---------- Purge ----------
  console.log("— Purge —");
  await prisma.document.update({
    where: { id: newDoc!.id },
    data: { deletedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) },
  });
  const purged = await purgeDeletedDocuments(schoolA.id, 30);
  check("purge des DELETED anciens", purged === 1);
  const purgedDoc = await prisma.document.findUnique({ where: { id: newDoc!.id } });
  check("statut PURGED + métadonnées conservées",
    purgedDoc?.status === "PURGED" && !!purgedDoc.sha256);
  check("fichier physiquement supprimé",
    !fs.existsSync(path.join(TEST_ROOT, newDoc!.storagePath)));

  // ---------- Anti-traversée ----------
  console.log("— Stockage —");
  const storage = fsStorage(TEST_ROOT);
  let traversal = false;
  try { await storage.put("../escape.txt", Buffer.from("x")); }
  catch { traversal = true; }
  check("traversée de répertoire bloquée", traversal);
  let nullByte = false;
  try { await storage.get("a\0b"); } catch { nullByte = true; }
  check("octet nul rejeté", nullByte);
  const putDup = await storage.get(`${schoolA.id}/${doc1!.fileName}`);
  check("lecture par clé stockage", !!putDup && putDup.equals(backup));
  let overwrite = true;
  try { await storage.put(`${schoolA.id}/${doc1!.fileName}`, Buffer.from("x")); }
  catch { overwrite = false; }
  check("écrasement de clé existante refusé", !overwrite);

  // ---------- Nettoyage ----------
  await cleanupSchool(schoolA.id);
  await cleanupSchool(schoolB.id);
  const users = await prisma.user.findMany({
    where: { email: { in: EMAILS } },
    select: { id: true },
  });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });

  console.log(`\nG2A documents : ${pass} PASS / ${fail} FAIL / ${skip} SKIP`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
