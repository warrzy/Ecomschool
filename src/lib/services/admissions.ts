import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { logAudit } from "@/lib/services/audit";
import { getStorage } from "@/lib/storage";
import {
  DOCUMENT_CATEGORIES,
  readDocumentBuffer,
  replaceDocumentVersion,
  uploadDocument,
  type DocumentsError,
} from "@/lib/services/documents";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import type {
  AdmissionApplication,
  AdmissionApplicationStatus,
  AdmissionCampaign,
  AdmissionCampaignStatus,
  Document,
  Gender,
} from "@prisma/client";

/**
 * G2-B — Candidatures publiques et suivi des dossiers.
 *
 * Autorisations :
 *  - Back-office : `admissions.read` (consultation), `admissions.review`
 *    (instruction + pièces), `admissions.decide` (décisions G2-C),
 *    `admissions.manage` (campagnes + rotation du code de suivi).
 *  - Public : aucune session. Le déposant prouve sa légitimité par
 *    numéro de dossier + code de suivi (SHA-256 stocké, jamais le code).
 *    Le numéro seul ne donne accès à rien.
 *  - Pièces : `ownerType=ADMISSION` dans la brique G2-A — `documents.manage`
 *    n'y donne PAS accès (règle dans documents.ts).
 *
 * Le code de suivi n'apparaît jamais dans les logs, les métadonnées
 * d'audit ou une URL : le suivi passe par POST ; les téléchargements
 * utilisent un ticket HMAC court (15 min) signé côté serveur.
 */

export type AdmissionsError =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CAMPAIGN_CLOSED"
  | "INVALID_STATE"
  | "DUPLICATE"
  | "RATE_LIMITED"
  | "MISSING_DOCS"
  | "TOO_MANY_DOCS"
  | "CREATE_FAILED"
  | "UPDATE_FAILED"
  | "CONFIG_ERROR"
  | DocumentsError;

export type AdmissionsResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: AdmissionsError };

type SchoolCtx = { userId: string; schoolId: string };

export const MAX_APPLICATION_CHILDREN = 5;
export const MAX_APPLICATION_DOCS = Number(
  process.env.ADMISSIONS_MAX_DOCS ?? 10,
);
/** Durée de vie d'un ticket de lecture de pièce (suivi candidat). */
export const DOC_TICKET_TTL_MS = 15 * 60 * 1000;

const sha256 = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");

// ---------- Campagnes : configuration ----------

export type RequiredDoc = {
  key: string;
  label: string;
  category: string;
  required?: boolean;
};

export function requiredDocsOf(campaign: AdmissionCampaign): RequiredDoc[] {
  const raw = campaign.requiredDocs;
  if (!Array.isArray(raw)) return [];
  const docs: RequiredDoc[] = [];
  for (const d of raw) {
    if (
      d &&
      typeof d === "object" &&
      typeof (d as RequiredDoc).key === "string" &&
      typeof (d as RequiredDoc).label === "string" &&
      typeof (d as RequiredDoc).category === "string"
    ) {
      docs.push(d as RequiredDoc);
    }
  }
  return docs;
}

export function campaignLevelIds(campaign: AdmissionCampaign): string[] {
  return Array.isArray(campaign.targetLevelIds)
    ? campaign.targetLevelIds.filter((x): x is string => typeof x === "string")
    : [];
}

export function campaignTrainingOptions(
  campaign: AdmissionCampaign,
): string[] {
  return Array.isArray(campaign.trainingOptions)
    ? campaign.trainingOptions.filter(
        (x): x is string => typeof x === "string",
      )
    : [];
}

export function isCampaignAccepting(
  campaign: Pick<AdmissionCampaign, "status" | "opensAt" | "closesAt">,
  now = new Date(),
) {
  return (
    campaign.status === "OPEN" &&
    campaign.opensAt <= now &&
    campaign.closesAt >= now
  );
}

async function hasPerm(ctx: SchoolCtx, key: string) {
  return userHasSchoolPermission({
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    permissionKey: key,
  });
}

export type CampaignInput = {
  name: string;
  description?: string;
  instructions?: string;
  academicYearId: string;
  opensAt: string;
  closesAt: string;
  targetLevelIds: string[];
  trainingOptions: string[];
  requiredDocs: RequiredDoc[];
  capacity?: number;
  applicationFee?: number;
};

async function validateCampaignInput(
  ctx: SchoolCtx,
  input: CampaignInput,
): Promise<AdmissionsError | null> {
  if (!input.name?.trim() || !input.academicYearId) return "INVALID_INPUT";
  const opens = new Date(input.opensAt);
  const closes = new Date(input.closesAt);
  if (Number.isNaN(opens.getTime()) || Number.isNaN(closes.getTime())) {
    return "INVALID_INPUT";
  }
  if (opens >= closes) return "INVALID_INPUT";
  if (input.capacity != null && input.capacity <= 0) return "INVALID_INPUT";
  if (input.applicationFee != null && input.applicationFee < 0) {
    return "INVALID_INPUT";
  }

  const year = await prisma.academicYear.findFirst({
    where: { id: input.academicYearId, schoolId: ctx.schoolId },
    select: { id: true },
  });
  if (!year) return "INVALID_INPUT";

  if (input.targetLevelIds.length) {
    const found = await prisma.level.count({
      where: { id: { in: input.targetLevelIds }, schoolId: ctx.schoolId },
    });
    if (found !== input.targetLevelIds.length) return "INVALID_INPUT";
  }

  const keys = new Set<string>();
  for (const d of input.requiredDocs) {
    const key = d.key?.trim();
    if (!key || !d.label?.trim() || keys.has(key)) return "INVALID_INPUT";
    if (
      !(DOCUMENT_CATEGORIES as readonly string[]).includes(
        d.category?.trim().toUpperCase() ?? "",
      )
    ) {
      return "INVALID_INPUT";
    }
    keys.add(key);
  }
  return null;
}

