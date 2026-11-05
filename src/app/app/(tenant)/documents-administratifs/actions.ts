"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import {
  issueAdministrativeDocument,
  reissueAdministrativeDocument,
  revokeAdministrativeDocument,
} from "@/lib/services/administrative-docs";
import { idField, requiredText } from "@/lib/validations/form";

function ctx(t: { userId: string; schoolId: string }) {
  return { userId: t.userId, schoolId: t.schoolId };
}

const back = (path: string): never => redirect(path as never);

export async function issueAdminDocAction(formData: FormData) {
  const tenant = await requireSchoolPermission("administrative-docs.issue");
  const parsed = z
    .object({
      studentId: idField,
      type: z.enum([
        "ATTESTATION_INSCRIPTION",
        "CERTIFICAT_SCOLAIRE",
        "CARTE_SCOLAIRE",
      ]),
      academicYearId: idField.optional(),
    })
    .safeParse({
      studentId: formData.get("studentId"),
      type: formData.get("type"),
      academicYearId: formData.get("academicYearId") || undefined,
    });
  if (!parsed.success) return back("/app/documents-administratifs?error=INVALID_INPUT");

  const r = await issueAdministrativeDocument(ctx(tenant), parsed.data);
  return r.ok
    ? back(`/app/documents-administratifs?ok=ISSUED_${encodeURIComponent(r.data.number)}`)
    : back(`/app/documents-administratifs?error=${r.error}`);
}

export async function revokeAdminDocAction(formData: FormData) {
  const tenant = await requireSchoolPermission("administrative-docs.issue");
  const parsed = z
    .object({ id: idField, reason: requiredText.max(200) })
    .safeParse({ id: formData.get("id"), reason: formData.get("reason") });
  if (!parsed.success) return back("/app/documents-administratifs?error=INVALID_INPUT");

  const r = await revokeAdministrativeDocument(ctx(tenant), parsed.data.id, {
    reason: parsed.data.reason,
  });
  return r.ok
    ? back("/app/documents-administratifs?ok=REVOKED")
    : back(`/app/documents-administratifs?error=${r.error}`);
}

export async function reissueAdminDocAction(formData: FormData) {
  const tenant = await requireSchoolPermission("administrative-docs.issue");
  const parsed = z.object({ id: idField }).safeParse({ id: formData.get("id") });
  if (!parsed.success) return back("/app/documents-administratifs?error=INVALID_INPUT");

  const r = await reissueAdministrativeDocument(ctx(tenant), parsed.data.id);
  return r.ok
    ? back(`/app/documents-administratifs?ok=ISSUED_${encodeURIComponent(r.data.number)}`)
    : back(`/app/documents-administratifs?error=${r.error}`);
}
