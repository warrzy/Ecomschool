"use server";

import { headers } from "next/headers";
import { throttleKey } from "@/lib/auth/ratelimit";
import {
  applicantReplaceDocument,
  applicantUploadDocument,
  getTrackingView,
  submitApplication,
  withdrawApplication,
  type ApplicationChildInput,
  type ApplicationFileInput,
} from "@/lib/services/admissions";
import { MAX_DOCUMENT_BYTES } from "@/lib/services/documents";
import { errorMessage } from "@/lib/ui/errorLabels";

async function clientIp() {
  return (
    (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

type ActionResult<T = undefined> =
  | { ok: true; result: T }
  | { ok: false; error: string; message: string };

const fail = (error: string): ActionResult<never> => ({
  ok: false,
  error,
  message: errorMessage(error),
});

const RATE_LIMITED: ActionResult<never> = {
  ok: false,
  error: "RATE_LIMITED",
  message: "Trop de tentatives — réessayez dans quelques instants.",
};

function isFile(v: unknown): v is File {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as File).arrayBuffer === "function" &&
    typeof (v as File).size === "number" &&
    typeof (v as File).name === "string"
  );
}

/**
 * Soumission publique d'une ou plusieurs candidatures (même responsable).
 * Sécurité : honeypot `website`, throttle IP, validation serveur complète
 * dans le service (fenêtre de campagne, cibles, pièces exigées).
 */
export async function submitApplicationAction(
  formData: FormData,
): Promise<
  ActionResult<{
    fileNumbers: string[];
    trackingSecret?: string;
    reusedGroup: boolean;
  }>
> {
  // Honeypot — un bot qui remplit le champ invisible reçoit un faux succès.
  if (String(formData.get("website") ?? "").length > 0) {
    return {
      ok: true,
      result: {
        fileNumbers: ["DOS-0000-00000"],
        trackingSecret: undefined,
        reusedGroup: false,
      },
    };
  }

  const ip = await clientIp();
  if (!throttleKey(`adm:submit:${ip}`)) return RATE_LIMITED;

  // Validation explicite obligatoire : déclaration d'exactitude +
  // prise de connaissance de la notice de traitement des données.
  if (formData.get("confirmAccuracy") !== "1") return fail("INVALID_INPUT");

  let children: ApplicationChildInput[] = [];
  try {
    const raw = String(formData.get("children") ?? "[]");
    const parsed = JSON.parse(raw) as ApplicationChildInput[];
    if (!Array.isArray(parsed)) return fail("INVALID_INPUT");
    children = parsed.map((c) => ({
      firstName: String(c.firstName ?? "").slice(0, 80),
      lastName: String(c.lastName ?? "").slice(0, 80),
      birthDate: c.birthDate ? String(c.birthDate).slice(0, 10) : undefined,
      birthPlace: c.birthPlace ? String(c.birthPlace).slice(0, 120) : undefined,
      sex: c.sex === "MALE" || c.sex === "FEMALE" ? c.sex : undefined,
      previousSchool: c.previousSchool
        ? String(c.previousSchool).slice(0, 160)
        : undefined,
      targetLevelId: c.targetLevelId
        ? String(c.targetLevelId).slice(0, 40)
        : undefined,
      targetClassroomId: c.targetClassroomId
        ? String(c.targetClassroomId).slice(0, 40)
        : undefined,
      targetTraining: c.targetTraining
        ? String(c.targetTraining).slice(0, 120)
        : undefined,
    }));
  } catch {
    return fail("INVALID_INPUT");
  }

  const files: ApplicationFileInput[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("doc_") || !isFile(value) || value.size === 0) {
      continue;
    }
    if (value.size > MAX_DOCUMENT_BYTES) return fail("FILE_TOO_LARGE");
    // doc_<enfant>_<clé> — la clé est revérifiée contre la campagne côté service.
    const rest = key.slice(4);
    const sep = rest.indexOf("_");
    if (sep <= 0) return fail("INVALID_INPUT");
    files.push({
      childIndex: Number(rest.slice(0, sep)),
      docKey: rest.slice(sep + 1),
      category: String(formData.get(`cat_${rest}`) ?? "JUSTIFICATIF"),
      buffer: Buffer.from(await value.arrayBuffer()),
      originalName: value.name,
    });
  }

  const res = await submitApplication({
    campaignId: String(formData.get("campaignId") ?? ""),
    selfApplicant: formData.get("selfApplicant") === "1",
    guardianFirstName: String(formData.get("guardianFirstName") ?? "") || undefined,
    guardianLastName: String(formData.get("guardianLastName") ?? "") || undefined,
    guardianRelation: String(formData.get("guardianRelation") ?? "") || undefined,
    guardianPhone: String(formData.get("guardianPhone") ?? ""),
    guardianEmail: String(formData.get("guardianEmail") ?? "") || undefined,
    guardianAddress: String(formData.get("guardianAddress") ?? "") || undefined,
    secondaryContact: String(formData.get("secondaryContact") ?? "") || undefined,
    children,
    files,
    ip,
    groupFileNumber: String(formData.get("groupFileNumber") ?? "") || undefined,
    groupSecret: String(formData.get("groupSecret") ?? "") || undefined,
  });

  if (!res.ok) return fail(res.error);
  return { ok: true, result: res.result };
}

