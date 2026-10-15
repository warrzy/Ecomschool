import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import {
  getWeekTimetable,
  weekStart,
  minutesToLabel,
} from "@/lib/services/schedules";
import {
  createScheduleAction,
  updateScheduleAction,
  createSessionAction,
} from "@/app/app/(tenant)/schedules/actions";
import { openSessionAction } from "@/app/app/(tenant)/sessions/actions";

export const instant = false;

const DAYS: { key: string; label: string }[] = [
  { key: "MONDAY", label: "Lundi" },
  { key: "TUESDAY", label: "Mardi" },
  { key: "WEDNESDAY", label: "Mercredi" },
  { key: "THURSDAY", label: "Jeudi" },
  { key: "FRIDAY", label: "Vendredi" },
  { key: "SATURDAY", label: "Samedi" },
];

const PALETTE = [
  "bg-sky-100 border-sky-300 text-sky-900",
  "bg-emerald-100 border-emerald-300 text-emerald-900",
  "bg-amber-100 border-amber-300 text-amber-900",
  "bg-rose-100 border-rose-300 text-rose-900",
  "bg-violet-100 border-violet-300 text-violet-900",
  "bg-cyan-100 border-cyan-300 text-cyan-900",
  "bg-lime-100 border-lime-300 text-lime-900",
  "bg-orange-100 border-orange-300 text-orange-900",
];

