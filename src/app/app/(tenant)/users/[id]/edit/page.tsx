import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { listSchoolAssignableRoles } from "@/lib/permissions/rbac";
import UserForm from "@/app/app/(tenant)/users/ui/user-form";

export const instant = false;

export default async function EditUserPage(props: { params: Promise<{ id: string }> }) {
  const tenant = await requireSchoolPermission("user.manage");

  const { id } = await props.params;

  const membership = await prisma.schoolMembership.findFirst({
    where: {
      userId: id,
      schoolId: tenant.schoolId,
      user: {
        userRoles: { none: { role: { scope: "PLATFORM" } } },
      },
    },
    select: {
      roleId: true,
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          status: true,
        },
      },
    },
  });

  if (!membership) {
    redirect("/app/users");
  }

  const roles = await listSchoolAssignableRoles(tenant.schoolId);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-zinc-500">Administration</div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
              Modifier utilisateur
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
        <UserForm
          mode="edit"
          roles={roles}
          initial={{ ...membership.user, roleId: membership.roleId }}
        />
      </div>
    </div>
  );
}
