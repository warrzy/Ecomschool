import { NextResponse } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { sourceFromFormData } from "@/lib/import/source";
import { previewGradesImport } from "@/lib/import/grades";

/** Analyse d'un import de notes — lecture seule, aucune écriture. */
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

  const src = await sourceFromFormData(await req.formData());
  if (!src.ok) {
    return NextResponse.json({ error: src.error }, { status: 400 });
  }

  const res = await previewGradesImport(ctx, id, src.source, { asTeacher });
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }
  return NextResponse.json(res.preview);
}
