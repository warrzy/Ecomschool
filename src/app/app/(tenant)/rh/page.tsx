import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { listEmployees, getEmployee } from "@/lib/services/hr/employees";
import { createEmployeeAction, createContractAction, activateContractAction, departEmployeeAction, addDocumentAction } from "./actions";

const BTN = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50";
const INP = "rounded border px-2 py-1 text-sm";
const fmt = (n: number) => n.toLocaleString("fr-FR");

/** RH-1 : référentiel du personnel (enseignant & non enseignant). */
export default async function RhPage(props: { searchParams: Promise<{ id?: string; q?: string; ok?: string; err?: string }> }) {
  const t = await requireSchoolPermission("hr.read");
  const sp = await props.searchParams;
  const ctx = { userId: t.userId, schoolId: t.schoolId };
  const canManage = await userHasSchoolPermission({ ...ctx, permissionKey: "hr.manage" });
  const emps = await listEmployees(ctx, { q: sp.q });
  const detail = sp.id ? await getEmployee(ctx, sp.id) : null;

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xl font-semibold">Personnel</h1>
      {sp.err ? <p className="text-sm text-red-600">{sp.err}</p> : null}
      {sp.ok ? <p className="text-sm text-green-700">{sp.ok}</p> : null}

      <form method="get" className="flex gap-2">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Rechercher (nom, matricule)…" className={INP} />
        <button className={BTN} type="submit">Filtrer</button>
      </form>

      <section className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr><th className="p-2">Matricule</th><th>Nom</th><th>Catégorie</th><th>Poste actuel</th><th>Salaire base</th><th>Statut</th></tr>
          </thead>
          <tbody>
            {(emps.ok ? emps.result : []).map((e) => (
              <tr key={e.id} className="border-t">
                <td className="p-2 font-mono text-xs"><a className="underline" href={`/app/rh?id=${e.id}`}>{e.matricule}</a></td>
                <td>{e.lastName} {e.firstName}{e.teacher ? <span className="ml-1 text-xs text-blue-600">(fiche enseignant liée)</span> : null}</td>
                <td>{e.category === "TEACHING" ? "Enseignant" : "Non enseignant"}</td>
                <td>{e.contracts[0]?.position ?? "—"}</td>
                <td className="font-mono">{e.contracts[0] ? fmt(e.contracts[0].baseSalary) : "—"}</td>
                <td>{e.status}</td>
              </tr>
            ))}
            {(emps.ok ? emps.result.length : 0) === 0 ? <tr><td className="p-3 text-slate-500" colSpan={6}>Aucun employé.</td></tr> : null}
          </tbody>
        </table>
      </section>

      {canManage ? (
        <section className="rounded-lg border p-4">
          <h2 className="mb-2 font-semibold">Nouvel employé</h2>
          <form action={createEmployeeAction} className="grid gap-2 sm:grid-cols-3">
            <input required name="matricule" placeholder="Matricule" className={INP} />
            <input required name="lastName" placeholder="Nom" className={INP} />
            <input required name="firstName" placeholder="Prénom" className={INP} />
            <select name="category" className={INP}><option value="NON_TEACHING">Non enseignant</option><option value="TEACHING">Enseignant</option></select>
            <input name="phone" placeholder="Téléphone" className={INP} />
            <input name="hireDate" type="date" className={INP} />
            <button className={BTN} type="submit">Enregistrer</button>
          </form>
        </section>
      ) : null}

      {detail?.ok ? (
        <section className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{detail.result.matricule} — {detail.result.lastName} {detail.result.firstName}
              <span className="ml-2 text-sm font-normal text-slate-500">{detail.result.status}{detail.result.departureDate ? ` (sorti le ${detail.result.departureDate.toISOString().slice(0, 10)})` : ""}</span>
            </h2>
            {canManage && detail.result.status !== "DEPARTED" ? (
              <form action={departEmployeeAction} className="flex gap-2">
                <input type="hidden" name="id" value={detail.result.id} />
                <input required name="departureDate" type="date" className={INP} />
                <button className={BTN} type="submit">Enregistrer la sortie</button>
              </form>
            ) : null}
          </div>

          <div>
            <h3 className="mb-1 text-sm font-semibold">Contrats</h3>
            <table className="w-full text-sm">
              <tbody>
                {detail.result.contracts.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="p-1.5">{c.type}</td><td>{c.position}</td>
                    <td>{c.startDate.toISOString().slice(0, 10)} → {c.endDate ? c.endDate.toISOString().slice(0, 10) : "…"}</td>
                    <td className="font-mono">{fmt(c.baseSalary)}</td>
                    <td>{c.status}{c.amendsContractId ? <span className="ml-1 text-xs text-slate-400">(avenant)</span> : null}</td>
                    <td className="text-right">
                      {canManage && c.status === "DRAFT" ? (
                        <form action={activateContractAction} className="inline">
                          <input type="hidden" name="id" value={c.id} />
                          <button className="text-xs text-blue-700 underline">Activer</button>
                        </form>
                      ) : null}
                      {canManage && c.status === "ACTIVE" ? (
                        <form action={createContractAction} className="inline">
                          <input type="hidden" name="employeeId" value={detail.result.id} />
                          <input type="hidden" name="amendsContractId" value={c.id} />
                          <input type="hidden" name="type" value={c.type} />
                          <input type="hidden" name="position" value={c.position} />
                          <input type="hidden" name="startDate" value={new Date().toISOString().slice(0, 10)} />
                          <input type="hidden" name="baseSalary" value={c.baseSalary} />
                          <button className="ml-2 text-xs text-amber-700 underline">Avenant</button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canManage ? (
              <form action={createContractAction} className="mt-2 grid gap-2 sm:grid-cols-6">
                <input type="hidden" name="employeeId" value={detail.result.id} />
                <select name="type" className={INP}><option>CDI</option><option>CDD</option><option>VACATION</option><option>INTERN</option></select>
                <input required name="position" placeholder="Poste" className={INP} />
                <input required name="startDate" type="date" className={INP} />
                <input name="endDate" type="date" className={INP} />
                <input required name="baseSalary" type="number" min="0" placeholder="Salaire" className={INP} />
                <button className={BTN} type="submit">+ Contrat</button>
              </form>
            ) : null}
          </div>

          <div>
            <h3 className="mb-1 text-sm font-semibold">Documents ({detail.result.documents.length})</h3>
            <ul className="text-sm">
              {detail.result.documents.map((d) => <li key={d.id}>• {d.kind} — {d.label}{d.fileUrl ? ` (${d.fileUrl})` : ""}</li>)}
            </ul>
            {canManage ? (
              <form action={addDocumentAction} className="mt-2 flex flex-wrap gap-2">
                <input type="hidden" name="employeeId" value={detail.result.id} />
                <input required name="kind" placeholder="Type (CNIB…)" className={INP} />
                <input required name="label" placeholder="Libellé" className={INP} />
                <input name="fileUrl" placeholder="URL fichier" className={INP} />
                <button className={BTN} type="submit">Ajouter</button>
              </form>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
