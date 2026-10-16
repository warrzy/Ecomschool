import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { updatePeriodAction } from "@/app/app/(tenant)/academic-years/actions";
import { redirect } from "next/navigation";
import { errorMessage } from "@/lib/ui/errorLabels";
import { statusLabel } from "@/lib/ui/statusLabels";

export const instant = false;

const d = (v: Date) => v.toISOString().slice(0, 10);

export default async function AcademicPeriodsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("academic.read");

  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;
  const error = typeof sp.error === "string" ? sp.error : undefined;

  const year = await prisma.academicYear.findFirst({
    where: { id, schoolId: tenant.schoolId },
    select: { id: true, name: true, status: true },
  });
  if (!year) redirect("/app/academic-years");

  const canManage =
    year.status !== "CLOSED" &&
    (await userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "academic.manage",
    }));

  const periods = await prisma.academicPeriod.findMany({
    where: { academicYearId: year.id },
    orderBy: { number: "asc" },
    select: {
      id: true,
      name: true,
      number: true,
      startDate: true,
      endDate: true,
      type: true,
      isLocked: true,
    },
  });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-zinc-500">Référentiel</div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
              Périodes — {year.name}
            </div>
            <div className="mt-1 text-sm text-zinc-600">
              Statut de l&apos;année : {statusLabel("academicYear", year.status)}
            </div>
          </div>
          <Link
            href="/app/academic-years"
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50"
          >
            Retour
          </Link>
        </div>
        {ok ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {ok}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {errorMessage(error)}
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        {periods.map((p) => (
          <div
            key={p.id}
            className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
          >
            {canManage ? (
              <form action={updatePeriodAction}>
                <input type="hidden" name="periodId" value={p.id} />
                <input type="hidden" name="yearId" value={year.id} />
                <div className="grid items-end gap-4 md:grid-cols-5">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">
                      #{p.number} — Nom
                    </label>
                    <input
                      name="name"
                      defaultValue={p.name}
                      required
                      className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">
                      Début
                    </label>
                    <input
                      name="startDate"
                      type="date"
                      defaultValue={d(p.startDate)}
                      required
                      className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">
                      Fin
                    </label>
                    <input
                      name="endDate"
                      type="date"
                      defaultValue={d(p.endDate)}
                      required
                      className="h-10 w-full rounded-xl border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-900"
                    />
                  </div>
                  <label className="flex items-center gap-2 pb-2 text-sm text-zinc-800">
                    <input
                      type="checkbox"
                      name="isLocked"
                      defaultChecked={p.isLocked}
                    />
                    Verrouillée
                  </label>
                  <button
                    type="submit"
                    className="h-10 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
                  >
                    Enregistrer
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex items-center justify-between text-sm">
                <div className="font-medium text-zinc-900">
                  #{p.number} — {p.name}
                </div>
                <div className="text-zinc-600">
                  {d(p.startDate)} → {d(p.endDate)} ·{" "}
                  {statusLabel("periodType", p.type)}
                  {p.isLocked ? " · verrouillée" : ""}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
