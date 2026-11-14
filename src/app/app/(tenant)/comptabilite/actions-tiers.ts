"use server";
import { revalidatePath } from "next/cache";
import { requireSchoolPermission } from "@/lib/permissions/guard";
import { upsertThirdParty } from "@/lib/services/accounting/thirdparty";

export async function upsertThirdPartyAction(fd: FormData) {
  const t = await requireSchoolPermission("accounting.manage");
  await upsertThirdParty(
    { userId: t.userId, schoolId: t.schoolId },
    {
      id: String(fd.get("id") ?? "") || undefined,
      kind: String(fd.get("kind") ?? "SUPPLIER") as "SUPPLIER" | "STAFF" | "OTHER",
      name: String(fd.get("name") ?? ""),
      refId: String(fd.get("refId") ?? "") || undefined,
      collectiveAccountId: String(fd.get("collectiveAccountId") ?? ""),
    },
  );
  revalidatePath("/app/comptabilite/tiers");
}