function subjectColor(name: string | null) {
  if (!name) return "bg-zinc-100 border-zinc-300 text-zinc-800";
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997;
  return PALETTE[h % PALETTE.length];
}

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default async function SchedulesPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("schedules.read");
  const sp = (await props.searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;

  const view = (typeof sp.view === "string" ? sp.view : "establishment") as
    | "establishment"
    | "classroom"
    | "teacher"
    | "room";

  const weekParam = typeof sp.week === "string" ? sp.week : undefined;
  const ws = weekStart(weekParam ? new Date(weekParam) : new Date());
  const prevWeek = new Date(ws);
  prevWeek.setDate(prevWeek.getDate() - 7);
  const nextWeek = new Date(ws);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const academicYearId = typeof sp.year === "string" ? sp.year : undefined;
  const levelId = typeof sp.level === "string" ? sp.level : undefined;
  const classroomId =
    view === "classroom"
      ? typeof sp.id === "string"
        ? sp.id
        : undefined
      : typeof sp.classroom === "string"
        ? sp.classroom
        : undefined;
  const teacherId =
    view === "teacher"
      ? typeof sp.id === "string"
        ? sp.id
        : undefined
      : typeof sp.teacher === "string"
        ? sp.teacher
        : undefined;
  const roomId =
    view === "room"
      ? typeof sp.id === "string"
        ? sp.id
        : undefined
      : typeof sp.room === "string"
        ? sp.room
        : undefined;
  const subjectId = typeof sp.subject === "string" ? sp.subject : undefined;

  const canManage = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "schedules.manage",
  });
  const canPrint = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "schedules.print",
  });

  const [years, levels, classrooms, teachers, subjects, rooms, slots] =
    await Promise.all([
      prisma.academicYear.findMany({
        where: { schoolId: tenant.schoolId },
        orderBy: { startDate: "desc" },
        select: { id: true, name: true, status: true },
      }),
      prisma.level.findMany({
        where: { schoolId: tenant.schoolId },
        orderBy: { order: "asc" },
        select: { id: true, name: true },
      }),
      prisma.classroom.findMany({
        where: {
          schoolId: tenant.schoolId,
          ...(academicYearId ? { academicYearId } : {}),
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.teacher.findMany({
        where: { schoolId: tenant.schoolId, status: "ACTIVE" },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        select: { id: true, firstName: true, lastName: true },
      }),
      prisma.subject.findMany({
        where: { schoolId: tenant.schoolId, status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.room.findMany({
        where: { schoolId: tenant.schoolId, status: "ACTIVE" },
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true },
      }),
      getWeekTimetable(
        { schoolId: tenant.schoolId },
        {
          weekStart: ws,
          academicYearId,
          levelId,
          classroomId,
          teacherId,
          subjectId,
          roomId,
        },
      ),
    ]);

  const managedSchedules = canManage
    ? await prisma.courseSchedule.findMany({
        where: {
          schoolId: tenant.schoolId,
          status: "ACTIVE",
          ...(academicYearId ? { academicYearId } : {}),
          ...(classroomId ? { classroomId } : {}),
          ...(teacherId ? { teacherId } : {}),
          ...(roomId ? { roomId } : {}),
        },
        orderBy: [{ weekday: "asc" }, { startMin: "asc" }],
        take: 200,
        select: {
          id: true,
          weekday: true,
          startMin: true,
          endMin: true,
          validFrom: true,
          validUntil: true,
          classroom: { select: { name: true } },
          subject: { select: { name: true } },
          teacher: {
            select: { id: true, firstName: true, lastName: true },
          },
          roomId: true,
          room: { select: { name: true } },
        },
      })
    : [];

  // Grille : lignes = heures uniques des créneaux (+ 7h par défaut)
  const hourSet = new Set<number>();
  for (const s of slots) hourSet.add(Math.floor(s.startMin / 60));
  const hours = [...hourSet].sort((a, b) => a - b);

  const byDayHour = new Map<string, typeof slots>();
  for (const s of slots) {
    const key = `${s.weekday}|${Math.floor(s.startMin / 60)}`;
    const arr = byDayHour.get(key) ?? [];
    arr.push(s);
    byDayHour.set(key, arr);
  }

  const legendSubjects = [...new Set(slots.map((s) => s.subjectName).filter(Boolean))] as string[];

  const baseQuery = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    p.set("view", view);
    if (academicYearId) p.set("year", academicYearId);
    if (levelId) p.set("level", levelId);
    if (typeof sp.id === "string") p.set("id", sp.id);
    if (typeof sp.classroom === "string") p.set("classroom", sp.classroom);
    if (typeof sp.teacher === "string") p.set("teacher", sp.teacher);
    if (typeof sp.room === "string") p.set("room", sp.room);
    if (subjectId) p.set("subject", subjectId);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-zinc-500">Pédagogie</div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
              Emplois du temps
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <a
              href={baseQuery({ week: fmtDate(prevWeek) })}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 hover:bg-zinc-50"
            >
              ← Sem. précédente
            </a>
            <span className="font-medium text-zinc-900">
              {fmtDate(ws)} → {fmtDate(new Date(ws.getTime() + 6 * 86400000))}
            </span>
            <a
              href={baseQuery({ week: fmtDate(nextWeek) })}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 hover:bg-zinc-50"
            >
              Sem. suivante →
            </a>
            <a
              href={`/app/schedules/export?format=csv&${baseQuery({ week: fmtDate(ws) }).slice(1)}`}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 hover:bg-zinc-50"
            >
              CSV
            </a>
            <a
              href={`/app/schedules/export?format=xlsx&${baseQuery({ week: fmtDate(ws) }).slice(1)}`}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 hover:bg-zinc-50"
            >
              Excel
            </a>
            {canPrint ? (
              <a
                href={`/app/schedules/pdf${baseQuery({ week: fmtDate(ws) })}`}
                className="rounded-lg bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-800"
              >
                Exporter PDF
              </a>
            ) : null}
          </div>
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

      {/* Filtres */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="week" value={fmtDate(ws)} />
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500">Vue</label>
            <select
              name="view"
              defaultValue={view}
              className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
            >
              <option value="establishment">Établissement</option>
              <option value="classroom">Classe</option>
              <option value="teacher">Enseignant</option>
              <option value="room">Salle</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500">
              Année scolaire
            </label>
            <select
              name="year"
              defaultValue={academicYearId ?? ""}
              className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
            >
              <option value="">Toutes</option>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                  {y.status === "ACTIVE" ? " (courante)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500">Niveau</label>
            <select
              name="level"
              defaultValue={levelId ?? ""}
              className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
            >
              <option value="">Tous</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500">
              {view === "classroom" ? "Classe (obligatoire)" : "Classe"}
            </label>
            <select
              name={view === "classroom" ? "id" : "classroom"}
              defaultValue={classroomId ?? ""}
              className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
            >
              <option value="">Toutes</option>
              {classrooms.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500">
              {view === "teacher" ? "Enseignant (obligatoire)" : "Enseignant"}
            </label>
            <select
              name={view === "teacher" ? "id" : "teacher"}
              defaultValue={teacherId ?? ""}
              className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
            >
              <option value="">Tous</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.lastName} {t.firstName}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500">Matière</label>
            <select
              name="subject"
              defaultValue={subjectId ?? ""}
              className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
            >
              <option value="">Toutes</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500">
              {view === "room" ? "Salle (obligatoire)" : "Salle"}
            </label>
            <select
              name={view === "room" ? "id" : "room"}
              defaultValue={roomId ?? ""}
              className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
            >
              <option value="">Toutes</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} — {r.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="h-10 rounded-xl border border-zinc-200 px-4 text-sm hover:bg-zinc-50"
          >
            Appliquer
          </button>
        </form>
      </div>

      {/* Grille Lun–Sam */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="w-16 border-b border-zinc-200 py-2 text-left text-xs font-medium text-zinc-500">
                  Heure
                </th>
                {DAYS.map((d) => (
                  <th
                    key={d.key}
                    className="border-b border-zinc-200 py-2 text-left text-xs font-medium text-zinc-500"
                  >
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hours.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-zinc-500">
                    Aucun cours cette semaine
                  </td>
                </tr>
              ) : (
                hours.map((h) => (
                  <tr key={h} className="align-top">
                    <td className="border-b border-zinc-100 py-2 pr-2 text-xs text-zinc-500">
                      {String(h).padStart(2, "0")}h
                    </td>
                    {DAYS.map((d) => {
                      const cell = byDayHour.get(`${d.key}|${h}`) ?? [];
                      return (
                        <td
                          key={d.key}
                          className="border-b border-zinc-100 p-1"
                        >
                          {cell.map((s) => {
                            const cls = `block w-full rounded-lg border px-2 py-1.5 text-left text-xs ${subjectColor(s.subjectName)} ${s.status === "CANCELLED" ? "opacity-40 line-through" : ""} ${s.status === "POSTPONED" ? "opacity-60" : ""}`;
                            const title = `${s.subjectName ?? "Cours"} — ${s.teacherName}${s.roomName ? ` — ${s.roomName}` : ""}`;
                            if (s.source === "SESSION") {
                              return (
                                <a
                                  key={`S-${s.id}`}
                                  href={`/app/sessions/${s.id}`}
                                  title={title}
                                  className={`mb-1 ${cls}`}
                                >
                                  <SlotLabel slot={s} />
                                </a>
                              );
                            }
                            return (
                              <form
                                key={`R-${s.id}`}
                                action={openSessionAction}
                                className="mb-1"
                              >
                                <input
                                  type="hidden"
                                  name="scheduleId"
                                  value={s.scheduleId}
                                />
                                <input
                                  type="hidden"
                                  name="date"
                                  value={s.date}
                                />
                                <button
                                  type="submit"
                                  title={title}
                                  className={cls}
                                >
                                  <SlotLabel slot={s} />
                                </button>
                              </form>
                            );
                          })}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {legendSubjects.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-100 pt-3">
            {legendSubjects.map((name) => (
              <span
                key={name}
                className={`rounded-lg border px-2 py-1 text-xs ${subjectColor(name)}`}
              >
                {name}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Gestion des créneaux actifs */}
      {canManage ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">
            Créneaux actifs ({managedSchedules.length})
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                  <th className="py-2 pr-3">Jour</th>
                  <th className="py-2 pr-3">Horaire</th>
                  <th className="py-2 pr-3">Classe</th>
                  <th className="py-2 pr-3">Matière</th>
                  <th className="py-2 pr-3">Enseignant</th>
                  <th className="py-2 pr-3">Salle</th>
                  <th className="py-2 pr-3">Validité</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {managedSchedules.map((s) => {
                  const formId = `sched-${s.id}`;
                  return (
                    <tr key={s.id} className="border-b border-zinc-100 align-middle">
                      <td className="py-2 pr-3">
                        <form id={formId} action={updateScheduleAction}>
                          <input type="hidden" name="id" value={s.id} />
                        </form>
                        <select
                          form={formId}
                          name="weekday"
                          defaultValue={s.weekday}
                          className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-xs"
                        >
                          {DAYS.map((d) => (
                            <option key={d.key} value={d.key}>
                              {d.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          form={formId}
                          name="startTime"
                          type="time"
                          defaultValue={`${String(Math.floor(s.startMin / 60)).padStart(2, "0")}:${String(s.startMin % 60).padStart(2, "0")}`}
                          className="h-9 rounded-lg border border-zinc-200 px-2 text-xs"
                        />
                        <input
                          form={formId}
                          name="endTime"
                          type="time"
                          defaultValue={`${String(Math.floor(s.endMin / 60)).padStart(2, "0")}:${String(s.endMin % 60).padStart(2, "0")}`}
                          className="ml-1 h-9 rounded-lg border border-zinc-200 px-2 text-xs"
                        />
                      </td>
                      <td className="py-2 pr-3 text-zinc-700">{s.classroom.name}</td>
                      <td className="py-2 pr-3 text-zinc-700">{s.subject?.name ?? "—"}</td>
                      <td className="py-2 pr-3">
                        <select
                          form={formId}
                          name="teacherId"
                          defaultValue={s.teacher.id}
                          className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-xs"
                        >
                          {teachers.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.lastName} {t.firstName}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-3">
                        <select
                          form={formId}
                          name="roomId"
                          defaultValue={s.roomId ?? ""}
                          className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-xs"
                        >
                          <option value="">—</option>
                          {rooms.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.code} — {r.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-3 text-xs text-zinc-500">
                        {s.validFrom.toISOString().slice(0, 10)} →{" "}
                        {s.validUntil ? s.validUntil.toISOString().slice(0, 10) : "∞"}
                      </td>
                      <td className="py-2">
                        <button
                          form={formId}
                          type="submit"
                          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs hover:bg-zinc-50"
                        >
                          Enregistrer
                        </button>
                        <form action={updateScheduleAction} className="mt-1">
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="status" value="ARCHIVED" />
                          <button
                            type="submit"
                            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
                          >
                            Archiver
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
                {managedSchedules.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-zinc-500">
                      Aucun créneau actif
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Création de créneau + séance ponctuelle */}
      {canManage ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-medium text-zinc-900">
              Nouveau créneau récurrent
            </div>
            <form action={createScheduleAction} className="mt-4 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <select
                  name="academicYearId"
                  required
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                >
                  <option value="">Année scolaire…</option>
                  {years.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.name}
                    </option>
                  ))}
                </select>
                <select
                  name="classroomId"
                  required
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                >
                  <option value="">Classe…</option>
                  {classrooms.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  name="teacherId"
                  required
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                >
                  <option value="">Enseignant…</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.lastName} {t.firstName}
                    </option>
                  ))}
                </select>
                <select
                  name="subjectId"
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                >
                  <option value="">Matière…</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <select
                  name="roomId"
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                >
                  <option value="">Salle…</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code} — {r.name}
                    </option>
                  ))}
                </select>
                <select
                  name="weekday"
                  required
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                >
                  {DAYS.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <input
                    name="startTime"
                    type="time"
                    required
                    className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm"
                  />
                  <input
                    name="endTime"
                    type="time"
                    required
                    className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    name="validFrom"
                    type="date"
                    required
                    className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm"
                  />
                  <input
                    name="validUntil"
                    type="date"
                    className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="h-10 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Créer le créneau
              </button>
            </form>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-medium text-zinc-900">
              Séance ponctuelle
            </div>
            <form action={createSessionAction} className="mt-4 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <select
                  name="classroomId"
                  required
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                >
                  <option value="">Classe…</option>
                  {classrooms.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  name="teacherId"
                  required
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                >
                  <option value="">Enseignant…</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.lastName} {t.firstName}
                    </option>
                  ))}
                </select>
                <select
                  name="subjectId"
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                >
                  <option value="">Matière…</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <select
                  name="roomId"
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                >
                  <option value="">Salle…</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code} — {r.name}
                    </option>
                  ))}
                </select>
                <input
                  name="date"
                  type="date"
                  required
                  className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
                />
                <div className="flex items-center gap-2">
                  <input
                    name="startTime"
                    type="time"
                    required
                    className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm"
                  />
                  <input
                    name="endTime"
                    type="time"
                    required
                    className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="h-10 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Créer la séance
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SlotLabel({
  slot,
}: {
  slot: {
    startMin: number;
    endMin: number;
    subjectName: string | null;
    classroomName: string;
    teacherName: string;
    roomName: string | null;
    status: string | null;
  };
}) {
  return (
    <span>
      <span className="block font-medium">
        {slot.subjectName ?? "Cours"}
      </span>
      <span className="block opacity-80">
        {minutesToLabel(slot.startMin)}–{minutesToLabel(slot.endMin)} ·{" "}
        {slot.classroomName}
      </span>
      <span className="block opacity-70">
        {slot.teacherName}
        {slot.roomName ? ` · ${slot.roomName}` : ""}
      </span>
      {slot.status && slot.status !== "PLANNED" && slot.status !== "DONE" ? (
        <span className="block font-medium">
          {slot.status === "CANCELLED"
            ? "Annulé"
            : slot.status === "POSTPONED"
              ? "Reporté"
              : ""}
        </span>
      ) : null}
    </span>
  );
}
