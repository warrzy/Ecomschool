import { NextRequest, NextResponse } from "next/server";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import {
  buildSchedulesExport,
  SCHEDULE_HEADERS,
  WEEK_HEADERS,
} from "@/lib/export/schedules";
import { exportFile } from "@/lib/export/respond";
import { weekStart } from "@/lib/services/schedules";

/**
 * GET /app/schedules/export?format=csv|xlsx&week&year&classroom&teacher&level
 * Sans week : créneaux récurrents. Avec week : semaine réelle
 * (séances déplacées/annulées appliquées — même moteur que l'écran).
 * Sans schedules.manage : périmètre strict de l'enseignant connecté.
 */
export async function GET(req: NextRequest) {
  const tenant = await requireSchoolPermission("schedules.read");
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };
  const asTeacher = !(await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "schedules.manage",
  }));

  const url = new URL(req.url);
  const p = (k: string) => url.searchParams.get(k) || undefined;
  const weekParam = p("week");
  if (weekParam && Number.isNaN(new Date(weekParam).getTime())) {
    return new NextResponse("Paramètre week invalide (attendu : date).", {
      status: 400,
    });
  }
  // La page EDT filtre via view+id — mêmes paramètres acceptés ici.
  const view = p("view");
  const viewId = p("id");

  const res = await buildSchedulesExport(
    ctx,
    {
      academicYearId: p("year"),
      classroomId:
        p("classroom") ?? (view === "classroom" ? viewId : undefined),
      teacherId: p("teacher") ?? (view === "teacher" ? viewId : undefined),
      levelId: p("level"),
      weekStart: weekParam ? weekStart(new Date(weekParam)) : undefined,
    },
    { asTeacher },
  );
  if (!res.ok) {
    return new NextResponse("Accès refusé : hors de votre périmètre.", {
      status: 403,
    });
  }

  const { rows, truncated, week } = res.result;
  return exportFile({
    format: p("format") === "xlsx" ? "xlsx" : "csv",
    filename: week ? "edt-semaine" : "edt-creneaux",
    sheets: [
      {
        name: week ? "Semaine" : "Créneaux",
        headers: week ? WEEK_HEADERS : SCHEDULE_HEADERS,
        rows,
      },
    ],
    truncated,
  });
}
