import { NextResponse } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { sourceFromFormData } from "@/lib/import/source";
import { commitStudentsImport } from "@/lib/import/students";
import {
  consumePreviewToken,
  verifyPreviewToken,
} from "@/lib/import/token";

/**
 * Confirmation d'un import élèves : jeton d'aperçu vérifié, fichier
 * re-parsé côté serveur, empreinte re-comparée (modification concurrente
 * → 409 STALE), puis écritures via les services métier.
 */
export async function POST(req: Request) {
  const tenant = await requireSchoolPermission("student.manage");
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };

  const formData = await req.formData();
  const academicYearId = String(formData.get("academicYearId") ?? "");
  const token = String(formData.get("token") ?? "");
  if (!academicYearId || !token) {
    return NextResponse.json(
      { error: "Jeton d'aperçu et année scolaire obligatoires" },
      { status: 400 },
    );
  }

  const check = verifyPreviewToken(token, {
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    kind: "students",
  });
  if (!check.ok) {
    return NextResponse.json(
      {
        error:
          check.error === "EXPIRED"
            ? "Aperçu expiré — relancez l'analyse"
            : check.error === "USED"
              ? "Cet aperçu a déjà été confirmé"
              : "Jeton d'aperçu invalide",
      },
      { status: 409 },
    );
  }

  const src = await sourceFromFormData(formData);
  if (!src.ok) {
    return NextResponse.json({ error: src.error }, { status: 400 });
  }

  const res = await commitStudentsImport(
    ctx,
    src.source,
    academicYearId,
    check.previewHash,
  );
  if (!res.ok) {
    return NextResponse.json(
      {
        error:
          res.error === "STALE"
            ? "Les données ont changé depuis l'aperçu — relancez l'analyse"
            : res.error,
        stale: res.error === "STALE",
      },
      { status: res.error === "STALE" ? 409 : 400 },
    );
  }

  consumePreviewToken(check.jti, check.exp);
  return NextResponse.json(res.result);
}
