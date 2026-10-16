import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePlatformPermission } from "@/lib/permissions/guard";
import { userHasPlatformPermission } from "@/lib/permissions/rbac";
import { prisma } from "@/lib/db/prisma";
import {
  cancelPlatformPaymentAction,
  issueCreditNoteAction,
  recordPlatformPaymentAction,
} from "@/app/platform/actions";
import { errorMessage } from "@/lib/ui/errorLabels";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";
import { SubmitButton } from "@/components/ui/SubmitButton";

export const instant = false;

const fmt = (n: number) => `${n.toLocaleString("fr-FR")} FCFA`;
const STATUS: Record<string, string> = {
  ISSUED: "Émise",
  PARTIALLY_PAID: "Partiellement payée",
  PAID: "Payée",
  CANCELLED: "Annulée",
};

export default async function InvoiceDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await requirePlatformPermission("platform.invoices.read");
  const { id } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const confirm = typeof sp.confirm === "string" ? sp.confirm : undefined;
  const confirmId = typeof sp.pid === "string" ? sp.pid : undefined;
  const canManage = await userHasPlatformPermission({
    userId: tenant.userId,
    permissionKey: "platform.invoices.manage",
  });
  const canPay = await userHasPlatformPermission({
    userId: tenant.userId,
    permissionKey: "platform.payments.manage",
  });

  const invoice = await prisma.platformInvoice.findUnique({
    where: { id },
    include: {
      school: { select: { name: true, code: true } },
      lines: true,
      payments: { orderBy: { paidAt: "desc" } },
      creditNotes: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!invoice) redirect("/platform/invoices");

  const paid = invoice.payments.filter((p) => p.status === "VALIDATED").reduce((s, p) => s + p.amount, 0);
  const credited = invoice.creditNotes.reduce((s, c) => s + c.amount, 0);
  const balance = Math.max(0, invoice.total - paid - credited);
  const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm";
  const input = "rounded-lg border border-zinc-300 px-3 py-2 text-sm";
  const selfHref = `/platform/invoices/${invoice.id}`;
  const confirmPayment = invoice.payments.find((p) => p.id === confirmId);

  return (
    <div className="space-y-4">
      {canPay && confirm === "cancel-payment" && confirmPayment ? (
        <ConfirmPanel
          title="Confirmer l'annulation du règlement"
          tone="danger"
          action={cancelPlatformPaymentAction}
          fields={{ id: confirmPayment.id }}
          inputs={[
            {
              name: "reason",
              label: "Motif de la contre-écriture :",
              required: true,
              placeholder: "Erreur de saisie, doublon…",
            },
          ]}
          confirmLabel="Annuler le règlement"
          cancelHref={selfHref}
        >
          Annuler le règlement de <strong>{fmt(confirmPayment.amount)}</strong>{" "}
          sur la facture <strong>{invoice.invoiceNumber}</strong> le contredit
          et rouvre le solde. <strong>Cette action est irréversible</strong> et
          reste tracée dans l&apos;audit.
        </ConfirmPanel>
      ) : null}
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm text-zinc-500">
              <Link href="/platform/invoices" className="hover:underline">Factures</Link> / {invoice.invoiceNumber}
            </div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
              {fmt(invoice.total)} — {STATUS[invoice.status] ?? invoice.status}
            </div>
            <div className="mt-1 text-sm text-zinc-600">
              <Link href={`/platform/schools/${invoice.schoolId}`} className="hover:underline">
                {invoice.school.name}
              </Link>{" "}
              · émise le {invoice.issueDate.toISOString().slice(0, 10)} · échéance{" "}
              {invoice.dueDate.toISOString().slice(0, 10)} · solde {fmt(balance)}
            </div>
          </div>
          <a
            href={`/platform/invoices/${invoice.id}/pdf`}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50"
          >
            PDF
          </a>
        </div>
        {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{errorMessage(error)}</div> : null}
      </div>

      <div className={card}>
        <div className="mb-3 text-sm font-medium text-zinc-900">Lignes</div>
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <tbody>
            {invoice.lines.map((l) => (
              <tr key={l.id} className="border-b border-zinc-100 last:border-0">
                <td className="py-2">{l.label}</td>
                <td className="py-2 text-center text-xs">{l.quantity} × {fmt(l.unitPrice)}</td>
                <td className="py-2 text-right">{fmt(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {canPay && (invoice.status === "ISSUED" || invoice.status === "PARTIALLY_PAID") ? (
        <div className={card}>
          <div className="mb-3 text-sm font-medium text-zinc-900">Enregistrer un règlement</div>
          <form action={recordPlatformPaymentAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <input type="hidden" name="schoolId" value={invoice.schoolId} />
            <input type="hidden" name="idempotencyKey" value={globalThis.crypto?.randomUUID?.() ?? ""} />
            <input name="amount" type="number" min="1" max={balance} defaultValue={balance} required className={input} />
            <input name="method" placeholder="Mode (virement, espèces…)" className={input} />
            <input name="reference" placeholder="Référence" className={input} />
            <SubmitButton
              pendingLabel="Encaissement…"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
            >
              Encaisser
            </SubmitButton>
          </form>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={card}>
          <div className="mb-3 text-sm font-medium text-zinc-900">Règlements ({invoice.payments.length})</div>
          <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <tbody>
              {invoice.payments.map((p) => (
                <tr key={p.id} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2">{fmt(p.amount)}</td>
                  <td className="py-2 text-xs text-zinc-500">{p.method ?? "—"} · {p.paidAt.toISOString().slice(0, 10)}</td>
                  <td className="py-2 text-xs">{p.status === "CANCELLED" ? "Annulé" : "Validé"}</td>
                  <td className="py-2 text-right">
                    {canPay && p.status === "VALIDATED" ? (
                      <Link
                        href={`${selfHref}?confirm=cancel-payment&pid=${p.id}`}
                        className="text-xs text-red-700 underline"
                      >
                        Annuler
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
              {invoice.payments.length === 0 ? (
                <tr><td colSpan={4} className="py-3 text-zinc-500">Aucun règlement.</td></tr>
              ) : null}
            </tbody>
          </table>
          </div>
        </div>

        <div className={card}>
          <div className="mb-3 text-sm font-medium text-zinc-900">Avoirs ({invoice.creditNotes.length})</div>
          <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <tbody>
              {invoice.creditNotes.map((c) => (
                <tr key={c.id} className="border-b border-zinc-100 last:border-0">
                  <td className="py-2 font-mono text-xs">{c.creditNoteNumber}</td>
                  <td className="py-2">{fmt(c.amount)}</td>
                  <td className="py-2 text-xs text-zinc-500">{c.reason}</td>
                </tr>
              ))}
              {invoice.creditNotes.length === 0 ? (
                <tr><td colSpan={3} className="py-3 text-zinc-500">Aucun avoir.</td></tr>
              ) : null}
            </tbody>
          </table>
          </div>
          {canManage && invoice.status !== "CANCELLED" && balance > 0 ? (
            <form action={issueCreditNoteAction} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <input type="hidden" name="schoolId" value={invoice.schoolId} />
              <input name="amount" type="number" min="1" max={balance} placeholder="Montant" required className={input} />
              <input name="reason" placeholder="Motif" required className={input} />
              <SubmitButton className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50">
                Émettre un avoir
              </SubmitButton>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
