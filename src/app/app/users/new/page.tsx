import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/permissions/guard";
import UserForm from "@/app/app/users/ui/user-form";

export const instant = false;

export default async function NewUserPage() {
  const tenant = await requirePermission("user.manage");
  if (!tenant) redirect("/login");

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-zinc-500">Administration</div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
              Nouvel utilisateur
            </div>
          </div>
          <Link
            href="/app/users"
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50"
          >
            Retour
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <UserForm mode="create" />
      </div>
    </div>
  );
}
