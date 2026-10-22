import { createHash, randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { getStorage } from "@/lib/storage";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import type { Document, DocumentStatus } from "@prisma/client";

/**
 * G2-A — Brique documentaire transversale.
 *
 * Règles d'accès :
 *  - `documents.manage` → tous les documents de l'établissement.
 *  - `documents.read` → uniquement les documents déposés par l'utilisateur
 *    lui-même (ou, à terme, liés à un objet métier qu'il peut lire via
 *    `isOwnerReadable` — jamais tous les documents de l'école).
 *  - `documents.upload` → dépôt ; `documents.manage` → remplacement et
 *    suppression logique.
 *
 * Le statut limite l'accès : seul un document ACTIVE est téléchargeable ;
 * REPLACED/DELETED/PURGED renvoient NOT_FOUND (pas de fuite d'existence).
 */

export type DocumentsError =
  | "INVALID_INPUT"
  | "UNSUPPORTED_TYPE"
  | "FILE_TOO_LARGE"
  | "QUOTA_EXCEEDED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "STORAGE_FAILED"
  | "INTEGRITY_ERROR";

export type DocumentsResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: DocumentsError };

type SchoolCtx = { userId: string; schoolId: string };

export const MAX_DOCUMENT_BYTES = Number(
  process.env.DOCUMENTS_MAX_BYTES ?? 5 * 1024 * 1024,
);
export const DEFAULT_SCHOOL_QUOTA_BYTES = Number(
  process.env.DOCUMENTS_DEFAULT_QUOTA_BYTES ?? 500 * 1024 * 1024,
);
/** Jours de conservation d'un document DELETED avant purge physique. */
export const PURGE_AFTER_DAYS = Number(
  process.env.DOCUMENTS_PURGE_AFTER_DAYS ?? 30,
);

/** Types acceptés : signature (magic bytes) vérifiée, jamais le MIME client. */
const MAGIC: { mime: string; ext: string; sig: number[] }[] = [
  { mime: "application/pdf", ext: ".pdf", sig: [0x25, 0x50, 0x44, 0x46] },
  { mime: "image/jpeg", ext: ".jpg", sig: [0xff, 0xd8, 0xff] },
  {
    mime: "image/png",
    ext: ".png",
    sig: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
];

export const ALLOWED_MIME_TYPES = MAGIC.map((m) => m.mime);

export const DOCUMENT_OWNER_TYPES = [
  "STANDALONE",
  "ADMISSION",
  "STUDENT",
  "GUARDIAN",
  "ENROLLMENT",
  "EXPENSE",
  "PAYMENT",
  "STAFF",
  "CONTRACT",
  "FINANCE",
  "ADMINISTRATIVE",
] as const;

export const DOCUMENT_CATEGORIES = [
  "IDENTITE",
  "BULLETIN",
  "JUSTIFICATIF",
  "CONTRAT",
  "DIPLOME",
  "ADMINISTRATIF",
  "AUTRE",
] as const;

function sniff(buffer: Buffer) {
  for (const m of MAGIC) {
    if (buffer.length >= m.sig.length) {
      const head = buffer.subarray(0, m.sig.length);
      if (m.sig.every((b, i) => head[i] === b)) return m;
    }
  }
  return null;
}

const cleanCategory = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");

// ---------- Droits d'accès au niveau objet ----------

async function hasPerm(ctx: SchoolCtx, key: string) {
  return userHasSchoolPermission({
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    permissionKey: key,
  });
}

/**
 * Lien utilisateur ↔ objet propriétaire — point d'extension pour les
 * futurs modules (candidature par jeton, élève via students.read…).
 * `documents.read` seul n'ouvre PAS l'accès aux documents des autres.
 */
async function isOwnerReadable(ctx: SchoolCtx, doc: Document) {
  if (doc.uploadedById === ctx.userId) return true;
  // G2-B+ : ownerType ADMISSION/STUDENT/… — règles de liaison métier.
  return false;
}

export async function canReadDocument(ctx: SchoolCtx, doc: Document) {
  if (await hasPerm(ctx, "documents.manage")) return true;
  if (!(await hasPerm(ctx, "documents.read"))) return false;
  return isOwnerReadable(ctx, doc);
}

async function canMutateDocument(ctx: SchoolCtx, doc: Document) {
  if (await hasPerm(ctx, "documents.manage")) return true;
  if (!(await hasPerm(ctx, "documents.upload"))) return false;
  // Le déposant peut remplacer/supprimer sa propre pièce tant qu'elle est
  // ACTIVE — pas celles des autres.
  return doc.uploadedById === ctx.userId;
}

// ---------- Quotas ----------

/** Octets physiquement présents (tous statuts sauf PURGED). */
export async function getDocumentUsage(schoolId: string) {
  const agg = await prisma.document.aggregate({
    where: { schoolId, purgedAt: null },
    _sum: { sizeBytes: true },
  });
  return agg._sum.sizeBytes ?? 0;
}

/**
 * Quota par établissement : `school.settings.documentsQuotaBytes`
 * (Json existant), sinon la valeur par défaut.
 */
export async function getDocumentQuota(schoolId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { settings: true },
  });
  const raw = (school?.settings as { documentsQuotaBytes?: number } | null)
    ?.documentsQuotaBytes;
  const quotaBytes =
    typeof raw === "number" && raw > 0 ? raw : DEFAULT_SCHOOL_QUOTA_BYTES;
  const usedBytes = await getDocumentUsage(schoolId);
  return { usedBytes, quotaBytes, remainingBytes: quotaBytes - usedBytes };
}