/** Suivi sécurisé : numéro de dossier + code, throttle IP + dossier. */
export async function lookupTrackingAction(input: {
  fileNumber: string;
  secret: string;
}) {
  const ip = await clientIp();
  if (
    !throttleKey(`adm:track:${ip}`) ||
    !throttleKey(`adm:track:${input.fileNumber}`)
  ) {
    return RATE_LIMITED;
  }
  const view = await getTrackingView({
    fileNumber: input.fileNumber.trim(),
    secret: input.secret.trim(),
    ip,
  });
  if (!view) return fail("NOT_FOUND");
  return { ok: true as const, result: view };
}

/** Coordonnées du responsable pour « ajouter un autre enfant ». */
export async function getGroupContactAction(input: {
  fileNumber: string;
  secret: string;
}) {
  const ip = await clientIp();
  if (
    !throttleKey(`adm:track:${ip}`) ||
    !throttleKey(`adm:track:${input.fileNumber}`)
  ) {
    return RATE_LIMITED;
  }
  const view = await getTrackingView({
    fileNumber: input.fileNumber.trim(),
    secret: input.secret.trim(),
    ip,
  });
  if (!view || !view.applications.length) return fail("NOT_FOUND");
  // Coordonnées du responsable : récupérées via le premier dossier du groupe.
  const { prisma } = await import("@/lib/db/prisma");
  const app = await prisma.admissionApplication.findUnique({
    where: { id: view.applications[0]!.id },
    select: {
      guardianFirstName: true,
      guardianLastName: true,
      guardianRelation: true,
      guardianPhone: true,
      guardianEmail: true,
      guardianAddress: true,
      secondaryContact: true,
      selfApplicant: true,
      school: { select: { slug: true } },
    },
  });
  if (!app) return fail("NOT_FOUND");
  return { ok: true as const, result: app };
}

export async function applicantUploadAction(formData: FormData) {
  const ip = await clientIp();
  if (!throttleKey(`adm:doc:${ip}`)) return RATE_LIMITED;
  const file = formData.get("file");
  if (!isFile(file) || file.size === 0) return fail("INVALID_INPUT");
  if (file.size > MAX_DOCUMENT_BYTES) return fail("FILE_TOO_LARGE");
  const res = await applicantUploadDocument({
    fileNumber: String(formData.get("fileNumber") ?? "").trim(),
    secret: String(formData.get("secret") ?? "").trim(),
    applicationId: String(formData.get("applicationId") ?? ""),
    category: String(formData.get("category") ?? "JUSTIFICATIF"),
    label: String(formData.get("label") ?? "") || undefined,
    buffer: Buffer.from(await file.arrayBuffer()),
    originalName: file.name,
    ip,
  });
  if (!res.ok) return fail(res.error);
  return { ok: true as const, result: res.result };
}

export async function applicantReplaceAction(formData: FormData) {
  const ip = await clientIp();
  if (!throttleKey(`adm:doc:${ip}`)) return RATE_LIMITED;
  const file = formData.get("file");
  if (!isFile(file) || file.size === 0) return fail("INVALID_INPUT");
  if (file.size > MAX_DOCUMENT_BYTES) return fail("FILE_TOO_LARGE");
  const res = await applicantReplaceDocument({
    fileNumber: String(formData.get("fileNumber") ?? "").trim(),
    secret: String(formData.get("secret") ?? "").trim(),
    documentId: String(formData.get("documentId") ?? ""),
    buffer: Buffer.from(await file.arrayBuffer()),
    originalName: file.name,
    ip,
  });
  if (!res.ok) return fail(res.error);
  return { ok: true as const, result: res.result };
}

export async function withdrawApplicationAction(input: {
  fileNumber: string;
  secret: string;
  applicationId: string;
  reason?: string;
}) {
  const ip = await clientIp();
  if (!throttleKey(`adm:track:${input.fileNumber}`)) return RATE_LIMITED;
  const res = await withdrawApplication({ ...input, ip });
  if (!res.ok) return fail(res.error);
  return { ok: true as const, result: res.result };
}
