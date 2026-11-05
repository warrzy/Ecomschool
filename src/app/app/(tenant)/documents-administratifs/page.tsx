import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import {
  ADMIN_DOC_TYPE_LABELS,
  listAdministrativeDocuments,
} from "@/lib/services/administrative-docs";
import {
  issueAdminDocAction,
  reissueAdminDocAction,
  revokeAdminDocAction,
} from "@/app/app/(tenant)/documents-administratifs/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { SubmitButton } from "@/components/ui/SubmitButton";

export const instant = false;

const STATUS_LABELS: Record<string, string> = {
  ISSUED: "Émis",
  REVOKED: "Révoqué",
};

const ERROR_LABELS: Record<string, string> = {
  INVALID_INPUT: "Saisie invalide.",
  NOT_ENROLLED: "L'élève n'est pas inscrit pour l'année scolaire visée.",
  INVALID_STATE: "Opération impossible sur ce document.",
  FORBIDDEN: "Accès refusé.",
};

export default async function AdminDocsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("administrative-docs.read");
  const c = { userId: tenant.userId, schoolId: tenant.schoolId };
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const ok = str("ok");
  const error = str("error");
  const filterStudent = str("studentId");

  const canIssue = await userHasSchoolPermission({
    userId: tenant.userId,
    schoolId: tenant.schoolId,
    permissionKey: "administrative-docs.issue",
  });

  const [docs, students, years] = await Promise.all([
    listAdministrativeDocuments(c, filterStudent ? { studentId: filterStudent } : {}),
    prisma.student.findMany({
      where: { schoolId: tenant.schoolId, status: "ACTIVE" },
      select: { id: true, matricule: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 300,
    }),
    prisma.academicYear.findMany({
      where: { schoolId: tenant.schoolId },
      select: { id: true, name: true, isCurrent: true },
      orderBy: { startDate: "desc" },
    }),
  ]);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-bold">Documents administratifs</h1>
      <p className="mt-1 text-sm text-gray-600">
        Attestations d&rsquo;inscription, certificats de scolarité et cartes scolaires.
        Chaque document porte une référence unique et un code de vérification.
      </p>

      {ok && (
        <p className="mt-4 rounded bg-green-50 p-3 text-sm text-green-800">
          {okMessage(ok)}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800">
          {ERROR_LABELS[error] ?? errorMessage(error)}
        </p>
      )}

      {canIssue && (
        <section className="mt-6 rounded border p-4">
          <h2 className="font-semibold">Émettre un document</h2>
          <form action={issueAdminDocAction} className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm">
              Élève
              <select name="studentId" required className="mt-1 block min-w-64 rounded border px-2 py-1">
                <option value="">— Choisir —</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.lastName} {s.firstName} ({s.matricule})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Type
              <select name="type" required className="mt-1 block rounded border px-2 py-1">
                <option value="ATTESTATION_INSCRIPTION">Attestation d&rsquo;inscription</option>
                <option value="CERTIFICAT_SCOLAIRE">Certificat de scolarité</option>
                <option value="CARTE_SCOLAIRE">Carte scolaire</option>
              </select>
            </label>
            <label className="text-sm">
              Année scolaire
              <select name="academicYearId" className="mt-1 block rounded border px-2 py-1">
                <option value="">Année courante</option>
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                    {y.isCurrent ? " (courante)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton>Émettre</SubmitButton>
          </form>
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-semibold">Historique des émissions</h2>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-600">
              <th className="py-2">Référence</th>
              <th>Type</th>
              <th>Élève</th>
              <th>Année</th>
              <th>Émis le</th>
              <th>Statut</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-gray-500">
                  Aucun document émis.
                </td>
              </tr>
            )}
            {docs.map((d) => (
              <tr key={d.id} className="border-b">
                <td className="py-2 font-mono text-xs">{d.number}</td>
                <td>{ADMIN_DOC_TYPE_LABELS[d.type]}</td>
                <td>
                  {d.student.lastName} {d.student.firstName}
                  <span className="text-gray-500"> ({d.student.matricule})</span>
                </td>
                <td>{d.academicYear.name}</td>
                <td>{d.issuedAt.toLocaleDateString("fr-FR")}</td>
                <td>
                  <span
                    className={
                      d.status === "ISSUED" ? "text-green-700" : "text-red-700"
                    }
                  >
                    {STATUS_LABELS[d.status] ?? d.status}
                  </span>
                </td>
                <td className="text-right">
                  <Link
                    href={`/app/documents-administratifs/${d.id}/pdf`}
                    className="text-blue-700 underline"
                    target="_blank"
                  >
                    PDF
                  </Link>
                  {canIssue && d.status === "ISSUED" && (
                    <>
                      {" · "}
                      <form action={reissueAdminDocAction} className="inline">
                        <input type="hidden" name="id" value={d.id} />
                        <button type="submit" className="text-blue-700 underline">
                          Réémettre
                        </button>
                      </form>
                      {" · "}
                      <form action={revokeAdminDocAction} className="inline">
                        <input type="hidden" name="id" value={d.id} />
                        <input
                          type="text"
                          name="reason"
                          required
                          placeholder="Motif"
                          className="w-28 rounded border px-1 py-0.5 text-xs"
                        />
                        <button type="submit" className="ml-1 text-red-700 underline">
                          Révoquer
                        </button>
                      </form>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