function campaignData(input: CampaignInput) {
  return {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    instructions: input.instructions?.trim() || null,
    academicYearId: input.academicYearId,
    opensAt: new Date(input.opensAt),
    closesAt: new Date(input.closesAt),
    targetLevelIds: input.targetLevelIds,
    trainingOptions: input.trainingOptions,
    requiredDocs: input.requiredDocs.map((d) => ({
      key: d.key.trim(),
      label: d.label.trim(),
      category: d.category.trim().toUpperCase(),
      required: d.required !== false,
    })),
    capacity: input.capacity ?? null,
    applicationFee: input.applicationFee ?? null,
  };
}

export async function listCampaigns(ctx: SchoolCtx) {
  return prisma.admissionCampaign.findMany({
    where: { schoolId: ctx.schoolId },
    include: {
      academicYear: { select: { name: true } },
      _count: { select: { applications: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getCampaign(ctx: SchoolCtx, id: string) {
  return prisma.admissionCampaign.findFirst({
    where: { id, schoolId: ctx.schoolId },
    include: { academicYear: { select: { name: true } } },
  });
}

export async function createCampaign(
  ctx: SchoolCtx,
  input: CampaignInput,
): Promise<AdmissionsResult<{ id: string }>> {
  if (!(await hasPerm(ctx, "admissions.manage"))) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const invalid = await validateCampaignInput(ctx, input);
  if (invalid) return { ok: false, error: invalid };

  const created = await prisma.admissionCampaign.create({
    data: { schoolId: ctx.schoolId, ...campaignData(input), createdById: ctx.userId },
    select: { id: true },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "admissions.campaign.create",
    entity: "AdmissionCampaign",
    entityId: created.id,
  });
  return { ok: true, result: created };
}

/** Modification : tout en DRAFT ; en OPEN seulement clôture/consignes/capacité/frais. */
export async function updateCampaign(
  ctx: SchoolCtx,
  id: string,
  input: CampaignInput,
): Promise<AdmissionsResult> {
  if (!(await hasPerm(ctx, "admissions.manage"))) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const campaign = await prisma.admissionCampaign.findFirst({
    where: { id, schoolId: ctx.schoolId },
  });
  if (!campaign) return { ok: false, error: "NOT_FOUND" };
  if (campaign.status === "CLOSED" || campaign.status === "ARCHIVED") {
    return { ok: false, error: "INVALID_STATE" };
  }
  const invalid = await validateCampaignInput(ctx, input);
  if (invalid) return { ok: false, error: invalid };

  const data = campaignData(input);
  const limited =
    campaign.status === "OPEN"
      ? {
          closesAt: data.closesAt,
          instructions: data.instructions,
          capacity: data.capacity,
          applicationFee: data.applicationFee,
        }
      : data;
  await prisma.admissionCampaign.update({ where: { id: campaign.id }, data: limited });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "admissions.campaign.update",
    entity: "AdmissionCampaign",
    entityId: campaign.id,
  });
  return { ok: true, result: undefined };
}

/** Graphe : clé = statut cible, valeur = statuts d'origine autorisés. */
const CAMPAIGN_TRANSITIONS: Record<
  AdmissionCampaignStatus,
  AdmissionCampaignStatus[]
> = {
  DRAFT: ["OPEN"],
  OPEN: ["DRAFT", "CLOSED"],
  CLOSED: ["OPEN"],
  ARCHIVED: ["DRAFT", "CLOSED"],
};

export async function setCampaignStatus(
  ctx: SchoolCtx,
  id: string,
  to: AdmissionCampaignStatus,
): Promise<AdmissionsResult> {
  if (!(await hasPerm(ctx, "admissions.manage"))) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const updated = await prisma.admissionCampaign.updateMany({
    where: {
      id,
      schoolId: ctx.schoolId,
      status: { in: CAMPAIGN_TRANSITIONS[to] ?? [] },
    },
    data: { status: to },
  });
  if (updated.count === 0) {
    const exists = await prisma.admissionCampaign.findFirst({
      where: { id, schoolId: ctx.schoolId },
      select: { id: true },
    });
    return { ok: false, error: exists ? "INVALID_STATE" : "NOT_FOUND" };
  }
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: `admissions.campaign.${to.toLowerCase()}`,
    entity: "AdmissionCampaign",
    entityId: id,
  });
  return { ok: true, result: undefined };
}

// ---------- Portail public : lecture ----------

export async function getPublicSchool(slug: string) {
  return prisma.school.findFirst({
    where: { slug, status: "ACTIVE" },
    select: { id: true, name: true, slug: true, city: true },
  });
}

/** Campagnes OPEN (la fenêtre temporelle est revérifiée à la soumission). */
export async function listPublicCampaigns(schoolId: string) {
  const campaigns = await prisma.admissionCampaign.findMany({
    where: { schoolId, status: "OPEN" },
    include: { academicYear: { select: { name: true } } },
    orderBy: { opensAt: "asc" },
  });
  return campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    instructions: c.instructions,
    opensAt: c.opensAt,
    closesAt: c.closesAt,
    accepting: isCampaignAccepting(c),
    academicYear: c.academicYear.name,
    applicationFee: c.applicationFee,
  }));
}

