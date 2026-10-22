"use server";

import { redirect } from "next/navigation";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  deleteDocument,
  replaceDocument,
  uploadDocument,
} from "@/lib/services/documents";
import { MAX_DOCUMENT_BYTES } from "@/lib/services/documents";
import { z } from "zod";
import { idField, optionalText, requiredText } from "@/lib/validations/form";

function ctx(t: { userId: string; schoolId: string }) {
  return { userId: t.userId, schoolId: t.schoolId };
}

const back = (path: string): never => redirect(path as never);

async function fileFromFormData(formData: FormData) {
  const file = formData.get("file");
  // Détection structurelle : `instanceof File` est fragile selon le
  // runtime d'exécution des server actions.
  const isFile =
    typeof file === "object" &&
    file !== null &&
    typeof (file as File).arrayBuffer === "function" &&
    typeof (file as File).size === "number" &&
    typeof (file as File).name === "string";
  if (!isFile || (file as File).size === 0) return null;
  if ((file as File).size > MAX_DOCUMENT_BYTES) return { tooLarge: true as const };
  return {
    buffer: Buffer.from(await (file as File).arrayBuffer()),
    name: (file as File).name,
  };
}

export async function uploadDocumentAction(formData: FormData) {
  const tenant = await requireSchoolPermission("documents.upload");
  const file = await fileFromFormData(formData);
  if (!file) return back("/app/documents?error=INVALID_INPUT");
  if ("tooLarge" in file) return back("/app/documents?error=FILE_TOO_LARGE");

  const parsed = z
    .object({
      category: requiredText.max(40),
      label: optionalText,
      description: optionalText,
    })
    .safeParse({
      category: formData.get("category"),
      label: formData.get("label") ?? "",
      description: formData.get("description") ?? "",
    });
  if (!parsed.success) return back("/app/documents?error=INVALID_INPUT");

  const res = await uploadDocument(ctx(tenant), {
    buffer: file.buffer,
    originalName: file.name,
    category: parsed.data.category,
    ownerType: "STANDALONE",
    label: parsed.data.label || undefined,
    description: parsed.data.description || undefined,
  });
  back(res.ok ? "/app/documents?ok=uploaded" : `/app/documents?error=${res.error}`);
}

export async function replaceDocumentAction(formData: FormData) {
  const tenant = await requireSchoolPermission("documents.upload");
  const id = String(formData.get("id") ?? "");
  const file = await fileFromFormData(formData);
  if (!id) return back("/app/documents?error=INVALID_INPUT");
  if (!file) return back("/app/documents?error=INVALID_INPUT");
  if ("tooLarge" in file) return back("/app/documents?error=FILE_TOO_LARGE");

  const res = await replaceDocument(ctx(tenant), id, {
    buffer: file.buffer,
    originalName: file.name,
    category: String(formData.get("category") ?? ""),
  });
  back(res.ok ? "/app/documents?ok=replaced" : `/app/documents?error=${res.error}`);
}

export async function deleteDocumentAction(formData: FormData) {
  const tenant = await requireSchoolPermission("documents.read");
  const parsed = z
    .object({ id: idField, reason: requiredText.max(300) })
    .safeParse({ id: formData.get("id"), reason: formData.get("reason") });
  if (!parsed.success) return back("/app/documents?error=INVALID_INPUT");
  const res = await deleteDocument(ctx(tenant), parsed.data.id, {
    reason: parsed.data.reason,
  });
  back(res.ok ? "/app/documents?ok=deleted" : `/app/documents?error=${res.error}`);
}
