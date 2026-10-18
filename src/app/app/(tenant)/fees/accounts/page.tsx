import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import { listAccounts } from "@/lib/services/finance/accounts";

export const instant = false;

const fmt = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;

export default async function AccountsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("finance.read");
  const c = { userId: tenant.userId, schoolId: tenant.schoolId };
  const canReport = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "finance.reports.read",
  });
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

  const years = await prisma.academicYear.findMany({
    where: { schoolId: tenant.schoolId },
    orderBy: { startDate: "desc" },
    select: { id: true, name: true, isCurrent: true },
  });
  const yearId = str("year") ?? years.find((y) => y.isCurrent)?.id ?? years[0]?.id;
  const classroomId = str("classroom");
  const q = str("q")?.trim() || undefined;
  const page = Math.max(1, parseInt(str("page") ?? "1", 10) || 1);

  const classrooms = await prisma.classroom.findMany({
    where: { schoolId: tenant.schoolId, ...(yearId ? { academicYearId: yearId } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const accounts = yearId
    ? await listAccounts(c, { academicYearId: yearId, classroomId, query: q })
    : [];
  const withCharges = accounts.filter((a) => a.charges > 0 || a.paid > 0);

  const PAGE_SIZE = 50;
  const pageCount = Math.max(1, Math.ceil(withCharges.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = withCharges.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const pageHref = (p: number) => {
    const u = new URLSearchParams();
    if (yearId) u.set("year", yearId);
    if (classroomId) u.set("classroom", classroomId);
    if (q) u.set("q", q);
    u.set("page", String(p));
    return `?${u.toString()}`;
  };
  const exportSuffix = `${classroomId ? `&classroom=${classroomId}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft";
  const input = "rounded-lg border border-zinc-300 px-3 py-2 text-sm";

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="text-sm text-zinc-500">
          <Link href="/app/fees" className="hover:underline">Finances</Link> / Comptes élèves
        </div>
        <h1 className="mt-1 text-xl font-display font-bold tracking-tight text-ink">
          Comptes financiers ({withCharges.length})
        </h1>
      </div>

      <div className={card}>
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <input
            aria-label="Rechercher un élève"
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Nom, prénom ou matricule…"
            className={`${input} min-w-56`}
          />
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
            Rechercher
          </button>
        </form>
        {canReport && yearId ? (
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <a href={`/app/fees/accounts/export?format=csv&year=${yearId}${exportSuffix}`} className="text-zinc-700 underline">
              Comptes CSV
            </a>
            <a href={`/app/fees/accounts/export?format=xlsx&year=${yearId}${exportSuffix}`} className="text-zinc-700 underline">
              Comptes Excel
            </a>
            <a href={`/app/fees/installments/export?format=csv&year=${yearId}${classroomId ? `&classroom=${classroomId}` : ""}`} className="text-zinc-700 underline">
              Échéances CSV
            </a>
            <a href={`/app/fees/installments/export?format=xlsx&year=${yearId}${classroomId ? `&classroom=${classroomId}` : ""}`} className="text-zinc-700 underline">
              Échéances Excel
            </a>
          </div>
        ) : null}
        {canReport ? (
          <p className="mt-2 text-xs text-zinc-500">
            Export « Échéances » : reste contractuel (montant − encaissements
            ventilés). Export « Impayés » : reste net après imputation des
            réductions (FIFO) — les deux montants peuvent donc différer pour
            un élève bénéficiant de remises.
          </p>
        ) : null}
      </div>

      <div className={card}>
        <div className="overflow-x-auto">
        <table aria-label="Comptes financiers" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th scope="col" className="py-2">Matricule</th>
              <th scope="col" className="py-2">Élève</th>
              <th scope="col" className="py-2">Classe</th>
              <th scope="col" className="py-2 text-right">Facturé</th>
              <th scope="col" className="py-2 text-right">Réductions</th>
              <th scope="col" className="py-2 text-right">Payé</th>
              <th scope="col" className="py-2 text-right">Solde</th>
              <th scope="col" className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((a) => (
              <tr key={a.student.id} className="border-b border-zinc-100 last:border-0">
                <td className="py-2 font-mono text-xs">{a.student.matricule}</td>
                <td className="py-2">{a.student.firstName} {a.student.lastName}</td>
                <td className="py-2">{a.classroom.name}</td>
                <td className="py-2 text-right">{fmt(a.charges)}</td>
                <td className="py-2 text-right">{fmt(a.discounts)}</td>
                <td className="py-2 text-right">{fmt(a.paid)}</td>
                <td className={`py-2 text-right font-medium ${a.balance > 0 ? "text-red-700" : "text-emerald-700"}`}>
                  {fmt(a.balance)}
                </td>
                <td className="py-2 text-right">
                  <Link href={`/app/fees/accounts/${a.student.id}?year=${yearId}`} className="text-xs text-zinc-700 underline">
                    Dossier
                  </Link>
                </td>
              </tr>
            ))}
            {withCharges.length === 0 ? (
              <tr><td colSpan={8} className="py-3 text-zinc-500">
                {q
                  ? `Aucun élève ne correspond à « ${q} » pour ces filtres.`
                  : "Aucune créance générée pour cette année."}
              </td></tr>
            ) : null}
          </tbody>
        </table>
        </div>
        {pageCount > 1 ? (
          <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
            <span className="text-zinc-500">
              Page {safePage} / {pageCount} — {withCharges.length} dossier(s)
            </span>
            <div className="flex gap-2">
              {safePage > 1 ? (
                <Link href={pageHref(safePage - 1)} className="rounded-lg border border-zinc-300 px-3 py-1.5 hover:bg-mist">
                  Précédent
                </Link>
              ) : null}
              {safePage < pageCount ? (
                <Link href={pageHref(safePage + 1)} className="rounded-lg border border-zinc-300 px-3 py-1.5 hover:bg-mist">
                  Suivant
                </Link>
              ) : null}
            </div>
          </nav>
        ) : null}
      </div>
    </div>
  );
}
