import Link from "next/link";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { listSchoolAssignableRoles } from "@/lib/permissions/rbac";
import UserForm from "@/app/app/(tenant)/users/ui/user-form";

export const instant = false;

export default async function NewUserPage() {
  const tenant = await requireSchoolPermission("user.manage");
  const roles = await listSchoolAssignableRoles(tenant.schoolId);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm text-zinc-500">Administration</div>
            <h1 className="mt-1 text-xl font-display font-bold tracking-tight text-ink">
              Nouvel utilisateur
            </h1>
          </div>
          <Link
            href="/app/users"
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-mist"
          >
            Retour
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-soft">
        <UserForm mode="create" roles={roles} />
      </div>
    </div>
  );
}