// ---------- Opérations ----------

export type UploadInput = {
  /** Contenu brut — la taille et le type sont vérifiés sur le buffer. */
  buffer: Buffer;
  originalName: string;
  category: string;
  ownerType?: string;
  ownerId?: string;
  label?: string;
  description?: string;
};

export async function uploadDocument(
  ctx: SchoolCtx,
  input: UploadInput,
  ip?: string,
): Promise<DocumentsResult<{ id: string; sha256: string }>> {
  const category = cleanCategory(input.category);
  if (!category || !input.originalName?.trim()) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  const ownerType = (input.ownerType ?? "STANDALONE").toUpperCase();
  if (
    !(DOCUMENT_OWNER_TYPES as readonly string[]).includes(ownerType) ||
    (input.ownerId != null && !input.ownerId.trim())
  ) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  if (!input.buffer || input.buffer.length === 0) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  if (input.buffer.length > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: "FILE_TOO_LARGE" };
  }
  const sig = sniff(input.buffer);
  if (!sig) return { ok: false, error: "UNSUPPORTED_TYPE" };

  const quota = await getDocumentQuota(ctx.schoolId);
  if (input.buffer.length > quota.remainingBytes) {
    return { ok: false, error: "QUOTA_EXCEEDED" };
  }

  const fileName = `${randomUUID()}${sig.ext}`;
  const storagePath = `${ctx.schoolId}/${fileName}`;
  const sha256 = createHash("sha256").update(input.buffer).digest("hex");

  try {
    await getStorage().put(storagePath, input.buffer);
  } catch {
    return { ok: false, error: "STORAGE_FAILED" };
  }

  try {
    const doc = await prisma.document.create({
      data: {
        schoolId: ctx.schoolId,
        ownerType,
        ownerId: input.ownerId?.trim() || null,
        category,
        label: input.label?.trim() || null,
        description: input.description?.trim() || null,
        fileName,
        originalName: input.originalName.trim(),
        extension: sig.ext,
        mimeType: sig.mime,
        sizeBytes: input.buffer.length,
        sha256,
        storagePath,
        uploadedById: ctx.userId,
        uploadedByIp: ip ?? null,
        // Jeton opaque pré-alloué : permettra le lien de preuve public
        // (suivi candidature) sans exposer l'identifiant interne.
        accessToken: randomBytes(24).toString("base64url"),
      },
      select: { id: true },
    });
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "documents.upload",
      entity: "Document",
      entityId: doc.id,
      metadata: {
        category,
        ownerType,
        sizeBytes: input.buffer.length,
        mimeType: sig.mime,
      },
    });
    return { ok: true, result: { id: doc.id, sha256 } };
  } catch {
    // Fichier orphelin : nettoyage contrôlé, la ligne n'existe pas.
    await getStorage().remove(storagePath).catch(() => {});
    return { ok: false, error: "STORAGE_FAILED" };
  }
}

