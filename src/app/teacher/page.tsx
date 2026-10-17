import Link from "next/link";
import { requireSchoolContext } from "@/lib/tenant/context";
import { prisma } from "@/lib/db/prisma";
import { teacherIdForUser } from "@/lib/services/attendance";
import { weekStart, minutesToLabel } from "@/lib/services/schedules";
import { statusLabel } from "@/lib/ui/statusLabels";
import { DashCard, KpiCard } from "@/components/ui/dash";

export const instant = false;

const DAY_LABEL: Record<string, string> = {
  MONDAY: "Lun",
  TUESDAY: "Mar",
  WEDNESDAY: "Mer",
  THURSDAY: "Jeu",
  FRIDAY: "Ven",
  SATURDAY: "Sam",
  SUNDAY: "Dim",
};

export default async function TeacherDashboardPage() {
  const tenant = await requireSchoolContext();
  const ctx = { userId: tenant.userId, schoolId: tenant.schoolId };

  const teacherId = await teacherIdForUser(ctx);
  const teacher = teacherId
    ? await prisma.teacher.findUnique({
        where: { id: teacherId },
        select: { firstName: true, lastName: true },
      })
    : null;

  if (!teacherId) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <h1 className="text-xl font-display font-bold tracking-tight text-ink">
          Espace enseignant
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          Votre compte n&#8217;est pas rattaché à une fiche enseignant dans cet
          établissement. Contactez l&#8217;administration.
        </p>
      </div>
    );
  }

  const today = new Date();
  const dayStart = new Date(today);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  const ws = weekStart(today);
  const we = new Date(ws.getTime() + 7 * 86400000);

  const [sessionsToday, sessionsWeek, upcoming, schedules, toCall, toWrite, myAssessments] =
    await Promise.all([
      prisma.courseSession.findMany({
        where: {
          schoolId: tenant.schoolId,
          teacherId,
          date: { gte: dayStart, lt: dayEnd },
          status: { not: "CANCELLED" },
        },
        orderBy: { startMin: "asc" },
        select: {
          id: true,
          startMin: true,
          endMin: true,
          status: true,
          subject: { select: { name: true } },
          classroom: { select: { name: true } },
          room: { select: { name: true } },
          _count: { select: { attendance: true } },
        },
      }),
      prisma.courseSession.findMany({
        where: {
          schoolId: tenant.schoolId,
          teacherId,
          date: { gte: ws, lt: we },
          status: { not: "CANCELLED" },
        },
        orderBy: [{ date: "asc" }, { startMin: "asc" }],
        select: {
          id: true,
          date: true,
          startMin: true,
          endMin: true,
          subject: { select: { name: true } },
          classroom: { select: { name: true } },
        },
      }),
      prisma.courseSession.findMany({
        where: {
          schoolId: tenant.schoolId,
          teacherId,
          date: { gte: dayEnd },
          status: "PLANNED",
        },
        orderBy: [{ date: "asc" }, { startMin: "asc" }],
        take: 10,
        select: {
          id: true,
          date: true,
          startMin: true,
          endMin: true,
          subject: { select: { name: true } },
          classroom: { select: { name: true } },
        },
      }),
      prisma.courseSchedule.findMany({
        where: { schoolId: tenant.schoolId, teacherId, status: "ACTIVE" },
        select: { classroom: { select: { id: true, name: true } } },
      }),
      prisma.courseSession.findMany({
        where: {
          schoolId: tenant.schoolId,
          teacherId,
          status: { in: ["PLANNED", "DONE"] },
          date: { lte: dayEnd },
          attendance: { none: {} },
        },
        orderBy: [{ date: "desc" }],
        take: 10,
        select: {
          id: true,
          date: true,
          startMin: true,
          subject: { select: { name: true } },
          classroom: { select: { name: true } },
        },
      }),
      prisma.courseSession.findMany({
        where: {
          schoolId: tenant.schoolId,
          teacherId,
          status: { in: ["PLANNED", "DONE"] },
          date: { lte: dayEnd },
          content: null,
        },
        orderBy: [{ date: "desc" }],
        take: 10,
        select: {
          id: true,
          date: true,
          startMin: true,
          subject: { select: { name: true } },
          classroom: { select: { name: true } },
        },
      }),
      prisma.assessment.findMany({
        where: {
          schoolId: tenant.schoolId,
          teacherId,
          status: { in: ["DRAFT", "OPEN", "SUBMITTED"] },
        },
        orderBy: { date: "asc" },
        take: 20,
        select: {
          id: true,
          title: true,
          date: true,
          status: true,
          subject: { select: { name: true } },
          classroom: { select: { name: true } },
          _count: { select: { grades: true } },
        },
      }),
    ]);

  const classes = new Map(schedules.map((s) => [s.classroom.id, s.classroom.name]));

  const K = {
    clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 6v6l4 2",
    calendar: "M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
    grid: "M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z",
    check: "M22 11.1V12a10 10 0 1 1-5.9-9.1 M22 4 12 14l-3-3",
    pen: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
    book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z",
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-brand-950 p-6 text-white shadow-soft">
        <div className="text-xs font-semibold uppercase tracking-widest text-brand-300">
          Espace enseignant
        </div>
        <h1 className="font-display mt-1 text-2xl font-bold tracking-tight">
          {teacher ? `${teacher.lastName} ${teacher.firstName}` : ""}
        </h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Cours aujourd'hui" value={sessionsToday.length} icon={K.clock} tone="brand" />
        <KpiCard label="Cours cette semaine" value={sessionsWeek.length} icon={K.calendar} tone="leaf" />
        <KpiCard label="Classes attribuées" value={classes.size} icon={K.grid} tone="sun" />
        <KpiCard
          label="Appels à effectuer"
          value={toCall.length}
          hint={toCall.length > 0 ? "action requise" : "à jour"}
          icon={K.check}
          tone={toCall.length > 0 ? "coral" : "mist"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DashCard title={`Cours du jour (${sessionsToday.length})`}>
          {sessionsToday.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-600">Aucune séance aujourd&#8217;hui.</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {sessionsToday.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between rounded-xl border border-zinc-100 px-3 py-2"
                >
                  <span>
                    <span className="font-medium text-zinc-900">
                      {s.subject?.name ?? "Cours"}
                    </span>{" "}
                    <span className="text-zinc-500">— {s.classroom.name}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
                    {minutesToLabel(s.startMin)}–{minutesToLabel(s.endMin)}
                    {s.room?.name ? ` · ${s.room.name}` : ""}
                    <Link
                      href={`/app/sessions/${s.id}`}
                      className="rounded-lg border border-zinc-200 px-2 py-1 hover:bg-mist"
                    >
                      Ouvrir
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DashCard>

        <DashCard title={`Cours de la semaine (${sessionsWeek.length})`}>
          {sessionsWeek.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-600">
              Aucune séance matérialisée cette semaine.
            </p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {sessionsWeek.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between rounded-xl border border-zinc-100 px-3 py-2"
                >
                  <span className="font-medium text-zinc-900">
                    {s.subject?.name ?? "Cours"} — {s.classroom.name}
                  </span>
                  <span className="text-xs text-zinc-600">
                    {s.date.toISOString().slice(0, 10)} ·{" "}
                    {minutesToLabel(s.startMin)}–{minutesToLabel(s.endMin)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DashCard>

        <DashCard title={`Classes attribuées (${classes.size})`}>
          <div className="mt-3 flex flex-wrap gap-2">
            {[...classes.entries()].map(([cid, name]) => (
              <Link
                key={cid}
                href={`/app/classrooms/${cid}`}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-mist"
              >
                {name}
              </Link>
            ))}
            {classes.size === 0 ? (
              <span className="text-sm text-zinc-600">
                Aucune classe via les créneaux actifs.
              </span>
            ) : null}
          </div>
        </DashCard>

        <DashCard title="Prochaines séances">
          {upcoming.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-600">Aucune séance à venir.</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {upcoming.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between rounded-xl border border-zinc-100 px-3 py-2"
                >
                  <span className="font-medium text-zinc-900">
                    {s.subject?.name ?? "Cours"} — {s.classroom.name}
                  </span>
                  <span className="text-xs text-zinc-600">
                    {DAY_LABEL[new Date(s.date).getDay() === 0 ? "SUNDAY" : ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"][new Date(s.date).getDay()-1]]}{" "}
                    {s.date.toISOString().slice(0, 10)} ·{" "}
                    {minutesToLabel(s.startMin)}–{minutesToLabel(s.endMin)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DashCard>

        <DashCard title={`Appels à effectuer (${toCall.length})`}>
          {toCall.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-600">Aucun appel en attente.</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {toCall.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between rounded-xl border border-zinc-100 px-3 py-2"
                >
                  <span className="font-medium text-zinc-900">
                    {s.subject?.name ?? "Cours"} — {s.classroom.name}
                  </span>
                  <Link
                    href={`/app/sessions/${s.id}`}
                    className="rounded-lg border border-zinc-200 px-2 py-1 text-xs hover:bg-mist"
                  >
                    Faire l&#8217;appel
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </DashCard>

        <DashCard title={`Évaluations (${myAssessments.length})`}>
          {myAssessments.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-600">Aucune évaluation en cours.</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {myAssessments.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between rounded-xl border border-zinc-100 px-3 py-2"
                >
                  <span className="font-medium text-zinc-900">
                    {a.title}
                    <span className="ml-2 text-xs font-normal text-zinc-500">
                      {a.subject.name} — {a.classroom.name} ·{" "}
                      {a.date.toISOString().slice(0, 10)} · {statusLabel("assessment", a.status)}
                    </span>
                  </span>
                  <Link
                    href={`/app/grades/${a.id}`}
                    className="rounded-lg border border-zinc-200 px-2 py-1 text-xs hover:bg-mist"
                  >
                    Saisir les notes
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </DashCard>

        <DashCard title={`Cahier de textes à compléter (${toWrite.length})`}>
          {toWrite.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-600">Tout est renseigné.</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {toWrite.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between rounded-xl border border-zinc-100 px-3 py-2"
                >
                  <span className="font-medium text-zinc-900">
                    {s.subject?.name ?? "Cours"} — {s.classroom.name}
                  </span>
                  <Link
                    href={`/app/sessions/${s.id}`}
                    className="rounded-lg border border-zinc-200 px-2 py-1 text-xs hover:bg-mist"
                  >
                    Compléter
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </DashCard>
      </div>
    </div>
  );
}
