import { NextResponse } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { sourceFromFormData } from "@/lib/import/source";
import { previewStudentsImport } from "@/lib/import/students";

/** Analyse d'un import élèves — lecture seule, aucune écriture. */
export async function POST(req: Request) {
  const tenant = await requireSchoolPermission("student.manage");
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };

  const formData = await req.formData();
  const academicYearId = String(formData.get("academicYearId") ?? "");
  if (!academicYearId) {
    return NextResponse.json(
      { error: "Année scolaire obligatoire" },
      { status: 400 },
    );
  }

  const src = await sourceFromFormData(formData);
  if (!src.ok) {
    return NextResponse.json({ error: src.error }, { status: 400 });
  }

  const res = await previewStudentsImport(ctx, src.source, academicYearId);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }
  return NextResponse.json(res.preview);
}