/** Données du formulaire public : niveaux ciblés + formations + pièces. */
export async function getPublicCampaignForm(schoolId: string, campaignId: string) {
  const campaign = await prisma.admissionCampaign.findFirst({
    where: { id: campaignId, schoolId },
    include: { academicYear: { select: { name: true } } },
  });
  if (!campaign) return null;
  const levelIds = campaignLevelIds(campaign);
  const levels = await prisma.level.findMany({
    where: {
      schoolId,
      status: "ACTIVE",
      ...(levelIds.length ? { id: { in: levelIds } } : {}),
    },
    orderBy: { order: "asc" },
    select: { id: true, name: true },
  });
  return {
    campaign,
    accepting: isCampaignAccepting(campaign),
    levels,
    trainingOptions: campaignTrainingOptions(campaign),
    requiredDocs: requiredDocsOf(campaign),
    academicYearName: campaign.academicYear.name,
  };
}

// ---------- Portail public : soumission ----------

export type ApplicationChildInput = {
  firstName: string;
  lastName: string;
  birthDate?: string;
  birthPlace?: string;
  sex?: string;
  previousSchool?: string;
  targetLevelId?: string;
  targetClassroomId?: string;
  targetTraining?: string;
};

export type ApplicationFileInput = {
  childIndex: number;
  docKey: string;
  category: string;
  label?: string;
  buffer: Buffer;
  originalName: string;
};

export type SubmitApplicationInput = {
  campaignId: string;
  selfApplicant: boolean;
  guardianFirstName?: string;
  guardianLastName?: string;
  guardianRelation?: string;
  guardianPhone: string;
  guardianEmail?: string;
  guardianAddress?: string;
  secondaryContact?: string;
  extraInfo?: Record<string, string>;
  children: ApplicationChildInput[];
  files: ApplicationFileInput[];
  ip?: string;
  /** Rattachement à une soumission existante (« autre enfant »). */
  groupFileNumber?: string;
  groupSecret?: string;
};

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

function applicationFingerprint(
  campaignId: string,
  child: ApplicationChildInput,
  guardianPhone: string,
) {
  return sha256(
    [
      campaignId,
      normalize(child.firstName),
      normalize(child.lastName),
      child.birthDate ?? "",
      normalize(guardianPhone).replace(/\D/g, ""),
    ].join("|"),
  );
}

function yearTag(name: string) {
  const m = name.match(/\d{4}/);
  return m ? m[0] : String(new Date().getFullYear());
}

/**
 * Numéro lisible unique : DOS-<année>-<séquence>. La séquence est globale
 * (le fileNumber a une contrainte d'unicité plateforme — nécessaire au
 * suivi par numéro seul + code). Les collisions concurrentielles sont
 * couvertes par la boucle de retry sur P2002.
 */
