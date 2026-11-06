"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { respondSchoolRequest } from "@/lib/services/parent-requests";

const back = (path: string): never => redirect(path as never);

const respondSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["IN_PROGRESS", "RESOLVED", "REJECTED"]),
  response: z.string().trim().max(4000).optional(),
});

/** Traitement d'une demande parent : statut + réponse (humain, audité). */
export async function respondRequestAction(formData: FormData) {
  const tenant = await requireSchoolPermission("administrative-requests.manage");
  const parsed = respondSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return back("/app/demandes?error=INVALID_INPUT");
  const res = await respondSchoolRequest(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    {
      id: parsed.data.id,
      status: parsed.data.status,
      response: parsed.data.response || undefined,
    },
  );
  return back(
    res.ok
      ? "/app/demandes?ok=responded"
      : `/app/demandes?error=${res.error}`,
  );
}