/**
 * Lecture autorisée d'un document : isolation `schoolId`, statut ACTIVE,
 * droit par objet, intégrité SHA-256 revérifiée au téléchargement.
 * NOT_FOUND est renvoyé pour tout échec — pas de fuite d'existence.
 */
export async function readDocument(
  ctx: SchoolCtx,
  id: string,
): Promise<DocumentsResult<{ doc: Document; buffer: Buffer }>> {
  const doc = await prisma.document.findFirst({
    where: { id, schoolId: ctx.schoolId },
  });
  if (!doc || doc.status !== "ACTIVE") return { ok: false, error: "NOT_FOUND" };
  if (!(await canReadDocument(ctx, doc))) return { ok: false, error: "NOT_FOUND" };

  const buffer = await getStorage().get(doc.storagePath);
  if (!buffer) return { ok: false, error: "NOT_FOUND" };

  const digest = createHash("sha256").update(buffer).digest("hex");
  if (digest !== doc.sha256 || buffer.length !== doc.sizeBytes) {
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "documents.integrity_error",
      entity: "Document",
      entityId: doc.id,
    });
    return { ok: false, error: "INTEGRITY_ERROR" };
  }

  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "documents.download",
    entity: "Document",
    entityId: doc.id,
  });
  return { ok: true, result: { doc, buffer } };
}

/**
 * Remplacement : nouvelle version créée, l'ancienne passe REPLACED
 * (fichier conservé, traçabilité complète). Transaction DB atomique.
 */
export async function replaceDocument(
  ctx: SchoolCtx,
  id: string,
  input: UploadInput,
  ip?: string,
): Promise<DocumentsResult<{ id: string; sha256: string }>> {
  const old = await prisma.document.findFirst({
    where: { id, schoolId: ctx.schoolId },
  });
  if (!old || old.status !== "ACTIVE") return { ok: false, error: "NOT_FOUND" };
  if (!(await canMutateDocument(ctx, old))) return { ok: false, error: "FORBIDDEN" };

  const category = input.category ? cleanCategory(input.category) : old.category;
  if (!category || !input.originalName?.trim()) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  if (!input.buffer || input.buffer.length === 0) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  if (input.buffer.length > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: "FILE_TOO_LARGE" };
  }
  const sig = sniff(input.buffer);
  if (!sig) return { ok: false, error: "UNSUPPORTED_TYPE" };

  const quota = await getDocumentQuota(ctx.schoolId);
  if (input.buffer.length > quota.remainingBytes) {
    return { ok: false, error: "QUOTA_EXCEEDED" };
  }

  const fileName = `${randomUUID()}${sig.ext}`;
  const storagePath = `${ctx.schoolId}/${fileName}`;
  const sha256 = createHash("sha256").update(input.buffer).digest("hex");

  try {
    await getStorage().put(storagePath, input.buffer);
  } catch {
    return { ok: false, error: "STORAGE_FAILED" };
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const next = await tx.document.create({
        data: {
          schoolId: ctx.schoolId,
          ownerType: old.ownerType,
          ownerId: old.ownerId,
          category,
          label: input.label?.trim() || old.label,
          description: input.description?.trim() || old.description,
          fileName,
          originalName: input.originalName.trim(),
          extension: sig.ext,
          mimeType: sig.mime,
          sizeBytes: input.buffer.length,
          sha256,
          storagePath,
          version: old.version + 1,
          uploadedById: ctx.userId,
          uploadedByIp: ip ?? null,
          accessToken: randomBytes(24).toString("base64url"),
        },
        select: { id: true },
      });
      await tx.document.update({
        where: { id: old.id },
        data: { status: "REPLACED", replacedById: next.id, replacedAt: new Date() },
      });
      return next;
    });
    await logAudit({
      actorId: ctx.userId,
      schoolId: ctx.schoolId,
      action: "documents.replace",
      entity: "Document",
      entityId: created.id,
      metadata: { previousId: old.id, version: old.version + 1 },
    });
    return { ok: true, result: { id: created.id, sha256 } };
  } catch {
    await getStorage().remove(storagePath).catch(() => {});
    return { ok: false, error: "STORAGE_FAILED" };
  }
}

