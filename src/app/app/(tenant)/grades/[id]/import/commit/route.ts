import { NextResponse } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { sourceFromFormData } from "@/lib/import/source";
import { commitGradesImport } from "@/lib/import/grades";
import {
  consumePreviewToken,
  verifyPreviewToken,
} from "@/lib/import/token";

/**
 * Confirmation d'un import de notes : jeton vérifié, fichier re-parsé,
 * empreinte re-comparée (409 si l'état a changé), puis saveGrades —
 * transaction atomique, GradeRevision et audit préservés.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const tenant = await requireSchoolPermission("grades.enter");
  const { id } = await params;
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const asTeacher = !(await userHasSchoolPermission({
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    permissionKey: "assessments.manage",
  }));

  const formData = await req.formData();
  const token = String(formData.get("token") ?? "");
  if (!token) {
    return NextResponse.json(
      { error: "Jeton d'aperçu obligatoire" },
      { status: 400 },
    );
  }

  const check = verifyPreviewToken(token, {
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    kind: "grades",
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

  const res = await commitGradesImport(
    ctx,
    id,
    src.source,
    check.previewHash,
    { asTeacher },
  );
  if (!res.ok) {
    const status =
      res.error === "STALE"
        ? 409
        : res.error === "HAS_ERRORS"
          ? 422
          : res.error === "FORBIDDEN"
            ? 403
            : res.error === "LOCKED"
              ? 409
              : 400;
    const message =
      res.error === "STALE"
        ? "Les données ont changé depuis l'aperçu — relancez l'analyse"
        : res.error === "HAS_ERRORS"
          ? "Des lignes sont en erreur : import atomique refusé"
          : res.error === "LOCKED"
            ? "Évaluation verrouillée"
            : res.error === "FORBIDDEN"
              ? "Évaluation hors de votre périmètre"
              : res.error;
    return NextResponse.json(
      { error: message, stale: res.error === "STALE" },
      { status },
    );
  }

  consumePreviewToken(check.jti, check.exp);
  return NextResponse.json(res.result);
}
