import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import {
  getDailyAttendance,
  listAttendance,
} from "@/lib/services/attendance";
import {
  saveDailyAttendanceAction,
  addAttendanceRecordAction,
  justifyAttendanceAction,
} from "@/app/app/(tenant)/attendance/actions";

export const instant = false;

const STATUS_LABEL: Record<string, string> = {
  PRESENT: "Présent",
  ABSENT: "Absent",
  LATE: "Retard",
  EXCUSED: "Excusé",
  UNMARKED: "Non renseigné",
};

function minToTime(min: number | null | undefined) {
  if (min == null) return "";
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export default async function AttendancePage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("attendance.read");
  const sp = (await props.searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;

  const classroomId = typeof sp.classroomId === "string" ? sp.classroomId : undefined;
  const date =
    typeof sp.date === "string" && sp.date
      ? sp.date
      : new Date().toISOString().slice(0, 10);
  const statusFilter =
    sp.status === "LATE" ? ("LATE" as const) : ("ABSENT" as const);
  const justifiedFilter =
    sp.justified === "true" ? true : sp.justified === "false" ? false : undefined;

  const [canManage, canJustify] = await Promise.all([
    userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "attendance.manage",
    }),
    userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "attendance.justify",
    }),
  ]);

  const [classrooms, students, daily, list] = await Promise.all([
    prisma.classroom.findMany({
      where: { schoolId: tenant.schoolId, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    canManage
      ? prisma.student.findMany({
          where: { schoolId: tenant.schoolId, status: "ACTIVE" },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          take: 500,
          select: { id: true, matricule: true, firstName: true, lastName: true },
        })
      : Promise.resolve([]),
    classroomId
      ? getDailyAttendance(
          { userId: tenant.userId, schoolId: tenant.schoolId },
          classroomId,
          date,
        )
      : Promise.resolve(null),
    listAttendance(
      { userId: tenant.userId, schoolId: tenant.schoolId },
      {
        status: statusFilter,
        classroomId,
        justified: justifiedFilter,
        pageSize: 100,
      },
    ),
  ]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Pédagogie</div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Présences, absences et retards
        </div>
        {ok ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {ok}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}
      </div>

      {/* Appel journalier */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-zinc-900">Appel journalier</div>
        <form method="GET" className="mt-3 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500">Classe</label>
            <select
              name="classroomId"
              defaultValue={classroomId ?? ""}
              className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
            >
              <option value="">Choisir…</option>
              {classrooms.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500">Date</label>
            <input
              name="date"
              type="date"
              defaultValue={date}
              className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
            />
          </div>
          <button
            type="submit"
            className="h-10 rounded-xl border border-zinc-200 px-4 text-sm hover:bg-zinc-50"
          >
            Charger
          </button>
        </form>

        {daily && canManage ? (
          <form action={saveDailyAttendanceAction} className="mt-4">
            <input type="hidden" name="classroomId" value={classroomId} />
            <input type="hidden" name="date" value={date} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                    <th className="py-2 pr-3">Matricule</th>
                    <th className="py-2 pr-3">Élève</th>
                    <th className="py-2 pr-3">Statut</th>
                    <th className="py-2 pr-3">Heure prévue</th>
                    <th className="py-2 pr-3">Arrivée</th>
                    <th className="py-2 pr-3">Motif</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.students.map((s) => {
                    const rec = daily.records.get(s.id);
                    const cur = rec?.status ?? null;
                    return (
                      <tr key={s.id} className="border-b border-zinc-100">
                        <td className="py-2 pr-3 text-zinc-600">{s.matricule}</td>
                        <td className="py-2 pr-3 font-medium text-zinc-900">
                          {s.lastName} {s.firstName}
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex flex-wrap items-center gap-3">
                            {(["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const).map(
                              (st) => (
                                <label
                                  key={st}
                                  className="flex items-center gap-1 text-xs text-zinc-700"
                                >
                                  <input
                                    type="radio"
                                    name={`status_${s.id}`}
                                    value={st}
                                    defaultChecked={
                                      cur === st || (!cur && st === "PRESENT")
                                    }
                                    className="accent-zinc-900"
                                  />
                                  {STATUS_LABEL[st]}
                                </label>
                              ),
                            )}
                          </div>
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            name={`expected_${s.id}`}
                            type="time"
                            defaultValue={minToTime(rec?.expectedMin)}
                            className="h-8 rounded-lg border border-zinc-200 px-2 text-xs"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            name={`arrival_${s.id}`}
                            type="time"
                            defaultValue={minToTime(rec?.arrivalMin)}
                            className="h-8 rounded-lg border border-zinc-200 px-2 text-xs"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            name={`reason_${s.id}`}
                            defaultValue={rec?.reason ?? ""}
                            className="h-8 w-36 rounded-lg border border-zinc-200 px-2 text-xs"
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {daily.students.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-zinc-500">
                        Aucun élève inscrit à cette date
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {daily.students.length > 0 ? (
              <button
                type="submit"
                className="mt-4 h-10 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Enregistrer l&#8217;appel
              </button>
            ) : null}
          </form>
        ) : null}
      </div>

      {/* Saisie manuelle absence/retard */}
      {canManage ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">
            Enregistrer une absence / un retard
          </div>
          <form action={addAttendanceRecordAction} className="mt-3">
            <div className="grid items-end gap-3 md:grid-cols-6">
              <select
                name="studentId"
                required
                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm md:col-span-2"
              >
                <option value="">Élève…</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.matricule} — {s.lastName} {s.firstName}
                  </option>
                ))}
              </select>
              <input
                name="date"
                type="date"
                defaultValue={date}
                required
                className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
              />
              <select
                name="status"
                defaultValue="ABSENT"
                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
              >
                <option value="ABSENT">Absence</option>
                <option value="LATE">Retard</option>
              </select>
              <div className="flex items-center gap-2">
                <input
                  name="expectedTime"
                  type="time"
                  title="Heure prévue"
                  className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm"
                />
                <input
                  name="arrivalTime"
                  type="time"
                  title="Heure d'arrivée"
                  className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm"
                />
              </div>
              <input
                name="reason"
                placeholder="Motif"
                className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
              />
            </div>
            <button
              type="submit"
              className="mt-3 h-10 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Enregistrer
            </button>
          </form>
        </div>
      ) : null}

      {/* Listes absences / retards */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium text-zinc-900">
            {statusFilter === "LATE" ? "Retards" : "Absences"} ({list.total})
          </div>
          <form method="GET" className="flex flex-wrap items-end gap-2">
            {classroomId ? (
              <input type="hidden" name="classroomId" value={classroomId} />
            ) : null}
            <input type="hidden" name="date" value={date} />
            <select
              name="status"
              defaultValue={statusFilter}
              className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-xs"
            >
              <option value="ABSENT">Absences</option>
              <option value="LATE">Retards</option>
            </select>
            <select
              name="justified"
              defaultValue={
                justifiedFilter === undefined
                  ? ""
                  : justifiedFilter
                    ? "true"
                    : "false"
              }
              className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-xs"
            >
              <option value="">Toutes</option>
              <option value="false">Non justifiées</option>
              <option value="true">Justifiées</option>
            </select>
            <button
              type="submit"
              className="h-9 rounded-lg border border-zinc-200 px-3 text-xs hover:bg-zinc-50"
            >
              Filtrer
            </button>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Élève</th>
                <th className="py-2 pr-3">Séance / Classe</th>
                <th className="py-2 pr-3">Détails</th>
                <th className="py-2 pr-3">Motif</th>
                <th className="py-2 pr-3">Justification</th>
                {canJustify ? <th className="py-2"></th> : null}
              </tr>
            </thead>
            <tbody>
              {list.items.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 align-top">
                  <td className="py-2 pr-3 text-zinc-600">
                    {r.date.toISOString().slice(0, 10)}
                  </td>
                  <td className="py-2 pr-3 font-medium text-zinc-900">
                    {r.student.lastName} {r.student.firstName}
                    <div className="text-xs text-zinc-500">
                      {r.student.matricule}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-zinc-700">
                    {r.session
                      ? `${r.session.classroom.name} — ${r.session.subject?.name ?? "cours"} (${minToTime(r.session.startMin)})`
                      : "Appel journalier"}
                  </td>
                  <td className="py-2 pr-3 text-zinc-700">
                    {r.status === "LATE"
                      ? `Prévu ${minToTime(r.expectedMin)} → ${minToTime(r.arrivalMin)}${r.durationMin != null ? ` (${r.durationMin} min)` : ""}`
                      : STATUS_LABEL[r.status]}
                  </td>
                  <td className="py-2 pr-3 text-zinc-700">{r.reason ?? "—"}</td>
                  <td className="py-2 pr-3 text-zinc-700">
                    {r.justification ?? (r.justifiedAt ? "Justifiée" : "—")}
                  </td>
                  {canJustify ? (
                    <td className="py-2">
                      {!r.justifiedAt &&
                      (r.status === "ABSENT" || r.status === "LATE") ? (
                        <form
                          action={justifyAttendanceAction}
                          className="flex items-center gap-2"
                        >
                          <input type="hidden" name="id" value={r.id} />
                          <input
                            name="justification"
                            required
                            placeholder="Justification"
                            className="h-8 w-40 rounded-lg border border-zinc-200 px-2 text-xs"
                          />
                          <button
                            type="submit"
                            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs hover:bg-zinc-50"
                          >
                            Justifier
                          </button>
                        </form>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
              {list.items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-zinc-500">
                    Aucun enregistrement
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