/** Suppression logique motivée — le fichier reste jusqu'à la purge. */
export async function deleteDocument(
  ctx: SchoolCtx,
  id: string,
  input: { reason: string },
): Promise<DocumentsResult> {
  if (!input.reason.trim()) return { ok: false, error: "INVALID_INPUT" };
  const doc = await prisma.document.findFirst({
    where: { id, schoolId: ctx.schoolId },
  });
  if (!doc || doc.status !== "ACTIVE") return { ok: false, error: "NOT_FOUND" };
  if (!(await canMutateDocument(ctx, doc))) return { ok: false, error: "FORBIDDEN" };

  await prisma.document.update({
    where: { id: doc.id },
    data: {
      status: "DELETED",
      deletedAt: new Date(),
      deletedById: ctx.userId,
      deleteReason: input.reason.trim(),
    },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "documents.delete",
    entity: "Document",
    entityId: doc.id,
    metadata: { reason: input.reason.trim() },
  });
  return { ok: true, result: undefined };
}

/**
 * Purge physique des documents DELETED depuis plus de `olderThanDays`
 * (défaut `PURGE_AFTER_DAYS`). La ligne passe PURGED et son contenu est
 * définitivement perdu — les métadonnées et l'audit restent.
 */
export async function purgeDeletedDocuments(
  schoolId?: string,
  olderThanDays = PURGE_AFTER_DAYS,
) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const doomed = await prisma.document.findMany({
    where: {
      status: "DELETED",
      purgedAt: null,
      deletedAt: { lt: cutoff },
      ...(schoolId ? { schoolId } : {}),
    },
    select: { id: true, schoolId: true, storagePath: true },
  });
  const storage = getStorage();
  let purged = 0;
  for (const doc of doomed) {
    await storage.remove(doc.storagePath).catch(() => {});
    await prisma.document.update({
      where: { id: doc.id },
      data: { status: "PURGED", purgedAt: new Date() },
    });
    await logAudit({
      schoolId: doc.schoolId,
      action: "documents.purge",
      entity: "Document",
      entityId: doc.id,
    });
    purged++;
  }
  return purged;
}

export async function listDocuments(
  ctx: SchoolCtx,
  filters: {
    ownerType?: string;
    ownerId?: string;
    category?: string;
    status?: DocumentStatus;
  } = {},
) {
  const manageAll = await hasPerm(ctx, "documents.manage");
  return prisma.document.findMany({
    where: {
      schoolId: ctx.schoolId,
      // Sans documents.manage, on ne liste que ses propres dépôts —
      // jamais l'ensemble des documents de l'établissement.
      ...(manageAll ? {} : { uploadedById: ctx.userId }),
      ...(filters.ownerType ? { ownerType: filters.ownerType } : {}),
      ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.status
        ? { status: filters.status }
        : { status: { not: "PURGED" } }),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
}

export async function getDocument(ctx: SchoolCtx, id: string) {
  const doc = await prisma.document.findFirst({
    where: { id, schoolId: ctx.schoolId },
  });
  if (!doc) return null;
  if (!(await canReadDocument(ctx, doc))) return null;
  return doc;
}
