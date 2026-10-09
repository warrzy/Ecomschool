import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/tenant/context";

export const instant = false;

export default async function PlatformDashboard() {
  const tenant = await requireTenant();
  if (!tenant) redirect("/login");

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-zinc-500">Tableau de bord</div>
        <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
          Plateforme
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-zinc-500">Établissements</div>
          <div className="mt-2 text-2xl font-semibold text-zinc-900">-</div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-zinc-500">Utilisateurs</div>
          <div className="mt-2 text-2xl font-semibold text-zinc-900">-</div>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-zinc-500">Santé système</div>
          <div className="mt-2 text-2xl font-semibold text-zinc-900">OK</div>
        </div>
      </div>
    </div>
  );
}
