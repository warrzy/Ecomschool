import { NextResponse } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { exportFile } from "@/lib/export/respond";
import { getGradeGrid } from "@/lib/services/grading/grades";
import { GRADE_TEMPLATE_HEADERS } from "@/lib/import/grades";
import { prisma } from "@/lib/db/prisma";
import { teacherIdForUser } from "@/lib/services/attendance";
import { teacherAllowed } from "@/lib/services/grading/assessments";

/**
 * Modèle de saisie des notes pour l'évaluation {id} : pré-rempli avec les
 * élèves inscrits à sa date (même périmètre que la grille de saisie).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const tenant = await requireSchoolPermission("grades.enter");
  const { id } = await params;
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const format =
    new URL(req.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  const assessment = await prisma.assessment.findFirst({
    where: { id, schoolId: ctx.schoolId },
    select: {
      id: true,
      title: true,
      maxScore: true,
      classroomId: true,
      subjectId: true,
    },
  });
  if (!assessment) return new NextResponse("Not found", { status: 404 });

  const asTeacher = !(await userHasSchoolPermission({
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    permissionKey: "assessments.manage",
  }));
  if (asTeacher) {
    const tid = await teacherIdForUser(ctx);
    if (
      !tid ||
      !(await teacherAllowed(ctx, tid, assessment.classroomId, assessment.subjectId))
    ) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  const grid = await getGradeGrid(ctx, assessment.id);
  let rows: (string | number | null)[][] = [];
  if (grid.ok && grid.result.rows.length > 0) {
    const students = await prisma.student.findMany({
      where: {
        schoolId: ctx.schoolId,
        matricule: { in: grid.result.rows.map((r) => r.matricule) },
      },
      select: { matricule: true, lastName: true, firstName: true },
    });
    const byMat = new Map(students.map((s) => [s.matricule, s]));
    rows = grid.result.rows.map((r) => {
      const s = byMat.get(r.matricule);
      return [r.matricule, s?.lastName ?? "", s?.firstName ?? "", "", "", ""];
    });
  }

  return exportFile({
    format,
    filename: `modele-notes-${assessment.id}`,
    sheets: [
      {
        name: "Notes",
        headers: GRADE_TEMPLATE_HEADERS,
        widths: [14, 18, 18, 10, 12, 30],
        rows,
      },
      {
        name: "Lisez-moi",
        headers: ["Règle"],
        widths: [90],
        rows: [
          [`Évaluation : ${assessment.title} — barème 0 à ${assessment.maxScore}.`],
          ["statut : ENTERED, MISSING, ABSENT ou EXEMPT (vide = ENTERED si note, sinon MISSING)."],
          ["ENTERED exige une note dans le barème ; les autres statuts exigent une note vide."],
          ["Seuls les élèves inscrits dans la classe à la date de l'évaluation sont acceptés."],
        ],
      },
    ],
  });
}
