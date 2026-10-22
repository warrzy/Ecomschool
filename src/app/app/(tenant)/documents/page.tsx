import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { userHasSchoolPermission } from "@/lib/permissions/rbac";
import {
  ALLOWED_MIME_TYPES,
  DOCUMENT_CATEGORIES,
  getDocumentQuota,
  listDocuments,
  MAX_DOCUMENT_BYTES,
} from "@/lib/services/documents";
import {
  deleteDocumentAction,
  replaceDocumentAction,
  uploadDocumentAction,
} from "@/app/app/(tenant)/documents/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { okMessage } from "@/lib/ui/okLabels";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";
import { SubmitButton } from "@/components/ui/SubmitButton";

export const instant = false;

const fmtBytes = (n: number) =>
  n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} Mo` : `${(n / 1024).toFixed(0)} Ko`;

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Actif",
  REPLACED: "Remplacé",
  DELETED: "Supprimé",
};

export default async function DocumentsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requireSchoolPermission("documents.read");
  const c = { userId: tenant.userId, schoolId: tenant.schoolId };
  const sp = (await props.searchParams) ?? {};
  const str = (k: string) =>
    typeof sp[k] === "string" ? (sp[k] as string) : undefined;
  const ok = str("ok");
  const error = str("error");
  const replaceId = str("replace");
  const confirmDelete = str("confirm") === "delete" ? str("id") : undefined;

  const [canUpload, canManage] = await Promise.all([
    userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "documents.upload",
    }),
    userHasSchoolPermission({
      userId: tenant.userId,
      schoolId: tenant.schoolId,
      permissionKey: "documents.manage",
    }),
  ]);

  const [documents, quota] = await Promise.all([
    listDocuments(c),
    getDocumentQuota(tenant.schoolId),
  ]);

  const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft";
  const input = "rounded-lg border border-zinc-300 px-3 py-2 text-sm";

  const deleteTarget = confirmDelete
    ? documents.find((d) => d.id === confirmDelete)
    : undefined;
  const replaceTarget = replaceId
    ? documents.find((d) => d.id === replaceId)
    : undefined;

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-xl font-display font-bold tracking-tight text-ink">
            Documents ({documents.length})
          </h1>
        </div>
        {ok ? (
          <div
            role="status"
            className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          >
            {okMessage(ok)}
          </div>
        ) : null}
        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {errorMessage(error)}
          </div>
        ) : null}
        <div className="mt-4 rounded-xl border border-zinc-200 p-4">
          <div className="text-xs uppercase text-zinc-500">Quota de stockage</div>
          <div className="mt-1 text-sm">
            <span className="font-medium">{fmtBytes(quota.usedBytes)}</span>
            {" utilisés sur "}
            {fmtBytes(quota.quotaBytes)} — fichiers jusqu&apos;à{" "}
            {fmtBytes(MAX_DOCUMENT_BYTES)}, types :{" "}
            {ALLOWED_MIME_TYPES.join(", ")}.
          </div>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Les documents sont privés : téléchargement uniquement via cette
          application, après contrôle d&apos;accès et vérification d&apos;intégrité.
        </p>
      </div>

      {deleteTarget ? (
        <ConfirmPanel
          title="Confirmer la suppression du document"
          tone="warning"
          action={deleteDocumentAction}
          fields={{ id: deleteTarget.id }}
          inputs={[
            {
              name: "reason",
              label: "Motif de suppression",
              required: true,
              placeholder: "Ex. pièce erronée, version obsolète",
            },
          ]}
          confirmLabel="Supprimer le document"
          cancelHref="/app/documents"
        >
          Le document «{" "}
          <span className="font-medium">{deleteTarget.originalName}</span> »
          sera marqué supprimé. Aucune suppression physique immédiate — le
          fichier sera purgé après la période de rétention.
        </ConfirmPanel>
      ) : null}

      {replaceTarget ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 shadow-sm text-amber-900">
          <div className="text-sm font-semibold">Remplacer le document</div>
          <div className="mt-2 text-sm">
            « <span className="font-medium">{replaceTarget.originalName}</span> »
            passera au statut remplacé ; la nouvelle version sera conservée avec
            son propre historique.
          </div>
          <form
            action={replaceDocumentAction}
            className="mt-4 flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="id" value={replaceTarget.id} />
            <input type="hidden" name="category" value={replaceTarget.category} />
            <label className="block text-sm">
              Nouveau fichier <span aria-hidden="true" className="text-red-600">*</span>
              <input
                aria-label="Nouveau fichier"
                name="file"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                required
                className={`ml-2 ${input}`}
              />
            </label>
            <SubmitButton className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Remplacer
            </SubmitButton>
            <Link
              href="/app/documents"
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-mist"
            >
              Annuler
            </Link>
          </form>
        </div>
      ) : null}

      {canUpload ? (
        <div className={card}>
          <div className="mb-3 text-sm font-medium text-zinc-900">
            Déposer un document
          </div>
          <form
            action={uploadDocumentAction}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <label className="block text-sm">
              Catégorie <span aria-hidden="true" className="text-red-600">*</span>
              <select
                aria-label="Catégorie"
                name="category"
                required
                className={`mt-1 w-full ${input}`}
              >
                {DOCUMENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm sm:col-span-2">
              Fichier <span aria-hidden="true" className="text-red-600">*</span>
              <input
                aria-label="Fichier"
                name="file"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                required
                className={`mt-1 w-full ${input}`}
              />
            </label>
            <label className="block text-sm">
              Libellé
              <input
                aria-label="Libellé"
                name="label"
                className={`mt-1 w-full ${input}`}
                placeholder="Ex. Justificatif de paiement"
              />
            </label>
            <div className="sm:col-span-2 lg:col-span-4">
              <SubmitButton className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
                Déposer
              </SubmitButton>
            </div>
          </form>
        </div>
      ) : null}

      <div className={card}>
        <div className="mt-4 overflow-x-auto">
          <table aria-label="Liste des documents" className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                <th scope="col" className="py-2">Déposé le</th>
                <th scope="col" className="py-2">Nom d&apos;origine</th>
                <th scope="col" className="py-2">Catégorie</th>
                <th scope="col" className="py-2">Type</th>
                <th scope="col" className="py-2">Statut</th>
                <th scope="col" className="py-2 text-right">Taille</th>
                <th scope="col" className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2">{d.createdAt.toISOString().slice(0, 10)}</td>
                  <td className="py-2">
                    {d.label ?? d.originalName}
                    {d.label ? (
                      <div className="text-xs text-zinc-500">{d.originalName}</div>
                    ) : null}
                    {d.deleteReason ? (
                      <div className="text-xs text-zinc-500">
                        Motif : {d.deleteReason}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2">{d.category}</td>
                  <td className="py-2">
                    {d.mimeType}
                    <div className="text-xs text-zinc-500">v{d.version}</div>
                  </td>
                  <td className="py-2">
                    <span
                      className={`text-xs font-medium ${
                        d.status === "ACTIVE"
                          ? "text-emerald-700"
                          : d.status === "DELETED"
                            ? "text-red-700"
                            : "text-zinc-600"
                      }`}
                    >
                      {STATUS_LABELS[d.status] ?? d.status}
                    </span>
                  </td>
                  <td className="py-2 text-right font-medium">
                    {fmtBytes(d.sizeBytes)}
                  </td>
                  <td className="py-2 text-right">
                    <span className="flex items-center justify-end gap-2">
                      {d.status === "ACTIVE" ? (
                        <a
                          href={`/app/documents/${d.id}/download`}
                          className="text-xs text-brand-700 underline"
                        >
                          Télécharger
                        </a>
                      ) : null}
                      {d.status === "ACTIVE" &&
                      (canManage || d.uploadedById === tenant.userId) ? (
                        <>
                          <Link
                            href={`/app/documents?replace=${d.id}`}
                            className="text-xs text-brand-700 underline"
                          >
                            Remplacer
                          </Link>
                          <Link
                            href={`/app/documents?confirm=delete&id=${d.id}`}
                            className="text-xs text-red-700 underline"
                          >
                            Supprimer
                          </Link>
                        </>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
              {documents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-3 text-zinc-500">
                    Aucun document.
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
