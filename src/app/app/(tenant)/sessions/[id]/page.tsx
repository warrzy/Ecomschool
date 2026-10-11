import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSchoolContext } from "@/lib/tenant/context";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import {
  getSessionRoster,
  teacherIdForUser,
} from "@/lib/services/attendance";
import { minutesToLabel } from "@/lib/services/schedules";
import {
  moveSessionAction,
  setSessionStatusAction,
  replaceTeacherAction,
  upsertContentAction,
  saveSessionAttendanceAction,
} from "@/app/app/(tenant)/sessions/actions";

export const instant = false;

const STATUS_LABEL: Record<string, string> = {
  PLANNED: "Prévue",
  DONE: "Réalisée",
  CANCELLED: "Annulée",
  POSTPONED: "Reportée",
};

const MARK_LABEL: Record<string, string> = {
  PRESENT: "Présent",
  ABSENT: "Absent",
  LATE: "En retard",
  EXCUSED: "Excusé",
};

function minToTime(min: number | null | undefined) {
  if (min == null) return "";
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export default async function SessionDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolContext();
  const { id } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;

  const [canManage, canMarkAll, canContentAll] = await Promise.all([
    userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "sessions.manage",
    }),
    userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "attendance.manage",
    }),
    userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "coursecontent.manage",
    }),
  ]);

  const teacherId = await teacherIdForUser({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
  });

  const roster = await getSessionRoster(
    { userId: tenant.userId, schoolId: tenant.schoolId },
    id,
  );
  if (!roster) notFound();
  const { session, students, records } = roster;

  const isOwnSession = teacherId !== null && session.teacherId === teacherId;
  const canView =
    canManage || canMarkAll || canContentAll || isOwnSession;
  if (!canView) notFound();

  const canMark = canMarkAll || isOwnSession;
  const canEditContent = canContentAll || isOwnSession;

  const content = await prisma.courseContent.findUnique({
    where: { sessionId: id },
  });

  const teachers = canManage
    ? await prisma.teacher.findMany({
        where: { schoolId: tenant.schoolId, status: "ACTIVE" },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        select: { id: true, firstName: true, lastName: true },
      })
    : [];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">
          <Link href="/app/schedules" className="hover:underline">
            Emplois du temps
          </Link>{" "}
          / Séance
        </div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          {session.subject?.name ?? "Cours"} — {session.classroom.name}
        </div>
        <div className="mt-1 text-sm text-zinc-600">
          {session.date.toISOString().slice(0, 10)} ·{" "}
          {minutesToLabel(session.startMin)}–{minutesToLabel(session.endMin)} ·{" "}
          {session.teacher.lastName} {session.teacher.firstName}
          {session.room?.name ? ` · Salle ${session.room.name}` : ""}
        </div>
        <div className="mt-2 text-sm">
          <span className="rounded-lg border border-zinc-200 px-2 py-1 text-xs">
            {STATUS_LABEL[session.status] ?? session.status}
          </span>
          {session.status === "CANCELLED" || session.status === "POSTPONED" ? null : null}
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

      {canManage ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-medium text-zinc-900">
              Déplacer la séance
            </div>
            <form action={moveSessionAction} className="mt-3 space-y-2">
              <input type="hidden" name="id" value={id} />
              <input
                name="date"
                type="date"
                defaultValue={session.date.toISOString().slice(0, 10)}
                required
                className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm"
              />
              <div className="flex gap-2">
                <input
                  name="startTime"
                  type="time"
                  defaultValue={minToTime(session.startMin)}
                  required
                  className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm"
                />
                <input
                  name="endTime"
                  type="time"
                  defaultValue={minToTime(session.endMin)}
                  required
                  className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm"
                />
              </div>
              <button
                type="submit"
                className="h-10 w-full rounded-xl bg-zinc-900 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Déplacer
              </button>
            </form>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-medium text-zinc-900">
              Remplacer l&#8217;enseignant
            </div>
            <form action={replaceTeacherAction} className="mt-3 space-y-2">
              <input type="hidden" name="id" value={id} />
              <select
                name="teacherId"
                required
                className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm"
              >
                <option value="">Choisir…</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.lastName} {t.firstName}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="h-10 w-full rounded-xl bg-zinc-900 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Remplacer
              </button>
            </form>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-medium text-zinc-900">Statut</div>
            <form action={setSessionStatusAction} className="mt-3 space-y-2">
              <input type="hidden" name="id" value={id} />
              <select
                name="status"
                defaultValue={session.status}
                className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm"
              >
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <input
                name="cancellationReason"
                placeholder="Motif (annulation/report)"
                className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm"
              />
              <button
                type="submit"
                className="h-10 w-full rounded-xl bg-zinc-900 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Appliquer
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {/* Appel */}
      {canMark && session.status !== "CANCELLED" ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">
            Appel — {students.length} élève(s)
          </div>
          <form action={saveSessionAttendanceAction} className="mt-3">
            <input type="hidden" name="sessionId" value={id} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                    <th className="py-2 pr-3">Matricule</th>
                    <th className="py-2 pr-3">Élève</th>
                    <th className="py-2 pr-3">Statut</th>
                    <th className="py-2 pr-3">Arrivée (retard)</th>
                    <th className="py-2 pr-3">Motif</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => {
                    const rec = records.get(s.id);
                    return (
                      <tr key={s.id} className="border-b border-zinc-100">
                        <td className="py-2 pr-3 text-zinc-600">
                          {s.matricule}
                        </td>
                        <td className="py-2 pr-3 font-medium text-zinc-900">
                          {s.lastName} {s.firstName}
                        </td>
                        <td className="py-2 pr-3" colSpan={3}>
                          <MarkRow
                            studentId={s.id}
                            current={rec?.status ?? null}
                            arrival={rec?.arrivalMin}
                            reason={rec?.reason}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button
              type="submit"
              className="mt-4 h-10 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Enregistrer l&#8217;appel
            </button>
          </form>
        </div>
      ) : null}

      {/* Cahier de textes */}
      {canEditContent ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">
            Cahier de textes
          </div>
          <form action={upsertContentAction} className="mt-3 space-y-3">
            <input type="hidden" name="sessionId" value={id} />
            <div className="grid gap-3 md:grid-cols-2">
              <input
                name="theme"
                defaultValue={content?.theme ?? ""}
                placeholder="Thème"
                className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
              />
              <input
                name="chapter"
                defaultValue={content?.chapter ?? ""}
                placeholder="Chapitre"
                className="h-10 rounded-xl border border-zinc-200 px-3 text-sm"
              />
            </div>
            <textarea
              name="objective"
              defaultValue={content?.objective ?? ""}
              placeholder="Objectif pédagogique"
              rows={2}
              className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
            />
            <textarea
              name="content"
              defaultValue={content?.content ?? ""}
              placeholder="Contenu du cours"
              rows={4}
              className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
            />
            <textarea
              name="homework"
              defaultValue={content?.homework ?? ""}
              placeholder="Travail à faire"
              rows={2}
              className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
            />
            <textarea
              name="notes"
              defaultValue={content?.notes ?? ""}
              placeholder="Observations"
              rows={2}
              className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="h-10 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Enregistrer le cahier
            </button>
          </form>
        </div>
      ) : content ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-zinc-900">
            Cahier de textes
          </div>
          <dl className="mt-3 space-y-2 text-sm">
            {content.theme ? (
              <div>
                <dt className="text-xs text-zinc-500">Thème</dt>
                <dd>{content.theme}</dd>
              </div>
            ) : null}
            {content.chapter ? (
              <div>
                <dt className="text-xs text-zinc-500">Chapitre</dt>
                <dd>{content.chapter}</dd>
              </div>
            ) : null}
            {content.objective ? (
              <div>
                <dt className="text-xs text-zinc-500">Objectif</dt>
                <dd>{content.objective}</dd>
              </div>
            ) : null}
            {content.content ? (
              <div>
                <dt className="text-xs text-zinc-500">Contenu</dt>
                <dd className="whitespace-pre-wrap">{content.content}</dd>
              </div>
            ) : null}
            {content.homework ? (
              <div>
                <dt className="text-xs text-zinc-500">Travail à faire</dt>
                <dd className="whitespace-pre-wrap">{content.homework}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function MarkRow({
  studentId,
  current,
  arrival,
  reason,
}: {
  studentId: string;
  current: string | null;
  arrival?: number | null;
  reason?: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {(["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const).map((st) => (
        <label
          key={st}
          className="flex items-center gap-1 text-xs text-zinc-700"
        >
          <input
            type="radio"
            name={`status_${studentId}`}
            value={st}
            defaultChecked={current === st || (!current && st === "PRESENT")}
            className="accent-zinc-900"
          />
          {MARK_LABEL[st]}
        </label>
      ))}
      <input
        name={`arrival_${studentId}`}
        type="time"
        defaultValue={minToTime(arrival)}
        className="h-8 rounded-lg border border-zinc-200 px-2 text-xs"
      />
      <input
        name={`reason_${studentId}`}
        defaultValue={reason ?? ""}
        placeholder="Motif"
        className="h-8 w-40 rounded-lg border border-zinc-200 px-2 text-xs"
      />
    </div>
  );
}
