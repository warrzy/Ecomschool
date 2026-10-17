import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { prisma } from "@/lib/db/prisma";
import { listReminders, listUnpaid } from "@/lib/services/finance/payments";
import { remindAction } from "@/app/app/(tenant)/fees/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { SubmitButton } from "@/components/ui/SubmitButton";

export const instant = false;

const fmt = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
const dstr = (d: Date) => d.toISOString().slice(0, 10);

export default async function UnpaidPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("finance.reports.read");
  const c = { userId: tenant.userId, schoolId: tenant.schoolId };
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const ok = str("ok");
  const error = str("error");

  const years = await prisma.academicYear.findMany({
    where: { schoolId: tenant.schoolId },
    orderBy: { startDate: "desc" },
    select: { id: true, name: true, isCurrent: true },
  });
  const yearId = str("year") ?? years.find((y) => y.isCurrent)?.id ?? years[0]?.id;
  const classroomId = str("classroom");

  const classrooms = await prisma.classroom.findMany({
    where: { schoolId: tenant.schoolId, ...(yearId ? { academicYearId: yearId } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const unpaid = yearId ? await listUnpaid(c, { academicYearId: yearId, classroomId }) : [];
  const reminders = await listReminders(c);

  const byClassroom = new Map<string, number>();
  const byLevel = new Map<string, number>();
  for (const u of unpaid) {
    if (!u.late) continue;
    byClassroom.set(u.classroomName ?? "—", (byClassroom.get(u.classroomName ?? "—") ?? 0) + u.remaining);
    byLevel.set(u.levelName ?? "—", (byLevel.get(u.levelName ?? "—") ?? 0) + u.remaining);
  }

  const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft";
  const input = "rounded-lg border border-zinc-300 px-3 py-2 text-sm";

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="text-sm text-zinc-500">
          <Link href="/app/fees" className="hover:underline">Finances</Link> / Impayés
        </div>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-xl font-display font-bold tracking-tight text-ink">
            Soldes restants & échéances dépassées ({unpaid.length})
          </h1>
          <Link
            href="/app/fees"
            className="shrink-0 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-mist"
          >
            Retour
          </Link>
        </div>
        {ok ? (
          <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {okMessage(ok)}
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{errorMessage(error)}</div>
        ) : null}
      </div>

      <div className={card}>
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <select
                  aria-label="Année scolaire" name="year" defaultValue={yearId ?? ""} className={input}>
            {years.map((y) => (
              <option key={y.id} value={y.id}>{y.name}</option>
            ))}
          </select>
          <select
                  aria-label="Toutes les classes" name="classroom" defaultValue={classroomId ?? ""} className={input}>
            <option value="">Toutes les classes</option>
            {classrooms.map((cl) => (
              <option key={cl.id} value={cl.id}>{cl.name}</option>
            ))}
          </select>
          <button type="submit" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-mist">
            Filtrer
          </button>
        </form>
        {yearId ? (
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <a href={`/app/fees/unpaid/export?format=csv&year=${yearId}${classroomId ? `&classroom=${classroomId}` : ""}`} className="text-zinc-700 underline">
              Impayés CSV
            </a>
            <a href={`/app/fees/unpaid/export?format=xlsx&year=${yearId}${classroomId ? `&classroom=${classroomId}` : ""}`} className="text-zinc-700 underline">
              Impayés Excel
            </a>
            <a href={`/app/fees/unpaid/export?format=csv&year=${yearId}&late=1${classroomId ? `&classroom=${classroomId}` : ""}`} className="text-zinc-700 underline">
              Retards seuls CSV
            </a>
          </div>
        ) : null}
        <p className="mt-2 text-xs text-zinc-500">
          Le reste des impayés tient compte de l&apos;imputation des réductions
          sur les échéances (FIFO) ; il peut différer du reste contractuel
          affiché par l&apos;export « Échéances ».
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={card}>
          <div className="mb-3 text-sm font-medium text-zinc-900">En retard par classe</div>
          <div className="overflow-x-auto">
          <table aria-label="En retard par classe" className="w-full text-left text-sm">
            <tbody>
              {[...byClassroom.entries()].map(([k, v]) => (
                <tr key={k} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2">{k}</td>
                  <td className="py-2 text-right font-medium">{fmt(v)}</td>
                </tr>
              ))}
              {byClassroom.size === 0 ? <tr><td className="py-2 text-zinc-500">Aucun retard.</td></tr> : null}
            </tbody>
          </table>
          </div>
        </div>
        <div className={card}>
          <div className="mb-3 text-sm font-medium text-zinc-900">En retard par niveau</div>
          <div className="overflow-x-auto">
          <table aria-label="En retard par niveau" className="w-full text-left text-sm">
            <tbody>
              {[...byLevel.entries()].map(([k, v]) => (
                <tr key={k} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2">{k}</td>
                  <td className="py-2 text-right font-medium">{fmt(v)}</td>
                </tr>
              ))}
              {byLevel.size === 0 ? <tr><td className="py-2 text-zinc-500">Aucun retard.</td></tr> : null}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      <div className={card}>
        <div className="overflow-x-auto">
        <table aria-label="Élèves en retard de paiement" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th scope="col" className="py-2">Élève</th>
              <th scope="col" className="py-2">Classe</th>
              <th scope="col" className="py-2">Catégorie</th>
              <th scope="col" className="py-2">Échéance</th>
              <th scope="col" className="py-2 text-right">Reste</th>
              <th scope="col" className="py-2">Retard</th>
              <th scope="col" className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {unpaid.map((u) => (
              <tr key={u.id} className="border-b border-zinc-100 last:border-0">
                <td className="py-2">
                  <Link href={`/app/fees/accounts/${u.student.id}?year=${yearId}`} className="hover:underline">
                    {u.student.firstName} {u.student.lastName}
                  </Link>
                  <div className="font-mono text-xs text-zinc-500">{u.student.matricule}</div>
                </td>
                <td className="py-2">{u.classroomName ?? "—"}</td>
                <td className="py-2">{u.category}{u.label ? ` · ${u.label}` : ""}</td>
                <td className="py-2">{dstr(u.dueDate)}</td>
                <td className="py-2 text-right font-medium">{fmt(u.remaining)}</td>
                <td className={`py-2 text-xs font-medium ${u.late ? "text-red-700" : "text-zinc-500"}`}>
                  {u.late ? `${u.daysLate} j` : "—"}
                </td>
                <td className="py-2 text-right">
                  <form action={remindAction} className="flex items-center justify-end gap-1">
                    <input type="hidden" name="studentId" value={u.student.id} />
                    <input type="hidden" name="installmentId" value={u.id} />
                    <input aria-label="Note" name="note" placeholder="Message de relance" required className="w-40 rounded border border-zinc-200 px-1 py-0.5 text-xs" />
                    <SubmitButton className="text-xs text-zinc-700 underline">Relancer</SubmitButton>
                  </form>
                </td>
              </tr>
            ))}
            {unpaid.length === 0 ? (
              <tr><td colSpan={7} className="py-3 text-zinc-500">Aucun solde restant.</td></tr>
            ) : null}
          </tbody>
        </table>
        </div>
      </div>

      <div className={card}>
        <div className="mb-3 text-sm font-medium text-zinc-900">Historique des relances</div>
        <div className="overflow-x-auto">
        <table aria-label="Historique des relances" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th scope="col" className="py-2">Date</th>
              <th scope="col" className="py-2">Élève</th>
              <th scope="col" className="py-2">Message</th>
            </tr>
          </thead>
          <tbody>
            {reminders.map((r) => (
              <tr key={r.id} className="border-b border-zinc-100 last:border-0">
                <td className="py-2">{dstr(r.createdAt)}</td>
                <td className="py-2">{r.student.firstName} {r.student.lastName}</td>
                <td className="py-2 text-zinc-600">{r.note}</td>
              </tr>
            ))}
            {reminders.length === 0 ? (
              <tr><td colSpan={3} className="py-3 text-zinc-500">Aucune relance.</td></tr>
            ) : null}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