async function nextFileNumber(year: string) {
  const prefix = `DOS-${year}-`;
  const last = await prisma.admissionApplication.findFirst({
    where: { fileNumber: { startsWith: prefix } },
    orderBy: { fileNumber: "desc" },
    select: { fileNumber: true },
  });
  const seq = last ? parseInt(last.fileNumber.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(5, "0")}`;
}

const newTrackingSecret = () => randomBytes(24).toString("base64url");

function trackingOk(app: { trackingHash: string }, secret: string) {
  const a = Buffer.from(app.trackingHash, "utf8");
  const b = Buffer.from(sha256(secret), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function submitApplication(
  input: SubmitApplicationInput,
): Promise<
  AdmissionsResult<{
    fileNumbers: string[];
    /** Code de suivi — retourné UNE seule fois, jamais stocké en clair. */
    trackingSecret?: string;
    reusedGroup: boolean;
  }>
> {
  if (!input.children.length || input.children.length > MAX_APPLICATION_CHILDREN) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  if (input.selfApplicant && input.children.length > 1) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  if (!input.guardianPhone?.trim()) return { ok: false, error: "INVALID_INPUT" };
  if (!input.selfApplicant) {
    if (!input.guardianFirstName?.trim() || !input.guardianLastName?.trim()) {
      return { ok: false, error: "INVALID_INPUT" };
    }
  }

  const campaign = await prisma.admissionCampaign.findFirst({
    where: { id: input.campaignId },
    include: { academicYear: { select: { name: true } } },
  });
  if (!campaign) return { ok: false, error: "NOT_FOUND" };
  if (!isCampaignAccepting(campaign)) {
    return { ok: false, error: "CAMPAIGN_CLOSED" };
  }

  // Ciblage : niveau ∈ cibles campagne, formation ∈ options configurées.
  const allowedLevels = campaignLevelIds(campaign);
  const allowedTrainings = campaignTrainingOptions(campaign);
  const levelIds = input.children
    .map((c) => c.targetLevelId)
    .filter((x): x is string => !!x);
  if (levelIds.length) {
    const foundLevels = await prisma.level.findMany({
      where: {
        id: { in: levelIds },
        schoolId: campaign.schoolId,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    const foundSet = new Set(foundLevels.map((l) => l.id));
    for (const lid of levelIds) {
      if (!foundSet.has(lid)) return { ok: false, error: "INVALID_INPUT" };
      if (allowedLevels.length && !allowedLevels.includes(lid)) {
        return { ok: false, error: "INVALID_INPUT" };
      }
    }
  }
  for (const c of input.children) {
    if (
      c.targetTraining &&
      allowedTrainings.length &&
      !allowedTrainings.includes(c.targetTraining)
    ) {
      return { ok: false, error: "INVALID_INPUT" };
    }
    if (c.targetClassroomId) {
      const room = await prisma.classroom.findFirst({
        where: {
          id: c.targetClassroomId,
          schoolId: campaign.schoolId,
          academicYearId: campaign.academicYearId,
          ...(c.targetLevelId ? { levelId: c.targetLevelId } : {}),
        },
        select: { id: true },
      });
      if (!room) return { ok: false, error: "INVALID_INPUT" };
    }
  }

  // Cohérence des pièces et des champs candidat.
  for (const c of input.children) {
    if (c.birthDate && Number.isNaN(new Date(c.birthDate).getTime())) {
      return { ok: false, error: "INVALID_INPUT" };
    }
  }
  // Pièces exigées : chaque clé obligatoire doit avoir un fichier non vide.
  const required = requiredDocsOf(campaign).filter((d) => d.required !== false);
  const maxDocKeys = requiredDocsOf(campaign).map((d) => d.key);
  for (const f of input.files) {
    if (
      !Number.isInteger(f.childIndex) ||
      f.childIndex < 0 ||
      f.childIndex >= input.children.length
    ) {
      return { ok: false, error: "INVALID_INPUT" };
    }
    if (
      !(DOCUMENT_CATEGORIES as readonly string[]).includes(
        f.category?.trim().toUpperCase() ?? "",
      )
    ) {
      return { ok: false, error: "INVALID_INPUT" };
    }
    // docKey inconnu → refus (pas de pièce sauvage) ; "AUTRE" = pièce libre.
    if (f.docKey !== "AUTRE" && !maxDocKeys.includes(f.docKey)) {
      return { ok: false, error: "INVALID_INPUT" };
    }
  }
  for (let i = 0; i < input.children.length; i++) {
    const childFiles = input.files.filter((f) => f.childIndex === i);
    if (childFiles.length > MAX_APPLICATION_DOCS) {
      return { ok: false, error: "TOO_MANY_DOCS" };
    }
    for (const rd of required) {
      const file = childFiles.find((f) => f.docKey === rd.key);
      if (!file || file.buffer.length === 0) {
        return { ok: false, error: "MISSING_DOCS" };
      }
    }
  }

  // Rattachement « autre enfant » : même groupe, même code de suivi.
  let submissionGroupId: string;
  let trackingHash: string;
  let trackingSecret: string | undefined;
  let reusedGroup = false;
  if (input.groupFileNumber && input.groupSecret) {
    const ref = await prisma.admissionApplication.findFirst({
      where: { fileNumber: input.groupFileNumber, schoolId: campaign.schoolId },
      select: { submissionGroupId: true, trackingHash: true, guardianPhone: true },
    });
    if (!ref || !trackingOk(ref, input.groupSecret)) {
      return { ok: false, error: "FORBIDDEN" };
    }
    submissionGroupId = ref.submissionGroupId;
    trackingHash = ref.trackingHash;
    reusedGroup = true;
  } else {
    submissionGroupId = randomBytes(12).toString("base64url");
    trackingSecret = newTrackingSecret();
    trackingHash = sha256(trackingSecret);
  }

  // Anti double-soumission : même empreinte + même campagne + même groupe
  // non existant → réponse idempotente (le code n'est pas re-délivré).
  const fingerprints = input.children.map((c) =>
    applicationFingerprint(campaign.id, c, input.guardianPhone),
  );
  const existing = await prisma.admissionApplication.findFirst({
    where: {
      schoolId: campaign.schoolId,
      campaignId: campaign.id,
      fingerprint: { in: fingerprints },
      status: { notIn: ["WITHDRAWN"] },
    },
    select: { fileNumber: true, fingerprint: true, submissionGroupId: true },
  });
  if (existing) {
    return {
      ok: true,
      result: {
        fileNumbers: [existing.fileNumber],
        trackingSecret: undefined,
        reusedGroup: existing.submissionGroupId === submissionGroupId,
      },
    };
  }
  // Doublon probable (autre campagne/autre téléphone) : signalé, non bloquant.
  const probableDuplicate = await prisma.admissionApplication.findFirst({
    where: {
      schoolId: campaign.schoolId,
      status: { notIn: ["WITHDRAWN", "REJECTED"] },
      candidateLastName: {
        equals: input.children[0]!.lastName.trim(),
        mode: "insensitive",
      },
      candidateFirstName: {
        equals: input.children[0]!.firstName.trim(),
        mode: "insensitive",
      },
      birthDate: input.children[0]!.birthDate
        ? new Date(input.children[0]!.birthDate)
        : undefined,
    },
    select: { id: true },
  });

  const year = yearTag(campaign.academicYear.name);
  const fileNumbers: string[] = [];
  const createdIds: string[] = [];
  try {
    for (let i = 0; i < input.children.length; i++) {
      const c = input.children[i]!;
      let fileNumber = "";
      // Concurrence : l'unicité du fileNumber est garantie par la contrainte
      // — en cas de collision (deux soumissions simultanées), on retente.
      for (let attempt = 0; attempt < 6; attempt++) {
        fileNumber = await nextFileNumber(year);
        try {
          const app = await prisma.admissionApplication.create({
            data: {
              schoolId: campaign.schoolId,
              campaignId: campaign.id,
              fileNumber,
              trackingHash,
              submissionGroupId,
              fingerprint: fingerprints[i],
              duplicateOfId: i === 0 ? probableDuplicate?.id ?? null : null,
              status: "SUBMITTED",
              candidateFirstName: c.firstName.trim(),
              candidateLastName: c.lastName.trim(),
              birthDate: c.birthDate ? new Date(c.birthDate) : null,
              birthPlace: c.birthPlace?.trim() || null,
              sex: c.sex === "MALE" || c.sex === "FEMALE" ? (c.sex as Gender) : null,
              previousSchool: c.previousSchool?.trim() || null,
              selfApplicant: input.selfApplicant,
              targetLevelId: c.targetLevelId ?? null,
              targetClassroomId: c.targetClassroomId ?? null,
              targetTraining: c.targetTraining?.trim() || null,
              extraInfo: input.extraInfo ?? undefined,
              guardianFirstName: input.selfApplicant
                ? null
                : input.guardianFirstName!.trim(),
              guardianLastName: input.selfApplicant
                ? null
                : input.guardianLastName!.trim(),
              guardianRelation: input.guardianRelation?.trim() || null,
              guardianPhone: input.guardianPhone.trim(),
              guardianEmail: input.guardianEmail?.trim() || null,
              guardianAddress: input.guardianAddress?.trim() || null,
              secondaryContact: input.secondaryContact?.trim() || null,
              submittedIp: input.ip ?? null,
              events: {
                create: {
                  schoolId: campaign.schoolId,
                  toStatus: "SUBMITTED",
                  actorLabel: "portail",
                  note: "Dépôt en ligne",
                },
              },
            },
            select: { id: true },
          });
          createdIds.push(app.id);
          fileNumbers.push(fileNumber);
          break;
        } catch (e) {
          const code = (e as { code?: string }).code;
          if (code === "P2002" && attempt < 5) continue;
          throw e;
        }
      }
    }
  } catch {
    await prisma.admissionApplication.deleteMany({
      where: { id: { in: createdIds } },
    });
    return { ok: false, error: "CREATE_FAILED" };
  }

  // Pièces : dépôt via la brique G2-A (uploader null = portail, aucune
  // session technique — l'autorisation vient de la fenêtre de campagne).
  const storage = getStorage();
  try {
    for (const f of input.files) {
      const appId = createdIds[f.childIndex];
      if (!appId) continue;
      const res = await uploadDocument(
        { userId: null, schoolId: campaign.schoolId },
        {
          buffer: f.buffer,
          originalName: f.originalName,
          category: f.category,
          ownerType: "ADMISSION",
          ownerId: appId,
          label: f.label ?? f.docKey,
        },
        input.ip,
      );
      if (!res.ok) throw new Error(res.error);
    }
  } catch {
    // Échec pièce → nettoyage complet : lignes, dossiers, fichiers.
    const docs = await prisma.document.findMany({
      where: { ownerType: "ADMISSION", ownerId: { in: createdIds } },
      select: { storagePath: true },
    });
    for (const d of docs) {
      await storage.remove(d.storagePath).catch(() => {});
    }
    await prisma.document.deleteMany({
      where: { ownerType: "ADMISSION", ownerId: { in: createdIds } },
    });
    await prisma.admissionApplication.deleteMany({
      where: { id: { in: createdIds } },
    });
    return { ok: false, error: "STORAGE_FAILED" };
  }

  await logAudit({
    schoolId: campaign.schoolId,
    action: "admissions.application.submit",
    entity: "AdmissionApplication",
    entityId: createdIds[0],
    metadata: {
      campaignId: campaign.id,
      children: input.children.length,
      fileNumbers,
      group: submissionGroupId,
    },
  });
  return {
    ok: true,
    result: { fileNumbers, trackingSecret, reusedGroup },
  };
}

// ---------- Suivi sécurisé du déposant ----------

function ticketSecret() {
  return (
    process.env.ADMISSIONS_TICKET_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    process.env.AUTH_SECRET ??
    null
  );
}

/** Ticket de lecture d'une pièce : signé, borné, révocable par expiration. */
export function makeDocTicket(applicationId: string, documentId: string) {
  const secret = ticketSecret();
  if (!secret) return null;
  const exp = Date.now() + DOC_TICKET_TTL_MS;
  const sig = createHmac("sha256", secret)
    .update(`${applicationId}.${documentId}.${exp}`)
    .digest("base64url");
  return `${applicationId}.${documentId}.${exp}.${sig}`;
}

export function verifyDocTicket(token: string) {
  const secret = ticketSecret();
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [appId, docId, expStr, sig] = parts as [
    string,
    string,
    string,
    string,
  ];
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  const expected = createHmac("sha256", secret)
    .update(`${appId}.${docId}.${expStr}`)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { applicationId: appId, documentId: docId };
}

type VerifiedApplicant = {
  application: AdmissionApplication;
  group: AdmissionApplication[];
};

async function verifyApplicant(
  fileNumber: string,
  secret: string,
): Promise<VerifiedApplicant | null> {
  const app = await prisma.admissionApplication.findFirst({
    where: { fileNumber },
  });
  if (!app || !trackingOk(app, secret)) return null;
  const group = await prisma.admissionApplication.findMany({
    where: { submissionGroupId: app.submissionGroupId },
    orderBy: { createdAt: "asc" },
  });
  return { application: app, group };
}

/** Vue suivi : statuts, compléments, pièces — jamais de chemins ni d'id internes sensibles. */
export async function getTrackingView(input: {
  fileNumber: string;
  secret: string;
  ip?: string;
}) {
  const v = await verifyApplicant(input.fileNumber, input.secret);
  if (!v) {
    await logAudit({
      action: "admissions.track_denied",
      entity: "AdmissionApplication",
      metadata: { fileNumber: input.fileNumber, ip: input.ip },
    });
    return null;
  }
  const apps = await prisma.admissionApplication.findMany({
    where: { submissionGroupId: v.application.submissionGroupId },
    include: {
      campaign: { select: { name: true } },
      targetLevel: { select: { name: true } },
      school: { select: { name: true, slug: true } },
      events: {
        orderBy: { createdAt: "asc" },
        select: { toStatus: true, note: true, createdAt: true, actorLabel: true },
      },
      messages: {
        where: { visibleToApplicant: true },
        orderBy: { createdAt: "asc" },
        select: { kind: true, body: true, createdAt: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const docRows = await prisma.document.findMany({
    where: {
      ownerType: "ADMISSION",
      ownerId: { in: apps.map((a) => a.id) },
      status: { not: "PURGED" },
    },
    orderBy: { createdAt: "asc" },
  });
  const canMutateDocs = (s: AdmissionApplicationStatus) =>
    s === "SUBMITTED" || s === "ADDITIONAL_INFO_REQUIRED";
  return {
    schoolName: apps[0]?.school.name ?? "",
    schoolSlug: apps[0]?.school.slug ?? "",
    campaignName: apps[0]?.campaign.name ?? "",
    applications: apps.map((a) => ({
      id: a.id,
      fileNumber: a.fileNumber,
      candidate: `${a.candidateFirstName} ${a.candidateLastName}`,
      status: a.status,
      targetLevel: a.targetLevel?.name ?? null,
      submittedAt: a.submittedAt,
      infoRequestNote: a.infoRequestNote,
      canEditDocs: canMutateDocs(a.status),
      canWithdraw: canMutateDocs(a.status),
      events: a.events,
      messages: a.messages,
      documents: docRows
        .filter((d) => d.ownerId === a.id)
        .map((d) => ({
          id: d.id,
          category: d.category,
          label: d.label,
          originalName: d.originalName,
          mimeType: d.mimeType,
          sizeBytes: d.sizeBytes,
          status: d.status,
          version: d.version,
          ticket: d.status === "ACTIVE" ? makeDocTicket(a.id, d.id) : null,
        })),
    })),
  };
}

/** Retrait d'un dossier par le déposant (fenêtre limitée). */
export async function withdrawApplication(input: {
  fileNumber: string;
  secret: string;
  applicationId: string;
  reason?: string;
  ip?: string;
}): Promise<AdmissionsResult> {
  const v = await verifyApplicant(input.fileNumber, input.secret);
  if (!v) return { ok: false, error: "FORBIDDEN" };
  const app = v.group.find((a) => a.id === input.applicationId);
  if (!app) return { ok: false, error: "NOT_FOUND" };
  const updated = await prisma.admissionApplication.updateMany({
    where: {
      id: app.id,
      status: { in: ["SUBMITTED", "UNDER_REVIEW", "ADDITIONAL_INFO_REQUIRED"] },
    },
    data: { status: "WITHDRAWN" },
  });
  if (updated.count === 0) return { ok: false, error: "INVALID_STATE" };
  await prisma.admissionEvent.create({
    data: {
      schoolId: app.schoolId,
      applicationId: app.id,
      fromStatus: app.status,
      toStatus: "WITHDRAWN",
      actorLabel: "portail",
      note: input.reason?.trim() || "Retrait par le déposant",
    },
  });
  await logAudit({
    schoolId: app.schoolId,
    action: "admissions.application.withdraw",
    entity: "AdmissionApplication",
    entityId: app.id,
    metadata: { fileNumber: app.fileNumber, ip: input.ip },
  });
  return { ok: true, result: undefined };
}

const APPLICANT_DOC_STATUSES: AdmissionApplicationStatus[] = [
  "SUBMITTED",
  "ADDITIONAL_INFO_REQUIRED",
];

/** Dépôt d'une pièce complémentaire par le déposant. */
export async function applicantUploadDocument(input: {
  fileNumber: string;
  secret: string;
  applicationId: string;
  category: string;
  label?: string;
  buffer: Buffer;
  originalName: string;
  ip?: string;
}): Promise<AdmissionsResult<{ id: string }>> {
  const v = await verifyApplicant(input.fileNumber, input.secret);
  if (!v) return { ok: false, error: "FORBIDDEN" };
  const app = v.group.find((a) => a.id === input.applicationId);
  if (!app) return { ok: false, error: "NOT_FOUND" };
  if (!APPLICANT_DOC_STATUSES.includes(app.status)) {
    return { ok: false, error: "INVALID_STATE" };
  }
  const count = await prisma.document.count({
    where: { ownerType: "ADMISSION", ownerId: app.id, status: "ACTIVE" },
  });
  if (count >= MAX_APPLICATION_DOCS) {
    return { ok: false, error: "TOO_MANY_DOCS" };
  }
  if (
    !(DOCUMENT_CATEGORIES as readonly string[]).includes(
      input.category?.trim().toUpperCase() ?? "",
    )
  ) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  const res = await uploadDocument(
    { userId: null, schoolId: app.schoolId },
    {
      buffer: input.buffer,
      originalName: input.originalName,
      category: input.category,
      ownerType: "ADMISSION",
      ownerId: app.id,
      label: input.label,
    },
    input.ip,
  );
  if (!res.ok) return { ok: false, error: res.error };
  await logAudit({
    schoolId: app.schoolId,
    action: "admissions.document.upload",
    entity: "Document",
    entityId: res.result.id,
    metadata: { applicationId: app.id, fileNumber: app.fileNumber, via: "suivi" },
  });
  return { ok: true, result: { id: res.result.id } };
}

/** Remplacement d'une pièce par le déposant — même fenêtre de statut. */
export async function applicantReplaceDocument(input: {
  fileNumber: string;
  secret: string;
  documentId: string;
  buffer: Buffer;
  originalName: string;
  ip?: string;
}): Promise<AdmissionsResult<{ id: string }>> {
  const v = await verifyApplicant(input.fileNumber, input.secret);
  if (!v) return { ok: false, error: "FORBIDDEN" };
  const doc = await prisma.document.findFirst({
    where: { id: input.documentId, ownerType: "ADMISSION" },
  });
  const app = doc ? v.group.find((a) => a.id === doc.ownerId) : undefined;
  if (!doc || !app) return { ok: false, error: "NOT_FOUND" };
  if (doc.status !== "ACTIVE") return { ok: false, error: "NOT_FOUND" };
  if (!APPLICANT_DOC_STATUSES.includes(app.status)) {
    return { ok: false, error: "INVALID_STATE" };
  }
  const res = await replaceDocumentVersion(
    doc,
    { buffer: input.buffer, originalName: input.originalName, category: doc.category },
    { userId: null, ip: input.ip },
  );
  if (!res.ok) return { ok: false, error: res.error };
  await logAudit({
    schoolId: app.schoolId,
    action: "admissions.document.replace",
    entity: "Document",
    entityId: res.result.id,
    metadata: { applicationId: app.id, previousId: doc.id, via: "suivi" },
  });
  return { ok: true, result: { id: res.result.id } };
}

/** Lecture d'une pièce par ticket signé — utilisée par la route publique. */
export async function readApplicantDocumentByTicket(token: string): Promise<
  | { ok: true; doc: Document; buffer: Buffer }
  | { ok: false; error: "NOT_FOUND" | "INTEGRITY_ERROR" | "CONFIG_ERROR" }
> {
  const t = verifyDocTicket(token);
  if (!t) return { ok: false, error: "NOT_FOUND" };
  const doc = await prisma.document.findFirst({
    where: {
      id: t.documentId,
      ownerType: "ADMISSION",
      ownerId: t.applicationId,
      status: "ACTIVE",
    },
  });
  if (!doc) return { ok: false, error: "NOT_FOUND" };
  const res = await readDocumentBuffer(doc);
  if (!res.ok) {
    if (res.error === "INTEGRITY_ERROR") {
      await logAudit({
        schoolId: doc.schoolId,
        action: "documents.integrity_error",
        entity: "Document",
        entityId: doc.id,
        metadata: { via: "suivi" },
      });
      return { ok: false, error: "INTEGRITY_ERROR" };
    }
    return { ok: false, error: "NOT_FOUND" };
  }
  await logAudit({
    schoolId: doc.schoolId,
    action: "documents.download",
    entity: "Document",
    entityId: doc.id,
    metadata: { via: "suivi" },
  });
  return { ok: true, doc, buffer: res.buffer };
}

// ---------- Back-office ----------

export async function listApplications(
  ctx: SchoolCtx,
  filters: {
    campaignId?: string;
    status?: AdmissionApplicationStatus;
    levelId?: string;
    q?: string;
  } = {},
) {
  return prisma.admissionApplication.findMany({
    where: {
      schoolId: ctx.schoolId,
      ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.levelId ? { targetLevelId: filters.levelId } : {}),
      ...(filters.q
        ? {
            OR: [
              { fileNumber: { contains: filters.q, mode: "insensitive" } },
              {
                candidateLastName: { contains: filters.q, mode: "insensitive" },
              },
              {
                candidateFirstName: { contains: filters.q, mode: "insensitive" },
              },
              { guardianPhone: { contains: filters.q } },
            ],
          }
        : {}),
    },
    include: {
      campaign: { select: { name: true } },
      targetLevel: { select: { name: true } },
    },
    orderBy: { submittedAt: "desc" },
    take: 200,
  });
}

export async function getApplicationDetail(ctx: SchoolCtx, id: string) {
  const app = await prisma.admissionApplication.findFirst({
    where: { id, schoolId: ctx.schoolId },
    include: {
      campaign: { select: { name: true, academicYear: { select: { name: true } } } },
      targetLevel: { select: { name: true } },
      targetClassroom: { select: { name: true } },
      events: { orderBy: { createdAt: "asc" } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!app) return null;
  const canReview = await hasPerm(ctx, "admissions.review");
  const documents = canReview
    ? await prisma.document.findMany({
        where: { ownerType: "ADMISSION", ownerId: app.id, status: { not: "PURGED" } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const duplicateOf = app.duplicateOfId
    ? await prisma.admissionApplication.findUnique({
        where: { id: app.duplicateOfId },
        select: { fileNumber: true },
      })
    : null;
  return { application: app, documents, canReview, duplicateOf };
}

/**
 * Transitions d'instruction. G2-B n'expose que SUBMITTED→UNDER_REVIEW et
 * les demandes de complément ; les décisions (`admissions.decide`) sont
 * prêtes pour G2-C — refus toujours motivé.
 */
const APPLICATION_TRANSITIONS: Record<
  AdmissionApplicationStatus,
  { from: AdmissionApplicationStatus[]; perm: string; noteRequired?: boolean }
> = {
  DRAFT: { from: [], perm: "admissions.manage" },
  SUBMITTED: { from: [], perm: "admissions.manage" },
  UNDER_REVIEW: {
    from: ["SUBMITTED", "ADDITIONAL_INFO_REQUIRED"],
    perm: "admissions.review",
  },
  ADDITIONAL_INFO_REQUIRED: {
    from: ["SUBMITTED", "UNDER_REVIEW"],
    perm: "admissions.review",
    noteRequired: true,
  },
  WAITLISTED: {
    from: ["SUBMITTED", "UNDER_REVIEW"],
    perm: "admissions.decide",
  },
  ACCEPTED: {
    from: ["UNDER_REVIEW", "WAITLISTED", "ADDITIONAL_INFO_REQUIRED"],
    perm: "admissions.decide",
  },
  CONDITIONALLY_ACCEPTED: {
    from: ["UNDER_REVIEW", "WAITLISTED", "ADDITIONAL_INFO_REQUIRED"],
    perm: "admissions.decide",
    noteRequired: true,
  },
  REJECTED: {
    from: [
      "SUBMITTED",
      "UNDER_REVIEW",
      "WAITLISTED",
      "ADDITIONAL_INFO_REQUIRED",
    ],
    perm: "admissions.decide",
    noteRequired: true,
  },
  CONVERTED: {
    from: ["ACCEPTED", "CONDITIONALLY_ACCEPTED"],
    perm: "admissions.decide",
  },
  WITHDRAWN: { from: [], perm: "admissions.manage" },
};

export async function transitionApplication(
  ctx: SchoolCtx,
  id: string,
  to: AdmissionApplicationStatus,
  note?: string,
): Promise<AdmissionsResult> {
  const rule = APPLICATION_TRANSITIONS[to];
  if (!rule || !rule.from.length) return { ok: false, error: "INVALID_STATE" };
  if (!(await hasPerm(ctx, rule.perm))) return { ok: false, error: "FORBIDDEN" };
  if (rule.noteRequired && !note?.trim()) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const app = await prisma.admissionApplication.findFirst({
    where: { id, schoolId: ctx.schoolId },
    select: { id: true, status: true, fileNumber: true },
  });
  if (!app) return { ok: false, error: "NOT_FOUND" };

  const updated = await prisma.admissionApplication.updateMany({
    where: { id: app.id, status: { in: rule.from } },
    data: {
      status: to,
      ...(to === "ADDITIONAL_INFO_REQUIRED"
        ? { infoRequestNote: note!.trim() }
        : {}),
      ...(to === "UNDER_REVIEW" ? { infoRequestNote: null } : {}),
      ...(["ACCEPTED", "CONDITIONALLY_ACCEPTED", "REJECTED"].includes(to)
        ? {
            decidedById: ctx.userId,
            decidedAt: new Date(),
            decisionReason: note?.trim() || null,
          }
        : {}),
    },
  });
  if (updated.count === 0) return { ok: false, error: "INVALID_STATE" };

  await prisma.admissionEvent.create({
    data: {
      schoolId: ctx.schoolId,
      applicationId: app.id,
      fromStatus: app.status,
      toStatus: to,
      actorId: ctx.userId,
      actorLabel: "administration",
      note: note?.trim() || null,
    },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: `admissions.application.${to.toLowerCase()}`,
    entity: "AdmissionApplication",
    entityId: app.id,
    metadata: { fileNumber: app.fileNumber, note: note?.trim() },
  });
  return { ok: true, result: undefined };
}

/** Révocation + régénération du code de suivi (compromission, perte). */
export async function rotateTrackingSecret(
  ctx: SchoolCtx,
  id: string,
): Promise<AdmissionsResult<{ secret: string }>> {
  if (!(await hasPerm(ctx, "admissions.manage"))) {
    return { ok: false, error: "FORBIDDEN" };
  }
  const app = await prisma.admissionApplication.findFirst({
    where: { id, schoolId: ctx.schoolId },
    select: { id: true, submissionGroupId: true },
  });
  if (!app) return { ok: false, error: "NOT_FOUND" };
  const secret = newTrackingSecret();
  await prisma.admissionApplication.updateMany({
    where: { submissionGroupId: app.submissionGroupId },
    data: { trackingHash: sha256(secret) },
  });
  await logAudit({
    actorId: ctx.userId,
    schoolId: ctx.schoolId,
    action: "admissions.tracking.rotate",
    entity: "AdmissionApplication",
    entityId: app.id,
  });
  return { ok: true, result: { secret } };
}
