import Link from "next/link";
import { requirePlatformPermission } from "@/lib/permissions/guard";
import { userHasPlatformPermission } from "@/lib/permissions/rbac";
import { listInvoices, listUnpaidInvoices } from "@/lib/services/platform/billing";
import { cancelInvoiceAction } from "@/app/platform/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";

export const instant = false;

const fmt = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
const STATUS: Record<string, string> = {
  ISSUED: "Émise",
  PARTIALLY_PAID: "Partielle",
  PAID: "Payée",
  CANCELLED: "Annulée",
};

export default async function InvoicesPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requirePlatformPermission("platform.invoices.read");
  const sp = (await props.searchParams) ?? {};
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const confirm = typeof sp.confirm === "string" ? sp.confirm : undefined;
  const confirmId = typeof sp.id === "string" ? sp.id : undefined;
  const canManage = await userHasPlatformPermission({
    userId: tenant.userId,
    permissionKey: "platform.invoices.manage",
  });

  const [invoices, unpaid] = await Promise.all([listInvoices(), listUnpaidInvoices()]);
  const unpaidTotal = unpaid.reduce((s, i) => s + i.balance, 0);
  const confirmInvoice = invoices.find((i) => i.id === confirmId);

  const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm";

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="text-sm text-zinc-500">
          <Link href="/platform" className="hover:underline">Plateforme</Link> / Factures SaaS
        </div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Facturation ECOM-TOUCH ({invoices.length})
        </h1>
        <p className="mt-2 text-xs text-zinc-500">
          Domaine indépendant de la comptabilité scolaire. Les factures se génèrent depuis la fiche établissement.
        </p>
        {error ? <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{errorMessage(error)}</div> : null}
      </div>

      {unpaid.length > 0 ? (
        <div className={`${card} border-amber-200 bg-amber-50`}>
          <div className="text-sm font-medium text-amber-900">
            {unpaid.length} facture(s) échue(s) — {fmt(unpaidTotal)} impayé(s)
          </div>
        </div>
      ) : null}

      {canManage && confirm === "cancel" && confirmInvoice ? (
        <ConfirmPanel
          title="Confirmer l'annulation de la facture"
          tone="danger"
          action={cancelInvoiceAction}
          fields={{ id: confirmInvoice.id }}
          inputs={[
            {
              name: "reason",
              label: "Motif de l'annulation :",
              required: true,
              placeholder: "Erreur d'émission, geste commercial…",
            },
          ]}
          confirmLabel="Annuler la facture"
          cancelHref="/platform/invoices"
        >
          Annuler la facture <strong>{confirmInvoice.invoiceNumber}</strong> de{" "}
          <strong>{confirmInvoice.school.name}</strong> (
          {fmt(confirmInvoice.total)}) la marque « Annulée » : elle ne pourra
          plus être encaissée. <strong>Cette action est irréversible</strong> —
          les règlements déjà enregistrés restent tracés.
        </ConfirmPanel>
      ) : null}
      <div className={card}>
        <div className="overflow-x-auto">
        <table aria-label="Facturation ECOM-TOUCH" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <th scope="col" className="py-2">N°</th>
              <th scope="col" className="py-2">École</th>
              <th scope="col" className="py-2">Émission</th>
              <th scope="col" className="py-2">Échéance</th>
              <th scope="col" className="py-2 text-right">Total</th>
              <th scope="col" className="py-2 text-right">Solde</th>
              <th scope="col" className="py-2">Statut</th>
              <th scope="col" className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => {
              const paid = i.payments.reduce((s, p) => s + p.amount, 0);
              const credited = i.creditNotes.reduce((s, c) => s + c.amount, 0);
              const balance = Math.max(0, i.total - paid - credited);
              return (
                <tr key={i.id} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2 font-mono text-xs">
                    <Link href={`/platform/invoices/${i.id}`} className="hover:underline">{i.invoiceNumber}</Link>
                  </td>
                  <td className="py-2">
                    <Link href={`/platform/schools/${i.schoolId}`} className="hover:underline">
                      {i.school.name}
                    </Link>
                  </td>
                  <td className="py-2 text-xs">{i.issueDate.toISOString().slice(0, 10)}</td>
                  <td className="py-2 text-xs">{i.dueDate.toISOString().slice(0, 10)}</td>
                  <td className="py-2 text-right">{fmt(i.total)}</td>
                  <td className="py-2 text-right">{balance > 0 ? fmt(balance) : "—"}</td>
                  <td className="py-2">{STATUS[i.status] ?? i.status}</td>
                  <td className="py-2 text-right text-xs">
                    <Link href={`/platform/invoices/${i.id}`} className="underline">Détail</Link>
                    {" · "}
                    <a href={`/platform/invoices/${i.id}/pdf`} className="underline">PDF</a>
                    {canManage && (i.status === "ISSUED" || i.status === "PARTIALLY_PAID") ? (
                      <>
                        {" · "}
                        <Link
                          href={`/platform/invoices?confirm=cancel&id=${i.id}`}
                          className="text-red-700 underline"
                        >
                          Annuler
                        </Link>
                      </>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {invoices.length === 0 ? (
              <tr><td colSpan={8} className="py-4 text-zinc-500">Aucune facture.</td></tr>
            ) : null}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
